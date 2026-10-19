import { eq } from "drizzle-orm";
import { z } from "zod";

import { MAX_TTS_CHARS, STT_LANGUAGES, STT_MAX_UPLOAD_BYTES, balance } from "@/lib/credits";
import { clock } from "@/lib/clock";
import { LIMITS } from "@/lib/rate-limit";
import type { ActionErrorCode, Generation, RateLimited } from "@/lib/types";
import { normalizeVoiceSettings } from "@/lib/voice-settings";
import { SFX_MAX_SECONDS, SFX_MIN_SECONDS, SFX_PROMPT_MAX } from "@/lib/sound-effects";
import { formatCents } from "@/lib/wallet";

import { authenticateApiKey } from "./api-keys.server";
import { getDb, type Db } from "./db.server";
import { imageDeps, sfxDeps, speechDeps, transcribeDeps, videoDeps } from "./deps.server";
import { fileStorage, type FileStorage } from "./file-storage.server";
import { ownedFileResponse, ownedSubtitleResponse, subtitleFormat } from "./media.server";
import { voiceClones } from "./schema.server";
import {
  blocked,
  generateImages,
  generateSpeech,
  getGeneration,
  loadUserData,
  recordAttempt,
  refreshPending,
  startVideo,
  type ImageDeps,
  type SpeechDeps,
  type VideoDeps,
} from "./services.server";
import { generateSoundEffect, type SfxDeps } from "./sound-effects.server";
import { startTranscription, type TranscribeDeps } from "./transcribe.server";

export interface ApiDeps {
  db: () => Promise<Db>;
  now: () => Date;
  storage: FileStorage;
  speech: SpeechDeps | null;
  image: ImageDeps | null;
  video: VideoDeps | null;
  /** Sesten yazıya (ElevenLabs ve ffmpeg); yoksa kapalı. */
  transcribe?: () => Promise<TranscribeDeps | null>;
  /** Ses efekti (ElevenLabs); yoksa kapalı. */
  sfx?: SfxDeps | null;
}

function defaultDeps(): ApiDeps {
  return {
    db: getDb,
    now: clock,
    storage: fileStorage(),
    speech: speechDeps(),
    image: imageDeps(),
    video: videoDeps(),
    transcribe: transcribeDeps,
    sfx: sfxDeps(),
  };
}

/** Geliştiriciye dönen hata kodları; mesajlar API sözleşmesinin parçası olarak İngilizcedir. */
const ERRORS = {
  unauthorized: [401, "Missing or invalid API key."],
  not_found: [404, "Not found."],
  method_not_allowed: [405, "Method not allowed."],
  invalid_input: [400, "Invalid request."],
  insufficient_credits: [402, "Not enough credits. No credits were used."],
  limit: [
    409,
    "Too many jobs in progress (max 3 videos, 2 long voiceovers, 2 transcriptions). Wait for one to finish.",
  ],
  content_rejected: [422, "Blocked by the content filter. No credits were used."],
  payload_too_large: [413, "The file is too large (max 125 MB)."],
  rate_limited: [429, "Too many requests."],
  provider_failed: [502, "The generation service failed. No credits were used."],
  service_unavailable: [503, "This service is not enabled on this server."],
} as const;
type ErrorCode = keyof typeof ERRORS;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

function fail(code: ErrorCode, retryAfterSeconds?: number): Response {
  const [status, message] = ERRORS[code];
  return json(
    { error: { code, message } },
    status,
    retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {},
  );
}

const fromAction = (e: ActionErrorCode): ErrorCode =>
  e === "insufficient"
    ? "insufficient_credits"
    : e === "providerFailed"
      ? "provider_failed"
      : e === "contentRejected"
        ? "content_rejected"
        : e === "limit"
          ? "limit"
          : e === "unavailable"
            ? "service_unavailable"
            : "invalid_input";

const rateLimited = (r: RateLimited) => fail("rate_limited", r.retryAfterMinutes * 60);

const VIDEO_STYLES = ["cinematic", "anime", "3d", "documentary"] as const;

const schemas = {
  tts: z.object({
    text: z.string().min(1).max(MAX_TTS_CHARS),
    voice_id: z.string().min(1).max(80),
    // Verilmeyen ayar varsayılan kalır; aralık dışı değer kırpılır.
    voice_settings: z
      .object({
        speed: z.number().finite(),
        stability: z.number().finite(),
        similarity: z.number().finite(),
        style: z.number().finite(),
      })
      .partial()
      .optional(),
  }),
  images: z.object({
    prompt: z.string().min(1).max(400),
    count: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
  }),
  videos: z.object({
    prompt: z.string().min(1).max(400),
    style: z.enum(VIDEO_STYLES).default("cinematic"),
  }),
  soundEffects: z.object({
    prompt: z.string().min(1).max(SFX_PROMPT_MAX),
    // Verilmezse ya da null ise süreyi model seçer.
    duration_seconds: z.number().min(SFX_MIN_SECONDS).max(SFX_MAX_SECONDS).nullable().default(null),
    loop: z.boolean().default(false),
  }),
};

/** Üretimin API görünümü; dosya adresleri API anahtarıyla indirilir. */
function view(g: Generation, origin: string) {
  const count =
    g.type === "tts" || g.type === "stt" || g.type === "sfx"
      ? g.audioUrl
        ? 1
        : 0
      : (g.fileUrls?.length ?? 0);
  return {
    id: g.id,
    type: g.type,
    status: g.status === "pending" ? "pending" : g.status === "failed" ? "failed" : "completed",
    ...(g.type === "stt"
      ? { transcript: g.text, ...(g.language && { language: g.language }) }
      : { prompt: g.text }),
    cost: g.cost,
    ...(g.voiceSettings && { voice_settings: g.voiceSettings }),
    ...(g.effect && { duration_seconds: g.effect.duration, loop: g.effect.loop }),
    ...(g.progress && { progress: g.progress }),
    created_at: g.createdAt,
    files: Array.from(
      { length: count },
      (_, i) => `${origin}/api/v1/generations/${g.id}/files/${i}`,
    ),
    ...(g.subtitleUrl && {
      subtitles: {
        srt: `${origin}/api/v1/generations/${g.id}/subtitles?format=srt`,
        vtt: `${origin}/api/v1/generations/${g.id}/subtitles?format=vtt`,
      },
    }),
  };
}

async function readBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T> | null> {
  const raw = await request.text();
  // En uzun seslendirme metni (50.000 karakter, çoğu çok baytlı) sığar.
  if (raw.length > 256 * 1024) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * /api/v1/* — geliştirici API'si. Kimlik `Authorization: Bearer trai_…` ile
 * doğrulanır. Kredi, fiyat ve sınırlar stüdyoyla aynı servis fonksiyonlarından
 * geçer; servis hata verirse ya da içeriği reddederse kredi düşülmez.
 */
export async function handleApi(
  request: Request,
  path: string,
  deps: ApiDeps = defaultDeps(),
): Promise<Response> {
  const db = await deps.db();
  const now = deps.now();
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  const auth = bearer ? await authenticateApiKey(db, bearer[1]!, now) : null;
  if (!auth) return fail("unauthorized");

  const limitKey = `api:key:${auth.keyId}`;
  const stop = await blocked(db, [[limitKey, LIMITS.apiPerKey]], now);
  if (stop) return rateLimited(stop);
  await recordAttempt(db, limitKey, now);

  const userId = auth.userId;
  const origin = new URL(request.url).origin;
  const [resource, id, sub, index, ...rest] = path.split("/").filter(Boolean);
  const method = request.method.toUpperCase();
  const only = (m: string) => (method === m ? null : fail("method_not_allowed"));

  if (rest.length) return fail("not_found");

  switch (resource) {
    case "me": {
      if (id) return fail("not_found");
      const denied = only("GET");
      if (denied) return denied;
      const data = await loadUserData(db, userId, now);
      return json({
        credits: {
          voice: balance(data.grants, "voice", now),
          media: balance(data.grants, "media", now),
        },
        balance_usd: formatCents(data.wallet.balanceCents),
      });
    }

    case "voices": {
      if (id) return fail("not_found");
      const denied = only("GET");
      if (denied) return denied;
      if (!deps.speech) return fail("service_unavailable");
      let catalog;
      try {
        catalog = await deps.speech.catalog();
      } catch {
        return fail("provider_failed");
      }
      const clones = await db
        .select({ id: voiceClones.id, name: voiceClones.name, pid: voiceClones.providerVoiceId })
        .from(voiceClones)
        .where(eq(voiceClones.userId, userId));
      return json({
        voices: [
          ...catalog.map((v) => ({ id: v.id, name: v.name, gender: v.gender, type: "stock" })),
          ...clones
            .filter((c) => c.pid)
            .map((c) => ({ id: c.id, name: c.name, gender: null, type: "clone" })),
        ],
      });
    }

    case "tts": {
      if (id) return fail("not_found");
      const denied = only("POST");
      if (denied) return denied;
      if (!deps.speech) return fail("service_unavailable");
      const body = await readBody(request, schemas.tts);
      if (!body) return fail("invalid_input");
      const res = await generateSpeech(
        db,
        deps.speech,
        userId,
        {
          text: body.text,
          voiceId: body.voice_id,
          settings: body.voice_settings ? normalizeVoiceSettings(body.voice_settings) : undefined,
        },
        now,
      );
      if (!res.ok)
        return res.error === "tooManyAttempts" ? rateLimited(res) : fail(fromAction(res.error));
      // Uzun metin arka planda seslendirilir: video gibi 202 ve "pending" döner.
      return json(view(res.generation, origin), res.generation.status === "pending" ? 202 : 201);
    }

    case "sound-effects": {
      if (id) return fail("not_found");
      const denied = only("POST");
      if (denied) return denied;
      if (!deps.sfx) return fail("service_unavailable");
      const body = await readBody(request, schemas.soundEffects);
      if (!body) return fail("invalid_input");
      const res = await generateSoundEffect(
        db,
        deps.sfx,
        userId,
        { text: body.prompt, duration: body.duration_seconds, loop: body.loop },
        now,
      );
      if (!res.ok)
        return res.error === "tooManyAttempts" ? rateLimited(res) : fail(fromAction(res.error));
      return json(view(res.generation, origin), 201);
    }

    case "images": {
      if (id) return fail("not_found");
      const denied = only("POST");
      if (denied) return denied;
      if (!deps.image) return fail("service_unavailable");
      const body = await readBody(request, schemas.images);
      if (!body) return fail("invalid_input");
      const res = await generateImages(
        db,
        deps.image,
        userId,
        { text: body.prompt, count: body.count },
        now,
      );
      if (!res.ok)
        return res.error === "tooManyAttempts" ? rateLimited(res) : fail(fromAction(res.error));
      return json(view(res.generation, origin), 201);
    }

    case "videos": {
      if (id) return fail("not_found");
      const denied = only("POST");
      if (denied) return denied;
      if (!deps.video) return fail("service_unavailable");
      const body = await readBody(request, schemas.videos);
      if (!body) return fail("invalid_input");
      const res = await startVideo(
        db,
        deps.video,
        userId,
        { text: body.prompt, styleIndex: VIDEO_STYLES.indexOf(body.style) },
        now,
      );
      if (!res.ok)
        return res.error === "tooManyAttempts" ? rateLimited(res) : fail(fromAction(res.error));
      return json(view(res.generation, origin), 202);
    }

    case "transcriptions": {
      if (id) return fail("not_found");
      const denied = only("POST");
      if (denied) return denied;
      const tdeps = (await deps.transcribe?.()) ?? null;
      if (!tdeps) return fail("service_unavailable");
      const length = Number(request.headers.get("content-length") ?? 0);
      if (length > STT_MAX_UPLOAD_BYTES + 64 * 1024) return fail("payload_too_large");
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return fail("invalid_input");
      }
      const file = form.get("file");
      const language = form.get("language") ?? undefined;
      const title = form.get("title") ?? undefined;
      if (!(file instanceof File)) return fail("invalid_input");
      if (file.size > STT_MAX_UPLOAD_BYTES) return fail("payload_too_large");
      if (
        (language !== undefined &&
          (typeof language !== "string" ||
            !(STT_LANGUAGES as readonly string[]).includes(language))) ||
        (title !== undefined && (typeof title !== "string" || title.length > 200))
      ) {
        return fail("invalid_input");
      }
      const res = await startTranscription(
        db,
        tdeps,
        userId,
        {
          file: new Uint8Array(await file.arrayBuffer()),
          name: file.name,
          language,
          title,
        },
        now,
      );
      if (!res.ok)
        return res.error === "tooManyAttempts" ? rateLimited(res) : fail(fromAction(res.error));
      return json(view(res.generation, origin), 202);
    }

    case "generations": {
      const denied = only("GET");
      if (denied) return denied;
      if (!id) return fail("not_found");
      if (sub === "files" && index !== undefined) {
        const i = /^\d{1,2}$/.test(index) ? Number(index) : -1;
        return ownedFileResponse(
          db,
          deps.storage,
          userId,
          id,
          (r) => (i === 0 && r.audioKey ? r.audioKey : i >= 0 ? r.files?.[i] : null),
          true,
        );
      }
      if (sub === "subtitles" && index === undefined) {
        return ownedSubtitleResponse(
          db,
          deps.storage,
          userId,
          id,
          subtitleFormat(request.url),
          true,
        );
      }
      if (sub) return fail("not_found");
      let g = await getGeneration(db, userId, id);
      if (!g) return fail("not_found");
      // Bekleyen iş bu istekte de kontrol edilir (video sağlayıcıdan, yarım kalan seslendirme iade).
      if (g.status === "pending") {
        const fresh = await refreshPending(db, deps.video, userId, id, now);
        if (fresh.ok) g = fresh.generation;
      }
      return json(view(g, origin));
    }

    default:
      return fail("not_found");
  }
}

import { eq } from "drizzle-orm";
import { z } from "zod";

import { balance } from "@/lib/credits";
import { clock } from "@/lib/clock";
import { LIMITS } from "@/lib/rate-limit";
import type { ActionErrorCode, Generation, RateLimited } from "@/lib/types";
import { formatCents } from "@/lib/wallet";

import { authenticateApiKey } from "./api-keys.server";
import { getDb, type Db } from "./db.server";
import { imageDeps, speechDeps, videoDeps } from "./deps.server";
import { fileStorage, type FileStorage } from "./file-storage.server";
import { ownedFileResponse } from "./media.server";
import { voiceClones } from "./schema.server";
import {
  blocked,
  generateImages,
  generateSpeech,
  getGeneration,
  loadUserData,
  recordAttempt,
  refreshVideo,
  startVideo,
  type ImageDeps,
  type SpeechDeps,
  type VideoDeps,
} from "./services.server";

export interface ApiDeps {
  db: () => Promise<Db>;
  now: () => Date;
  storage: FileStorage;
  speech: SpeechDeps | null;
  image: ImageDeps | null;
  video: VideoDeps | null;
}

function defaultDeps(): ApiDeps {
  return {
    db: getDb,
    now: clock,
    storage: fileStorage(),
    speech: speechDeps(),
    image: imageDeps(),
    video: videoDeps(),
  };
}

/** Geliştiriciye dönen hata kodları; mesajlar API sözleşmesinin parçası olarak İngilizcedir. */
const ERRORS = {
  unauthorized: [401, "Missing or invalid API key."],
  not_found: [404, "Not found."],
  method_not_allowed: [405, "Method not allowed."],
  invalid_input: [400, "Invalid request."],
  insufficient_credits: [402, "Not enough credits. No credits were used."],
  limit: [409, "Too many videos in progress (max 3). Wait for one to finish."],
  content_rejected: [422, "Blocked by the content filter. No credits were used."],
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
          : "invalid_input";

const rateLimited = (r: RateLimited) => fail("rate_limited", r.retryAfterMinutes * 60);

const VIDEO_STYLES = ["cinematic", "anime", "3d", "documentary"] as const;

const schemas = {
  tts: z.object({ text: z.string().min(1).max(5_000), voice_id: z.string().min(1).max(80) }),
  images: z.object({
    prompt: z.string().min(1).max(400),
    count: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
  }),
  videos: z.object({
    prompt: z.string().min(1).max(400),
    style: z.enum(VIDEO_STYLES).default("cinematic"),
  }),
};

/** Üretimin API görünümü; dosya adresleri API anahtarıyla indirilir. */
function view(g: Generation, origin: string) {
  const count = g.type === "tts" ? (g.audioUrl ? 1 : 0) : (g.fileUrls?.length ?? 0);
  return {
    id: g.id,
    type: g.type,
    status: g.status === "pending" ? "pending" : g.status === "failed" ? "failed" : "completed",
    prompt: g.text,
    cost: g.cost,
    created_at: g.createdAt,
    files: Array.from(
      { length: count },
      (_, i) => `${origin}/api/v1/generations/${g.id}/files/${i}`,
    ),
  };
}

async function readBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T> | null> {
  const raw = await request.text();
  if (raw.length > 64 * 1024) return null;
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
        { text: body.text, voiceId: body.voice_id },
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
      if (sub) return fail("not_found");
      let g = await getGeneration(db, userId, id);
      if (!g) return fail("not_found");
      // Bekleyen video bu istekte sağlayıcıdan da kontrol edilir.
      if (g.type === "video" && g.status === "pending" && deps.video) {
        const fresh = await refreshVideo(db, deps.video, userId, id, now);
        if (fresh.ok) g = fresh.generation;
      }
      return json(view(g, origin));
    }

    default:
      return fail("not_found");
  }
}

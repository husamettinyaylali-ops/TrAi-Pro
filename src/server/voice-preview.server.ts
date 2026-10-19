import { and, eq } from "drizzle-orm";

import { clock } from "@/lib/clock";
import { LIMITS } from "@/lib/rate-limit";

import { getDb, type Db } from "./db.server";
import { speechDeps } from "./deps.server";
import { env } from "./env.server";
import type { FileStorage } from "./file-storage.server";
import { requestUser, type MediaDeps } from "./media.server";
import { voiceClones } from "./schema.server";
import { blocked, clonePreviewKey, recordAttempt, type SpeechDeps } from "./services.server";
import { DEFAULT_TTS_MODEL } from "./tts.server";

/**
 * Seslendiren seçicide sesi dinleme: her ses için sitenin dilinde kısa bir
 * örnek cümle bir kez seslendirilip depoda saklanır; sonraki dinlemeler
 * dosyadan gelir ve kullanıcıya kredi düşmez. Hazır seslerin örneği herkes
 * için ortaktır; klon örneği kullanıcının klasöründe durur (klon ya da hesap
 * silinince gider).
 */

/** Örnek cümle; sesin adına bağlı değil (ad değişse de saklanan örnek geçerli kalır). */
export const PREVIEW_TEXT = {
  tr: "Merhaba! Metinlerini bu sesle seslendirebilirim. Teknoloji Masası'na hoş geldiniz.",
  en: "Hi there! I can voice your scripts in this voice. Welcome to the show.",
} as const;
export type PreviewLang = keyof typeof PREVIEW_TEXT;

const ID_RE = /^[A-Za-z0-9-]{1,80}$/;
const safe = (s: string) => s.replace(/[^A-Za-z0-9-]/g, "-");

/** Aynı örnek aynı anda iki kez üretilmesin (eşzamanlı ilk dinlemeler). */
const inflight: Map<string, Promise<Uint8Array>> = ((
  globalThis as { __traiVoicePreviews?: Map<string, Promise<Uint8Array>> }
).__traiVoicePreviews ??= new Map());

export type PreviewResult =
  | { ok: true; audio: Uint8Array }
  | {
      ok: false;
      error: "notFound" | "providerFailed" | "tooManyAttempts";
      retryAfterMinutes?: number;
    };

/**
 * Sesin örneği: hazır sesse katalogda, klonsa kullanıcının kendi canlı klonu
 * olmalı. Depoda yoksa üretilir (kullanıcı başına saatlik sınırla).
 */
export async function voicePreview(
  db: Db,
  deps: SpeechDeps,
  userId: string,
  voiceId: string,
  lang: PreviewLang,
  now: Date,
): Promise<PreviewResult> {
  if (!ID_RE.test(voiceId)) return { ok: false, error: "notFound" };
  let providerId: string;
  let key: string;
  if (voiceId.startsWith("clone-")) {
    const row = await db
      .select({ pid: voiceClones.providerVoiceId })
      .from(voiceClones)
      .where(and(eq(voiceClones.id, voiceId), eq(voiceClones.userId, userId)))
      .get();
    if (!row?.pid) return { ok: false, error: "notFound" };
    providerId = row.pid;
    key = clonePreviewKey(userId, voiceId, lang);
  } else {
    try {
      if (!(await deps.catalog()).some((v) => v.id === voiceId)) {
        return { ok: false, error: "notFound" };
      }
    } catch (err) {
      console.error("[ses] ses listesi alınamadı:", err instanceof Error ? err.message : err);
      return { ok: false, error: "providerFailed" };
    }
    providerId = voiceId;
    const model = safe(env("ELEVENLABS_MODEL") ?? DEFAULT_TTS_MODEL);
    key = `voice-previews/${voiceId}-${lang}-${model}.mp3`;
  }

  const cached = await deps.storage.read(key);
  if (cached) return { ok: true, audio: cached };

  let job = inflight.get(key);
  if (!job) {
    const limitKey = `preview:user:${userId}`;
    const stop = await blocked(db, [[limitKey, LIMITS.previewPerUser]], now);
    if (stop) return stop;
    await recordAttempt(db, limitKey, now);
    job = (async () => {
      const { audio } = await deps.tts.synthesize(providerId, PREVIEW_TEXT[lang]);
      await deps.storage.put(key, audio);
      return audio;
    })();
    inflight.set(key, job);
    void job.then(
      () => inflight.delete(key),
      () => inflight.delete(key),
    );
  }
  try {
    return { ok: true, audio: await job };
  } catch (err) {
    console.error("[ses] örnek seslendirilemedi:", err instanceof Error ? err.message : err);
    return { ok: false, error: "providerFailed" };
  }
}

/**
 * GET /media/voice-preview/:voiceId?lang=tr|en — oturum gerekir. Ses servisi
 * bağlı değilse 404 (stüdyo demo kipte tarayıcı sesiyle önizler).
 */
export async function serveVoicePreview(
  request: Request,
  voiceId: string,
  deps: MediaDeps & { speech?: SpeechDeps | null; storage?: FileStorage } = {},
): Promise<Response> {
  const db = deps.db ?? (await getDb());
  const now = deps.now ?? clock();
  const user = await requestUser(request, db, now);
  if (!user) return new Response("Oturum gerekli", { status: 401 });
  const speech = deps.speech === undefined ? speechDeps() : deps.speech;
  if (!speech) return new Response("Bulunamadı", { status: 404 });
  const lang: PreviewLang = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "tr";
  const res = await voicePreview(db, speech, user.id, voiceId, lang, now);
  if (!res.ok) {
    if (res.error === "tooManyAttempts") {
      return new Response("Çok fazla istek", {
        status: 429,
        headers: { "retry-after": String((res.retryAfterMinutes ?? 1) * 60) },
      });
    }
    return new Response(res.error === "notFound" ? "Bulunamadı" : "Servis hatası", {
      status: res.error === "notFound" ? 404 : 502,
    });
  }
  return new Response(new Uint8Array(res.audio), {
    headers: {
      "content-type": "audio/mpeg",
      "content-length": String(res.audio.byteLength),
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}

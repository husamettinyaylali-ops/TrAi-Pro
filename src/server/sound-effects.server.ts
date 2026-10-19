import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { balance, sfxCost } from "@/lib/credits";
import { LIMITS } from "@/lib/rate-limit";
import {
  SFX_PROMPT_MAX,
  encodeEffect,
  roundDuration,
  validDuration,
  type EffectOptions,
} from "@/lib/sound-effects";
import type { ActionErrorCode, Generation, RateLimited } from "@/lib/types";

import type { Db } from "./db.server";
import { env } from "./env.server";
import type { FileStorage } from "./file-storage.server";
import { readMp3 } from "./mp3.server";
import { creditGrants } from "./schema.server";
import {
  blocked,
  chargeAndRecord,
  recordAttempt,
  toGeneration,
  type GenerationMeta,
  type GenerationRow,
  type Result,
} from "./services.server";
import { ELEVENLABS_API, TtsError, elevenLabsBaseUrl } from "./tts.server";

/**
 * Ses efekti: açıklamadan kısa ses (ElevenLabs sound generation). Kısa
 * seslendirme gibi eşzamanlıdır: kredi yalnız servis geçerli bir MP3
 * döndürdükten sonra, tek transaction'da düşer.
 */

export const DEFAULT_SFX_MODEL = "eleven_text_to_sound_v2";

/** Ses efekti servisi. Testlerde sahte uygulama verilir. */
export interface SfxProvider {
  /** MP3 (44,1 kHz) döner. */
  generate(text: string, opts: EffectOptions): Promise<Uint8Array>;
}

const SFX_TIMEOUT_MS = 120_000;

export function elevenLabsSfx(opts: {
  apiKey: string;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch;
}): SfxProvider {
  const f = opts.fetchImpl ?? fetch;
  const api = opts.baseUrl ?? ELEVENLABS_API;
  return {
    async generate(text, { duration, loop }) {
      const res = await f(`${api}/v1/sound-generation?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": opts.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: DEFAULT_SFX_MODEL,
          ...(duration !== null && { duration_seconds: duration }),
          ...(loop && { loop: true }),
        }),
        signal: AbortSignal.timeout(SFX_TIMEOUT_MS),
      });
      // Yanıt gövdesi loglanmaz; sağlayıcı hata ayrıntısında girdi metnini yansıtabilir.
      if (!res.ok)
        throw new TtsError(`ElevenLabs ses efekti başarısız (${res.status})`, res.status);
      const audio = new Uint8Array(await res.arrayBuffer());
      if (!readMp3(audio)) throw new TtsError("ElevenLabs geçerli ses dönmedi", 502);
      return audio;
    },
  };
}

/** ELEVENLABS_API_KEY yoksa null: ses efekti kapalı (demo sonucu yoktur). */
export function sfxProvider(): SfxProvider | null {
  const apiKey = env("ELEVENLABS_API_KEY");
  return apiKey ? elevenLabsSfx({ apiKey, baseUrl: elevenLabsBaseUrl() }) : null;
}

export interface SfxDeps {
  sfx: SfxProvider;
  storage: FileStorage;
}

/**
 * Ses efekti üretir: bakiye ön kontrolü, sağlayıcı çağrısı, ardından tek
 * transaction'da düşüm ve kayıt. Düşüm eşzamanlı başka bir istek yüzünden
 * başarısız olursa üretilen dosya silinir.
 */
export async function generateSoundEffect(
  db: Db,
  deps: SfxDeps,
  userId: string,
  input: { text: string; duration: number | null; loop: boolean } & GenerationMeta,
  now: Date,
): Promise<Result<{ generation: Generation }, ActionErrorCode> | RateLimited> {
  const text = input.text.trim();
  const duration = roundDuration(input.duration);
  if (!text || [...text].length > SFX_PROMPT_MAX || !validDuration(duration)) {
    return { ok: false, error: "invalidInput" };
  }
  const options: EffectOptions = { duration, loop: input.loop === true };
  const cost = sfxCost(duration);
  const grants = (await db.select().from(creditGrants).where(eq(creditGrants.userId, userId))).map(
    ({ userId: _u, ...g }) => g,
  );
  if (balance(grants, "voice", now) < cost) return { ok: false, error: "insufficient" };

  const key = `sfx:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.sfxPerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);

  let audio: Uint8Array;
  try {
    audio = await deps.sfx.generate(text, options);
  } catch (err) {
    console.error("[efekt] üretilemedi:", err instanceof Error ? err.message : err);
    return { ok: false, error: "providerFailed" };
  }

  const id = randomUUID();
  const audioKey = `${userId}/${id}.mp3`;
  const row: GenerationRow = {
    id,
    userId,
    type: "sfx",
    text,
    voiceId: null,
    style: encodeEffect(options),
    images: null,
    audioKey,
    files: null,
    status: null,
    job: null,
    charges: null,
    projectId: null,
    title: null,
    voiceSettings: null,
    captionsKey: null,
    editKind: null,
    sourceId: null,
    cost,
    createdAt: now.toISOString(),
  };
  await deps.storage.put(audioKey, audio);
  if (!(await chargeAndRecord(db, userId, "voice", cost, row, now, input))) {
    await deps.storage.remove(audioKey);
    return { ok: false, error: "insufficient" };
  }
  return { ok: true, generation: toGeneration(row) };
}

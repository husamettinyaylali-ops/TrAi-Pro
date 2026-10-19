import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, count, eq } from "drizzle-orm";

import {
  STT_LANGUAGES,
  STT_MAX_SECONDS,
  STT_MAX_UPLOAD_BYTES,
  STT_MIN_SECONDS,
  sttCost,
} from "@/lib/credits";
import { GENERATION_TITLE_MAX } from "@/lib/projects";
import { LIMITS } from "@/lib/rate-limit";
import type { ActionErrorCode, Generation, RateLimited } from "@/lib/types";

import { cuesFromWords, cuesToText, encodeCues } from "./captions.server";
import type { FfmpegRun } from "./compose.server";
import type { Db } from "./db.server";
import { env } from "./env.server";
import type { FileStorage } from "./file-storage.server";
import { transcribeJobs, type TranscribeJob } from "./jobs.server";
import { readMp3 } from "./mp3.server";
import { generations } from "./schema.server";
import {
  blocked,
  chargeAndRecord,
  failGeneration,
  recordAttempt,
  toGeneration,
  type GenerationMeta,
  type GenerationRow,
  type Result,
} from "./services.server";
import { ELEVENLABS_API, TtsError, elevenLabsBaseUrl } from "./tts.server";

/**
 * Sesten yazıya: yüklenen ses ya da videonun konuşma sesi ffmpeg ile MP3'e
 * çevrilir (süre ve ücret bundan ölçülür; dosya dinleme ve düzenleyici için
 * saklanır), ElevenLabs Scribe ile arka planda yazıya dökülür; kelime
 * zamanlarından altyazı kurulur. Kredi baştan düşer, iş başarısız olursa iade
 * edilir.
 */

export const DEFAULT_STT_MODEL = "scribe_v2";

/** Sağlayıcının zamanlı kelimesi (saniye). */
export interface SttWord {
  text: string;
  start: number;
  end: number;
}

export interface Transcript {
  text: string;
  /** Algılanan dil (ISO 639); bilinmiyorsa null. */
  language: string | null;
  words: SttWord[];
}

/** Yazıya dökme servisi. Testlerde sahte uygulama verilir. */
export interface SttProvider {
  /** MP3 kaydı yazıya döker; dil verilmezse sağlayıcı algılar. */
  transcribe(audio: Uint8Array, opts: { language?: string | undefined }): Promise<Transcript>;
}

/** Bir saatlik kayıt da sığsın: yavaş yanıtta istek bu süre sonunda kesilir. */
const STT_TIMEOUT_MS = 15 * 60_000;

/** Sağlayıcı yanıtından metin, dil ve kelimeler; boşluk ve ses olayı girdileri atılır. */
export function readTranscript(body: unknown): Transcript {
  const b = (body ?? {}) as {
    text?: unknown;
    language_code?: unknown;
    words?: unknown;
  };
  if (typeof b.text !== "string") throw new TtsError("ElevenLabs metin dönmedi", 502);
  const words: SttWord[] = [];
  for (const w of Array.isArray(b.words) ? (b.words as Record<string, unknown>[]) : []) {
    const { text, start, end, type } = w ?? {};
    if (type !== undefined && type !== "word") continue;
    if (typeof text !== "string" || !text.trim()) continue;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    words.push({ text: text.trim(), start, end: Math.max(start, end) });
  }
  const language =
    typeof b.language_code === "string" && /^[a-z]{2,3}$/i.test(b.language_code)
      ? b.language_code.toLowerCase()
      : null;
  return { text: b.text.trim(), language, words };
}

export function elevenLabsStt(opts: {
  apiKey: string;
  model?: string | undefined;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch;
}): SttProvider {
  const f = opts.fetchImpl ?? fetch;
  const api = opts.baseUrl ?? ELEVENLABS_API;
  const model = opts.model ?? DEFAULT_STT_MODEL;
  return {
    async transcribe(audio, { language }) {
      const form = new FormData();
      form.append("model_id", model);
      form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "kayit.mp3");
      if (language) form.append("language_code", language);
      form.append("tag_audio_events", "false");
      form.append("timestamps_granularity", "word");
      const res = await f(`${api}/v1/speech-to-text`, {
        method: "POST",
        headers: { "xi-api-key": opts.apiKey },
        body: form,
        signal: AbortSignal.timeout(STT_TIMEOUT_MS),
      });
      // Yanıt gövdesi loglanmaz; kişisel konuşma içerebilir.
      if (!res.ok)
        throw new TtsError(`ElevenLabs yazıya dökme başarısız (${res.status})`, res.status);
      return readTranscript(await res.json());
    },
  };
}

/** ELEVENLABS_API_KEY yoksa null: sesten yazıya kapalı. */
export function sttProvider(): SttProvider | null {
  const apiKey = env("ELEVENLABS_API_KEY");
  return apiKey
    ? elevenLabsStt({ apiKey, model: env("ELEVENLABS_STT_MODEL"), baseUrl: elevenLabsBaseUrl() })
    : null;
}

// ---------------------------------------------------------------- ses hazırlama

/** Saklanan ses: 44,1 kHz mono MP3 (seslendirmelerle birleştirilebilir). */
const STT_AUDIO_BITRATE = "64k";
/** Kodlayıcının başa eklediği gecikme ve sondaki dolgu (en çok ~3 çerçeve); ücrete sayılmaz. */
const ENCODER_PADDING_SECONDS = 0.08;
/** Dönüştürme bu süreyi aşarsa kesilir (büyük video dosyası). */
const PREPARE_TIMEOUT_MS = 5 * 60_000;

/**
 * ffmpeg: girdinin ilk ses kanalı → MP3 (meta veri ve Xing başlığı olmadan).
 * Çıktı en uzun kayıttan biraz uzun kesilir; böylece çok uzun dosya
 * sonuna kadar işlenmeden reddedilir.
 */
export function prepareArgs(input: string, output: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input,
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    "-b:a",
    STT_AUDIO_BITRATE,
    "-t",
    String(STT_MAX_SECONDS + 1),
    "-map_metadata",
    "-1",
    "-id3v2_version",
    "0",
    "-write_xing",
    "0",
    output,
  ];
}

/** Yüklenen dosyanın sesi MP3'e çevrilir; dosya okunamazsa ya da sesi yoksa null. */
async function prepareAudio(
  run: FfmpegRun,
  file: Uint8Array,
): Promise<{ audio: Uint8Array; seconds: number } | null> {
  const dir = await mkdtemp(join(tmpdir(), "trai-stt-"));
  try {
    await writeFile(join(dir, "input"), file);
    await run(
      prepareArgs("input", "audio.mp3"),
      dir,
      () => {},
      AbortSignal.timeout(PREPARE_TIMEOUT_MS),
    );
    const audio = new Uint8Array(await readFile(join(dir, "audio.mp3")));
    const seconds = readMp3(audio)?.seconds;
    return seconds ? { audio, seconds } : null;
  } catch (err) {
    console.error("[yazı] ses hazırlanamadı:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------- iş

export interface TranscribeDeps {
  stt: SttProvider;
  storage: FileStorage;
  run: FfmpegRun;
  /** Geçici hata alan istek bu kadar bekleyip bir kez yeniden denenir. */
  retryDelayMs?: number;
}

/** Kullanıcı başına aynı anda yazıya dökülebilecek kayıt sayısı. */
export const STT_MAX_PENDING = 2;

/** Dosya adından kayıt adı: uzantı atılır, alt çizgiler boşluk olur, sınıra kırpılır. */
export function titleFromName(name: string): string | undefined {
  const base = name
    .replace(/\.[^./\\]{1,5}$/, "")
    .replace(/[_]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return base ? [...base].slice(0, GENERATION_TITLE_MAX).join("").trim() : undefined;
}

/** Geçici hata (ağ, zaman aşımı, 429, 5xx) bir kez yeniden denenir. */
async function transcribeWithRetry(
  deps: TranscribeDeps,
  ...args: Parameters<SttProvider["transcribe"]>
): Promise<Transcript> {
  try {
    return await deps.stt.transcribe(...args);
  } catch (err) {
    if (err instanceof TtsError && err.status !== 429 && err.status < 500) throw err;
    await new Promise((r) => setTimeout(r, deps.retryDelayMs ?? 5_000));
    return deps.stt.transcribe(...args);
  }
}

/**
 * Yüklenen kaydı yazıya dökmeye başlar. Ses hemen dönüştürülüp ölçülür (dosya
 * okunamazsa, sesi yoksa ya da çok uzunsa kredi düşülmez), kredi düşer ve
 * kayıt "pending" döner; yazıya dökme arka planda sürer.
 */
export async function startTranscription(
  db: Db,
  deps: TranscribeDeps,
  userId: string,
  input: {
    file: Uint8Array;
    /** Yüklenen dosyanın adı; ad verilmezse kayıt adı olur. */
    name: string;
    language?: string | undefined;
  } & GenerationMeta,
  now: Date,
): Promise<Result<{ generation: Generation }, ActionErrorCode> | RateLimited> {
  const { file, language } = input;
  if (
    file.byteLength === 0 ||
    file.byteLength > STT_MAX_UPLOAD_BYTES ||
    (language !== undefined && !(STT_LANGUAGES as readonly string[]).includes(language))
  ) {
    return { ok: false, error: "invalidInput" };
  }
  const pending = await db
    .select({ n: count() })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        eq(generations.type, "stt"),
        eq(generations.status, "pending"),
      ),
    )
    .get();
  if ((pending?.n ?? 0) >= STT_MAX_PENDING) return { ok: false, error: "limit" };

  const key = `stt:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.sttPerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);

  const prepared = await prepareAudio(deps.run, file);
  const seconds = prepared ? Math.max(0, prepared.seconds - ENCODER_PADDING_SECONDS) : 0;
  if (!prepared || seconds < STT_MIN_SECONDS || seconds > STT_MAX_SECONDS + 0.5) {
    return { ok: false, error: "invalidInput" };
  }
  const cost = sttCost(Math.min(seconds, STT_MAX_SECONDS));

  const id = randomUUID();
  const audioKey = `${userId}/${id}.mp3`;
  const row: GenerationRow = {
    id,
    userId,
    type: "stt",
    text: "",
    voiceId: null,
    style: language ?? null,
    images: null,
    audioKey,
    files: null,
    status: "pending",
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
  await deps.storage.put(audioKey, prepared.audio);
  // İş, kayıt görünür olmadan önce listeye girer: aradaki kontrol onu yarım sanmasın.
  const job: TranscribeJob = { cancelled: false };
  transcribeJobs.set(id, job);
  let charged = false;
  try {
    charged = await chargeAndRecord(db, userId, "voice", cost, row, now, {
      projectId: input.projectId,
      title: input.title?.trim() ? input.title : titleFromName(input.name),
    });
  } finally {
    if (!charged) {
      transcribeJobs.delete(id);
      await deps.storage.remove(audioKey);
    }
  }
  if (!charged) return { ok: false, error: "insufficient" };

  void runTranscription(db, deps, row, job, prepared.audio, language).catch((err: unknown) =>
    console.error("[yazı] yazıya dökme işi:", err instanceof Error ? err.message : err),
  );
  return { ok: true, generation: toGeneration(row) };
}

/**
 * Arka plan işi: kayıt yazıya dökülür, altyazı kurulur ve kayıt tamamlanır.
 * Servis hata verirse ya da kayıtta konuşma bulunamazsa kredi iade edilir ve
 * ses dosyası silinir. Bu arada kayıt silinmişse sonuç yazılmaz.
 */
async function runTranscription(
  db: Db,
  deps: TranscribeDeps,
  row: GenerationRow,
  job: TranscribeJob,
  audio: Uint8Array,
  language: string | undefined,
): Promise<void> {
  let captionsKey: string | null = null;
  try {
    const transcript = await transcribeWithRetry(deps, audio, { language });
    if (job.cancelled) throw new Error("üretim silindi");
    const cues = cuesFromWords(
      transcript.words.map((w) => ({
        text: w.text,
        start: Math.round(w.start * 1000),
        end: Math.round(w.end * 1000),
      })),
    );
    const text = cues.length ? cuesToText(cues) : transcript.text;
    if (!text) throw new Error("kayıtta konuşma bulunamadı");
    if (cues.length) {
      captionsKey = `${row.userId}/${row.id}-captions.json`;
      await deps.storage.put(captionsKey, encodeCues(cues));
    }
    const res = await db
      .update(generations)
      .set({ status: null, text, captionsKey, style: language ?? transcript.language })
      .where(and(eq(generations.id, row.id), eq(generations.status, "pending")));
    if (res.rowsAffected === 0 && captionsKey) await deps.storage.remove(captionsKey);
  } catch (err) {
    if (!job.cancelled) {
      console.error("[yazı] yazıya dökülemedi:", err instanceof Error ? err.message : err);
    }
    // Dosyalar kayıt başarısız görünmeden önce kaldırılır: kart olmayan sese bağlanmasın.
    // Kayıt silinmişse dosyaları zaten silinmiştir; tekrar silmek zararsızdır.
    await db
      .update(generations)
      .set({ audioKey: null, captionsKey: null })
      .where(and(eq(generations.id, row.id), eq(generations.status, "pending")));
    await Promise.all(
      [row.audioKey, captionsKey].flatMap((k) => (k ? [deps.storage.remove(k)] : [])),
    );
    await failGeneration(db, row);
  } finally {
    transcribeJobs.delete(row.id);
  }
}

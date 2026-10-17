import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, count, eq, inArray } from "drizzle-orm";

import { LIMITS } from "@/lib/rate-limit";
import type { Generation, RateLimited } from "@/lib/types";

import { cleanCues, encodeCues, parseCues, shiftCues, type Cue } from "./captions.server";
import {
  COMPOSE_FORMATS,
  COMPOSE_MAX_IMAGES,
  COMPOSE_MAX_SECONDS,
  assSubtitles,
  ffmpegArgs,
  imageDurations,
  type CaptionStyle,
  type ComposeFormat,
  type FfmpegRun,
} from "./compose.server";
import type { Db } from "./db.server";
import type { FileStorage } from "./file-storage.server";
import { composeJobs, type ComposeJob } from "./jobs.server";
import { concatBytes, mp3SampleRate, readMp3, silenceLike, sliceMp3 } from "./mp3.server";
import { generations } from "./schema.server";
import {
  blocked,
  chargeAndRecord,
  failGeneration,
  recordAttempt,
  toGeneration,
  type GenerationRow,
  type Result,
} from "./services.server";

/**
 * Medya düzenleyici: kırpma, birleştirme ve görsel düzenleme kaynak kaydı
 * değiştirmez; sonuç projede yeni bir sürüm olarak açılır ve kredi harcanmaz
 * (cost 0). Dosyalar yalnız sahibinin kayıtlarından okunur.
 */

export type EditErrorCode = "invalidInput" | "notFound" | "limit";
type EditResult = Result<{ generation: Generation }, EditErrorCode> | RateLimited;

/** Kırpılan ses en az bu kadar sürer. */
export const MIN_TRIM_MS = 500;

async function ownRow(db: Db, userId: string, id: string) {
  return db
    .select()
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.userId, userId)))
    .get();
}

async function limited(db: Db, userId: string, now: Date): Promise<RateLimited | null> {
  const key = `edit:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.editPerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);
  return null;
}

/** Yeni sürümün kaydı: kaynaktan metin, ses ve ayarlar; proje ve ad sahiplik denetimiyle. */
async function recordVersion(db: Db, userId: string, row: GenerationRow, now: Date) {
  await chargeAndRecord(db, userId, row.type === "tts" ? "voice" : "media", 0, row, now, {
    projectId: row.projectId ?? undefined,
    title: row.title ?? undefined,
  });
  return toGeneration(row);
}

/**
 * Sesi kırpar (yeniden kodlamadan, MP3 çerçeve sınırında) ve altyazısını yeni
 * başlangıca kaydırır. `cues` verilirse kaynak sesin zaman çizgisinde
 * kullanıcının düzelttiği altyazıdır; verilmezse kaynağın altyazısı kullanılır.
 * Tüm aralık seçilirse yalnız altyazısı düzeltilmiş bir kopya açılır.
 */
export async function trimSpeech(
  db: Db,
  storage: FileStorage,
  userId: string,
  input: { id: string; startMs: number; endMs: number; cues?: Cue[] | undefined },
  now: Date,
): Promise<EditResult> {
  const src = await ownRow(db, userId, input.id);
  if (!src || src.type !== "tts" || !src.audioKey || src.status) {
    return { ok: false, error: "notFound" };
  }
  const { startMs, endMs } = input;
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs - startMs < MIN_TRIM_MS
  ) {
    return { ok: false, error: "invalidInput" };
  }
  const stop = await limited(db, userId, now);
  if (stop) return stop;

  const audio = await storage.read(src.audioKey);
  if (!audio) return { ok: false, error: "notFound" };
  const cut = sliceMp3(audio, startMs / 1000, endMs / 1000);
  if (!cut) return { ok: false, error: "invalidInput" };

  let cues: Cue[] = [];
  if (input.cues) {
    const clean = cleanCues(input.cues, cut.total * 1000);
    if (!clean) return { ok: false, error: "invalidInput" };
    cues = clean;
  } else if (src.captionsKey) {
    const raw = await storage.read(src.captionsKey);
    cues = (raw && parseCues(raw)) || [];
  }
  const shifted = shiftCues(cues, cut.offset * 1000, cut.seconds * 1000);

  const id = randomUUID();
  const audioKey = `${userId}/${id}.mp3`;
  await storage.put(audioKey, cut.data);
  const captionsKey = shifted.length ? `${userId}/${id}-captions.json` : null;
  if (captionsKey) await storage.put(captionsKey, encodeCues(shifted));

  const generation = await recordVersion(
    db,
    userId,
    {
      ...src,
      id,
      audioKey,
      captionsKey,
      status: null,
      job: null,
      charges: null,
      cost: 0,
      editKind: "trim",
      sourceId: src.id,
      createdAt: now.toISOString(),
    },
    now,
  );
  return { ok: true, generation };
}

/** Tek seferde birleştirilebilecek ses sayısı. */
export const MERGE_MAX_CLIPS = 30;
/** Sesler arasına konabilecek sessizlik (ms). */
export const MERGE_GAPS = [0, 500, 1000, 2000] as const;
/** Birleştirme bellekte yapılır; seslerin toplam boyutu bunu aşamaz. */
export const MERGE_MAX_BYTES = 150 * 1024 * 1024;

/**
 * Seçilen sesleri verilen sırayla tek MP3'te, istenirse araya sessizlik
 * koyarak birleştirir (yeniden kodlamadan). Altyazılar her sesin birleşik
 * dosyadaki başlangıcına kaydırılır. Sonuç ücretsiz yeni kayıttır; proje
 * verilmezse projesiz açılır. Kaynak sesler değişmez.
 */
export async function mergeSpeech(
  db: Db,
  storage: FileStorage,
  userId: string,
  input: {
    ids: string[];
    gapMs: number;
    projectId?: string | undefined;
    title?: string | undefined;
  },
  now: Date,
): Promise<EditResult> {
  const { ids, gapMs } = input;
  if (
    ids.length < 2 ||
    ids.length > MERGE_MAX_CLIPS ||
    new Set(ids).size !== ids.length ||
    !(MERGE_GAPS as readonly number[]).includes(gapMs)
  ) {
    return { ok: false, error: "invalidInput" };
  }
  const rows = await db
    .select()
    .from(generations)
    .where(and(eq(generations.userId, userId), inArray(generations.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const clips = ids.map((id) => byId.get(id));
  if (clips.some((c) => !c || c.type !== "tts" || !c.audioKey || c.status)) {
    return { ok: false, error: "notFound" };
  }
  const stop = await limited(db, userId, now);
  if (stop) return stop;

  const files: Uint8Array[] = [];
  let size = 0;
  for (const c of clips) {
    const data = await storage.read(c!.audioKey!);
    if (!data) return { ok: false, error: "notFound" };
    size += data.byteLength;
    if (size > MERGE_MAX_BYTES) return { ok: false, error: "invalidInput" };
    files.push(data);
  }
  // Farklı örnekleme hızındaki çerçeveler tek dosyada çözülemez.
  const rate = mp3SampleRate(files[0]!);
  const parts = files.map((f) => (mp3SampleRate(f) === rate ? readMp3(f) : null));
  if (!rate || parts.some((p) => !p)) return { ok: false, error: "invalidInput" };
  const gap = gapMs > 0 ? silenceLike(files[0]!, gapMs / 1000) : null;

  const chunks: Uint8Array[] = [];
  const cues: Cue[] = [];
  let offset = 0;
  for (const [i, clip] of clips.entries()) {
    if (i > 0 && gap) {
      chunks.push(gap.data);
      offset += gap.seconds;
    }
    const raw = clip!.captionsKey ? await storage.read(clip!.captionsKey) : null;
    const at = Math.round(offset * 1000);
    for (const c of (raw && parseCues(raw)) || []) {
      cues.push({ start: c.start + at, end: c.end + at, text: c.text });
    }
    chunks.push(parts[i]!.data);
    offset += parts[i]!.seconds;
  }

  const id = randomUUID();
  const audioKey = `${userId}/${id}.mp3`;
  await storage.put(audioKey, concatBytes(chunks));
  const captionsKey = cues.length ? `${userId}/${id}-captions.json` : null;
  if (captionsKey) await storage.put(captionsKey, encodeCues(cues));

  const first = clips[0]!;
  const same = <T>(pick: (c: GenerationRow) => T) =>
    clips.every((c) => JSON.stringify(pick(c!)) === JSON.stringify(pick(first)));
  const generation = await recordVersion(
    db,
    userId,
    {
      id,
      userId,
      type: "tts",
      text: clips.map((c) => c!.text).join("\n\n"),
      voiceId: same((c) => c.voiceId) ? first.voiceId : null,
      style: null,
      images: null,
      audioKey,
      files: null,
      status: null,
      job: null,
      charges: null,
      projectId: input.projectId ?? null,
      title: input.title ?? null,
      voiceSettings: same((c) => c.voiceSettings) ? first.voiceSettings : null,
      captionsKey,
      editKind: "merge",
      sourceId: null,
      cost: 0,
      createdAt: now.toISOString(),
    },
    now,
  );
  return { ok: true, generation };
}

/** Düzenlenmiş görselin en büyük boyutu. */
export const MAX_EDIT_IMAGE_BYTES = 15 * 1024 * 1024;

const IMAGE_TYPES = {
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
} as const;

/**
 * Tarayıcıda düzenlenen (kırpılan, döndürülen, yazı eklenen) görseli yeni
 * sürüm olarak kaydeder. Yalnız JPEG ya da PNG kabul edilir; tür dosyanın ilk
 * baytlarından da doğrulanır. Kaynak kayıt değişmez, kredi harcanmaz.
 */
export async function saveImageEdit(
  db: Db,
  storage: FileStorage,
  userId: string,
  input: { sourceId: string; type: string; data: Uint8Array },
  now: Date,
): Promise<EditResult> {
  const src = await ownRow(db, userId, input.sourceId);
  if (!src || src.type !== "image" || !src.files?.length || src.status) {
    return { ok: false, error: "notFound" };
  }
  const kind = IMAGE_TYPES[input.type as keyof typeof IMAGE_TYPES];
  if (
    !kind ||
    input.data.byteLength === 0 ||
    input.data.byteLength > MAX_EDIT_IMAGE_BYTES ||
    !kind.magic.every((b, i) => input.data[i] === b)
  ) {
    return { ok: false, error: "invalidInput" };
  }
  const stop = await limited(db, userId, now);
  if (stop) return stop;

  const id = randomUUID();
  const key = `${userId}/${id}-0.${kind.ext}`;
  await storage.put(key, input.data);
  const generation = await recordVersion(
    db,
    userId,
    {
      ...src,
      id,
      images: null,
      files: [key],
      status: null,
      job: null,
      charges: null,
      cost: 0,
      editKind: "image",
      sourceId: src.id,
      createdAt: now.toISOString(),
    },
    now,
  );
  return { ok: true, generation };
}

/** Kullanıcı başına aynı anda hazırlanabilecek kısa video sayısı. */
export const COMPOSE_MAX_PENDING = 1;
/** Takılan ffmpeg bu süre sonunda durdurulur. */
const COMPOSE_TIMEOUT_MS = 20 * 60_000;

export interface ComposeDeps {
  run: FfmpegRun;
  /** ffmpeg altyazıyı videoya yazabiliyor mu (libass). */
  subtitles: boolean;
}

export interface ComposeInput {
  audioId: string;
  images: { id: string; index: number }[];
  format: ComposeFormat;
  captions: CaptionStyle;
  motion: boolean;
  projectId?: string | undefined;
  title?: string | undefined;
}

// Sunucu aynı anda tek video kodlar (işlemci diğer isteklere kalsın); işler sıraya girer.
let composeQueue: Promise<void> = Promise.resolve();

/**
 * Kısa video: seçilen seslendirme, görseller (verilen sırayla, ses süresine
 * eşit bölünerek) ve isteğe bağlı videoya yazılan altyazıdan MP4. İş arka
 * planda sıraya girer; kayıt hemen "pending" döner ve kartta yüzde görünür.
 * Kredi harcanmaz; kaynaklar değişmez.
 */
export async function startCompose(
  db: Db,
  storage: FileStorage,
  deps: ComposeDeps,
  userId: string,
  input: ComposeInput,
  now: Date,
): Promise<EditResult> {
  const { images, format, captions } = input;
  if (
    !(format in COMPOSE_FORMATS) ||
    images.length < 1 ||
    images.length > COMPOSE_MAX_IMAGES ||
    images.some((r) => !Number.isInteger(r.index) || r.index < 0) ||
    !["bottom", "middle"].includes(captions.position) ||
    !["s", "m", "l"].includes(captions.size)
  ) {
    return { ok: false, error: "invalidInput" };
  }
  const audio = await ownRow(db, userId, input.audioId);
  if (!audio || audio.type !== "tts" || !audio.audioKey || audio.status) {
    return { ok: false, error: "notFound" };
  }
  const ids = [...new Set(images.map((r) => r.id))];
  const rows = await db
    .select()
    .from(generations)
    .where(and(eq(generations.userId, userId), inArray(generations.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const keys = images.map((r) => {
    const row = byId.get(r.id);
    return row?.type === "image" && !row.status ? row.files?.[r.index] : undefined;
  });
  if (keys.some((k) => !k)) return { ok: false, error: "notFound" };

  const pending = await db
    .select({ n: count() })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        eq(generations.editKind, "compose"),
        eq(generations.status, "pending"),
      ),
    )
    .get();
  if ((pending?.n ?? 0) >= COMPOSE_MAX_PENDING) return { ok: false, error: "limit" };

  const audioData = await storage.read(audio.audioKey);
  const seconds = audioData ? readMp3(audioData)?.seconds : undefined;
  if (!audioData || !seconds) return { ok: false, error: "notFound" };
  if (seconds > COMPOSE_MAX_SECONDS) return { ok: false, error: "invalidInput" };

  const stop = await limited(db, userId, now);
  if (stop) return stop;

  const id = randomUUID();
  const row: GenerationRow = {
    id,
    userId,
    type: "video",
    text: audio.text,
    voiceId: null,
    style: null,
    images: null,
    audioKey: null,
    files: null,
    status: "pending",
    job: null,
    charges: null,
    projectId: input.projectId ?? null,
    title: input.title ?? null,
    voiceSettings: null,
    captionsKey: null,
    editKind: "compose",
    sourceId: audio.id,
    cost: 0,
    createdAt: now.toISOString(),
  };
  // İş, kayıt görünür olmadan önce listeye girer: aradaki kontrol onu yarım sanmasın.
  const ctrl = new AbortController();
  const job: ComposeJob = {
    percent: 0,
    cancelled: false,
    cancel: () => {
      job.cancelled = true;
      ctrl.abort();
    },
  };
  composeJobs.set(id, job);
  let generation: Generation;
  try {
    generation = await recordVersion(db, userId, row, now);
  } catch (err) {
    composeJobs.delete(id);
    throw err;
  }

  const work = {
    audio: audioData,
    captionsKey: captions.show && deps.subtitles ? audio.captionsKey : null,
    imageKeys: keys as string[],
    seconds,
  };
  composeQueue = composeQueue.then(() =>
    runCompose(db, storage, deps, row, job, ctrl.signal, input, work).catch((err: unknown) =>
      console.error("[video] oluşturma işi:", err instanceof Error ? err.message : err),
    ),
  );
  return { ok: true, generation };
}

async function runCompose(
  db: Db,
  storage: FileStorage,
  deps: ComposeDeps,
  row: GenerationRow,
  job: ComposeJob,
  signal: AbortSignal,
  input: ComposeInput,
  work: { audio: Uint8Array; captionsKey: string | null; imageKeys: string[]; seconds: number },
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "trai-compose-"));
  try {
    if (job.cancelled) throw new Error("üretim silindi");
    await writeFile(join(dir, "audio.mp3"), work.audio);
    const images: string[] = [];
    for (const [i, key] of work.imageKeys.entries()) {
      const data = await storage.read(key);
      if (!data) throw new Error("görsel dosyası okunamadı");
      const name = `img-${i}.${key.slice(key.lastIndexOf(".") + 1)}`;
      await writeFile(join(dir, name), data);
      images.push(name);
    }
    let subtitles: string | null = null;
    if (work.captionsKey) {
      const raw = await storage.read(work.captionsKey);
      const cues = (raw && parseCues(raw)) || [];
      if (cues.length) {
        subtitles = "subs.ass";
        await writeFile(join(dir, subtitles), assSubtitles(cues, input.format, input.captions));
      }
    }
    const args = ffmpegArgs({
      images,
      durations: imageDurations(work.seconds, images.length),
      audio: "audio.mp3",
      subtitles,
      format: input.format,
      motion: input.motion,
      output: "out.mp4",
    });
    await deps.run(
      args,
      dir,
      (s) => {
        job.percent = Math.min(99, Math.max(job.percent, Math.round((s / work.seconds) * 100)));
      },
      AbortSignal.any([signal, AbortSignal.timeout(COMPOSE_TIMEOUT_MS)]),
    );
    const video = new Uint8Array(await readFile(join(dir, "out.mp4")));
    const key = `${row.userId}/${row.id}-0.mp4`;
    await storage.put(key, video);
    const res = await db
      .update(generations)
      .set({ status: null, files: [key] })
      .where(and(eq(generations.id, row.id), eq(generations.status, "pending")));
    if (res.rowsAffected === 0) await storage.remove(key);
  } catch (err) {
    if (!job.cancelled) {
      console.error("[video] oluşturulamadı:", err instanceof Error ? err.message : err);
    }
    await failGeneration(db, row);
  } finally {
    composeJobs.delete(row.id);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

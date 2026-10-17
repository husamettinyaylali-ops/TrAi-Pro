import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { LIMITS } from "@/lib/rate-limit";
import type { Generation, RateLimited } from "@/lib/types";

import { cleanCues, encodeCues, parseCues, shiftCues, type Cue } from "./captions.server";
import type { Db } from "./db.server";
import type { FileStorage } from "./file-storage.server";
import { concatBytes, mp3SampleRate, readMp3, silenceLike, sliceMp3 } from "./mp3.server";
import { generations } from "./schema.server";
import {
  blocked,
  chargeAndRecord,
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

export type EditErrorCode = "invalidInput" | "notFound";
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

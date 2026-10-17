import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { LIMITS } from "@/lib/rate-limit";
import type { Generation, RateLimited } from "@/lib/types";

import { cleanCues, encodeCues, parseCues, shiftCues, type Cue } from "./captions.server";
import type { Db } from "./db.server";
import type { FileStorage } from "./file-storage.server";
import { sliceMp3 } from "./mp3.server";
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

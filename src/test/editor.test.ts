// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { envelope, bucketPeaks, silenceBounds } from "@/components/editor/audio-analysis";
import { editorBlock } from "@/components/editor/utils";
import { balance } from "@/lib/credits";
import { LIMITS } from "@/lib/rate-limit";
import { cleanCues, encodeCues, parseCues, shiftCues } from "@/server/captions.server";
import { openDb, type Db } from "@/server/db.server";
import { MERGE_MAX_CLIPS, MIN_TRIM_MS, mergeSpeech, trimSpeech } from "@/server/editor.server";
import { localFileStorage, type FileStorage } from "@/server/file-storage.server";
import { serveSubtitle } from "@/server/media.server";
import { readMp3, silenceLike, sliceMp3 } from "@/server/mp3.server";
import { createProject } from "@/server/projects.server";
import { generations } from "@/server/schema.server";
import {
  createSession,
  getGeneration,
  loadUserData,
  markEmailVerified,
  registerUser,
} from "@/server/services.server";

import { FRAME_BYTES, FRAME_SECONDS, mp3Frames } from "./speech-fixtures";

const now = new Date("2026-10-17T12:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-editor-"));
let db: Db;
let storage: FileStorage;

beforeEach(async () => {
  db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
  storage = localFileStorage(join(dir, `media-${randomUUID()}`));
});
afterEach(() => db.$client.close());
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

async function newUser(email = "duzen@example.com") {
  const res = await registerUser(db, { name: "Düzen", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, now);
  return res.userId;
}

const FRAME_MS = FRAME_SECONDS * 1000;
const CUES = [
  { start: 0, end: 900, text: "Merhaba." },
  { start: 1000, end: 2000, text: "Bugün düzenleyiciyi deniyoruz." },
  { start: 2100, end: 2550, text: "Son." },
];

/** 100 çerçevelik (~2,6 sn) gerçek seslendirme kaydı; istenirse altyazılı, projede, başka sesle. */
async function speech(
  userId: string,
  opts: { captions?: boolean; projectId?: string; voiceId?: string; audio?: Uint8Array } = {},
) {
  const id = randomUUID();
  const audioKey = `${userId}/${id}.mp3`;
  await storage.put(audioKey, opts.audio ?? mp3Frames(100, { id3: true, info: true }));
  const captionsKey = opts.captions === false ? null : `${userId}/${id}-captions.json`;
  if (captionsKey) await storage.put(captionsKey, encodeCues(CUES));
  await db.insert(generations).values({
    id,
    userId,
    type: "tts",
    text: "Merhaba. Bugün düzenleyiciyi deniyoruz. Son.",
    voiceId: opts.voiceId ?? "hazir-1",
    voiceSettings: { speed: 1.1, stability: 0.5, similarity: 0.75, style: 0 },
    audioKey,
    captionsKey,
    projectId: opts.projectId ?? null,
    title: "Giriş",
    cost: 44,
    createdAt: now.toISOString(),
  });
  return id;
}

describe("MP3 kesme ve sessizlik", () => {
  it("aralığa değen çerçeveler alınır; başlangıç çerçeve sınırına yuvarlanır", () => {
    const file = mp3Frames(100, { id3: true, info: true });
    const cut = sliceMp3(file, 10.5 * FRAME_SECONDS, 20 * FRAME_SECONDS)!;
    expect(cut.offset).toBeCloseTo(10 * FRAME_SECONDS, 9);
    expect(cut.seconds).toBeCloseTo(10 * FRAME_SECONDS, 9);
    expect(cut.total).toBeCloseTo(100 * FRAME_SECONDS, 9);
    expect(cut.data.byteLength).toBe(10 * FRAME_BYTES);
    expect(readMp3(cut.data)?.seconds).toBeCloseTo(10 * FRAME_SECONDS, 9);
    expect(sliceMp3(file, 200, 300)).toBeNull();
  });

  it("sessiz çerçeveler kaynakla aynı biçimde, CRC'siz ve dolgusuz", () => {
    const silence = silenceLike(mp3Frames(3), 1)!;
    const frames = Math.round(1 / FRAME_SECONDS);
    expect(silence.data.byteLength).toBe(frames * FRAME_BYTES);
    expect(silence.seconds).toBeCloseTo(frames * FRAME_SECONDS, 9);
    expect([...silence.data.subarray(0, 4)]).toEqual([0xff, 0xfb, 0x90, 0x44]);
    expect(silence.data.subarray(4, FRAME_BYTES).every((b) => b === 0)).toBe(true);
    expect(readMp3(silence.data)?.seconds).toBeCloseTo(silence.seconds, 9);
    expect(silenceLike(mp3Frames(3), 0)?.data.byteLength).toBe(0);
  });
});

describe("altyazı kaydırma ve düzeltme", () => {
  it("kesime göre kayar; dışarıda kalan atılır, taşan kırpılır", () => {
    expect(shiftCues(CUES, 950, 1300)).toEqual([
      { start: 50, end: 1050, text: "Bugün düzenleyiciyi deniyoruz." },
      { start: 1150, end: 1300, text: "Son." },
    ]);
  });

  it("düzeltilen metin temizlenir; boş satır silinir, en çok iki satır kalır, sıralanır", () => {
    expect(
      cleanCues(
        [
          { start: 2000, end: 9000, text: "  son\u0007 satır " },
          { start: -50, end: 500, text: "bir\niki\nüç" },
          { start: 600, end: 900, text: "   " },
        ],
        2500,
      ),
    ).toEqual([
      { start: 0, end: 500, text: "bir\niki" },
      { start: 2000, end: 2500, text: "son satır" },
    ]);
    expect(cleanCues([{ start: 0, end: 1, text: "x".repeat(201) }], 1000)).toBeNull();
    expect(cleanCues([{ start: Number.NaN, end: 1, text: "x" }], 1000)).toBeNull();
  });
});

describe("ses dalgası analizi", () => {
  it("zarf 10 ms pencerelerde tepe; sütunlar en yükseğe göre ölçeklenir", () => {
    const rate = 1000;
    const ch = new Float32Array(100);
    ch[5] = -0.5;
    ch[25] = 0.25;
    const env = envelope([ch], rate);
    expect([...env.slice(0, 3)]).toEqual([0.5, 0, 0.25]);
    expect(bucketPeaks(env, 5)).toEqual([1, 0.5, 0, 0, 0]);
  });

  it("baştaki ve sondaki sessizlik paylarla bulunur; hiç ses yoksa null", () => {
    const env = new Float32Array(300);
    env.fill(0.5, 100, 200);
    expect(silenceBounds(env)).toEqual({ start: 880, end: 2200 });
    expect(silenceBounds(new Float32Array(50))).toBeNull();
  });
});

describe("ses kırpma", () => {
  it("yeni sürüm ücretsiz açılır; ses kırpılır, altyazı kayar, kaynak değişmez", async () => {
    const user = await newUser();
    const p = await createProject(db, user, { name: "Bölüm 1" }, now);
    if (!p.ok) throw new Error(p.error);
    const src = await speech(user, { projectId: p.project.id });
    const before = balance((await loadUserData(db, user)).grants, "voice", now);

    const res = await trimSpeech(
      db,
      storage,
      user,
      { id: src, startMs: 30 * FRAME_MS, endMs: 90 * FRAME_MS },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    const g = res.generation;
    expect(g).toMatchObject({
      type: "tts",
      cost: 0,
      edit: "trim",
      sourceId: src,
      projectId: p.project.id,
      title: "Giriş",
      voiceId: "hazir-1",
      text: "Merhaba. Bugün düzenleyiciyi deniyoruz. Son.",
      voiceSettings: { speed: 1.1 },
    });
    expect(g.id).not.toBe(src);
    expect((await storage.read(`${user}/${g.id}.mp3`))?.byteLength).toBe(60 * FRAME_BYTES);
    const cues = parseCues((await storage.read(`${user}/${g.id}-captions.json`))!)!;
    const offset = Math.round(30 * FRAME_MS);
    const length = Math.round(60 * FRAME_MS);
    expect(cues).toEqual([
      { start: 0, end: 900 - offset, text: "Merhaba." },
      { start: 1000 - offset, end: 2000 - offset, text: "Bugün düzenleyiciyi deniyoruz." },
      { start: 2100 - offset, end: length, text: "Son." },
    ]);
    expect(balance((await loadUserData(db, user)).grants, "voice", now)).toBe(before);
    // Kaynak olduğu gibi.
    const original = await getGeneration(db, user, src);
    expect(original?.edit).toBeUndefined();
    expect((await storage.read(`${user}/${src}.mp3`))?.byteLength).toBeGreaterThan(
      100 * FRAME_BYTES,
    );
  });

  it("tüm aralıkta yalnız altyazı düzeltilir; düzeltilmiş metin kullanılır", async () => {
    const user = await newUser();
    const src = await speech(user);
    const res = await trimSpeech(
      db,
      storage,
      user,
      {
        id: src,
        startMs: 0,
        endMs: 100 * FRAME_MS,
        cues: [
          CUES[0]!,
          { ...CUES[1]!, text: "Bugün editörü deniyoruz." },
          { ...CUES[2]!, text: "" },
        ],
      },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    const cues = parseCues((await storage.read(`${user}/${res.generation.id}-captions.json`))!)!;
    expect(cues.map((c) => c.text)).toEqual(["Merhaba.", "Bugün editörü deniyoruz."]);
    expect((await storage.read(`${user}/${res.generation.id}.mp3`))?.byteLength).toBe(
      100 * FRAME_BYTES,
    );
  });

  it("altyazısız seste altyazı dosyası açılmaz", async () => {
    const user = await newUser();
    const src = await speech(user, { captions: false });
    const res = await trimSpeech(db, storage, user, { id: src, startMs: 0, endMs: 1000 }, now);
    if (!res.ok) throw new Error(res.error);
    expect(res.generation.subtitleUrl).toBeUndefined();
  });

  it("başkasının, demo ya da bekleyen kaydı bulunamaz; kısa ya da geçersiz aralık reddedilir", async () => {
    const owner = await newUser("sahip@example.com");
    const other = await newUser("baska@example.com");
    const src = await speech(owner);
    expect(await trimSpeech(db, storage, other, { id: src, startMs: 0, endMs: 1000 }, now)).toEqual(
      { ok: false, error: "notFound" },
    );
    const demo = randomUUID();
    await db.insert(generations).values({
      id: demo,
      userId: owner,
      type: "tts",
      text: "demo",
      cost: 4,
      createdAt: now.toISOString(),
    });
    expect(
      await trimSpeech(db, storage, owner, { id: demo, startMs: 0, endMs: 1000 }, now),
    ).toEqual({ ok: false, error: "notFound" });
    for (const [startMs, endMs] of [
      [0, MIN_TRIM_MS - 1],
      [-10, 1000],
      [Number.NaN, 1000],
      [60_000, 70_000],
    ] as const) {
      expect(await trimSpeech(db, storage, owner, { id: src, startMs, endMs }, now)).toEqual({
        ok: false,
        error: "invalidInput",
      });
    }
  });

  it(`saatte en çok ${LIMITS.editPerUser.max} düzenleme`, async () => {
    const user = await newUser();
    const src = await speech(user, { captions: false });
    for (let i = 0; i < LIMITS.editPerUser.max; i++) {
      await trimSpeech(db, storage, user, { id: src, startMs: 0, endMs: 1000 }, now);
    }
    expect(
      await trimSpeech(db, storage, user, { id: src, startMs: 0, endMs: 1000 }, now),
    ).toMatchObject({ ok: false, error: "tooManyAttempts" });
  });

  it("altyazı düzenleyici için JSON olarak da okunur", async () => {
    const user = await newUser();
    const src = await speech(user);
    const { token } = await createSession(db, user, now);
    const res = await serveSubtitle(
      new Request(`http://localhost/media/subtitle/${src}?format=json`, {
        headers: { cookie: `trai_session=${encodeURIComponent(token)}` },
      }),
      src,
      { db, storage, now },
    );
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ cues: CUES });
  });
});

describe("düzenleyiciye açılabilirlik", () => {
  const base = { id: "x", text: "t", cost: 1, createdAt: "" };
  it("yalnız gerçek dosyası olan, tamamlanmış seslendirme açılır", () => {
    expect(editorBlock({ ...base, type: "tts", audioUrl: "/a" })).toBeNull();
    expect(editorBlock({ ...base, type: "tts" })).toBe("demo");
    expect(editorBlock({ ...base, type: "tts", status: "pending" })).toBe("pending");
    expect(editorBlock({ ...base, type: "tts", status: "failed" })).toBe("failed");
    expect(editorBlock({ ...base, type: "video", fileUrls: ["/v"] })).toBe("unsupported");
  });
});

describe("sesleri birleştirme", () => {
  it("verilen sırayla, araya sessizlikle tek dosya; altyazılar kayar, sonuç ücretsiz", async () => {
    const user = await newUser();
    const p = await createProject(db, user, { name: "Bölüm 2" }, now);
    if (!p.ok) throw new Error(p.error);
    const a = await speech(user);
    const b = await speech(user, { captions: false });
    const c = await speech(user);
    const res = await mergeSpeech(
      db,
      storage,
      user,
      { ids: [c, a, b], gapMs: 500, projectId: p.project.id, title: "Tam bölüm" },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    const g = res.generation;
    expect(g).toMatchObject({
      type: "tts",
      cost: 0,
      edit: "merge",
      projectId: p.project.id,
      title: "Tam bölüm",
      voiceId: "hazir-1",
    });
    expect(g.sourceId).toBeUndefined();
    expect(g.text.split("\n\n")).toHaveLength(3);

    const gapFrames = Math.round(0.5 / FRAME_SECONDS);
    const audio = (await storage.read(`${user}/${g.id}.mp3`))!;
    expect(audio.byteLength).toBe((300 + 2 * gapFrames) * FRAME_BYTES);
    expect(readMp3(audio)?.seconds).toBeCloseTo((300 + 2 * gapFrames) * FRAME_SECONDS, 6);

    // Sıra c, a, b: c'nin altyazısı 0'dan, a'nınki bir ses ve bir boşluk sonra; b'nin altyazısı yok.
    const cues = parseCues((await storage.read(`${user}/${g.id}-captions.json`))!)!;
    const second = Math.round((100 + gapFrames) * FRAME_MS);
    expect(cues.map((x) => x.start)).toEqual([0, 1000, 2100, second, second + 1000, second + 2100]);
  });

  it("sesler farklıysa ses alanı boş kalır; sessizlik verilmezse uç uca eklenir; proje verilmezse projesiz", async () => {
    const user = await newUser();
    const p = await createProject(db, user, { name: "Bölüm 3" }, now);
    if (!p.ok) throw new Error(p.error);
    const a = await speech(user, { projectId: p.project.id });
    const b = await speech(user, { voiceId: "hazir-2", projectId: p.project.id });
    const res = await mergeSpeech(db, storage, user, { ids: [a, b], gapMs: 0 }, now);
    if (!res.ok) throw new Error(res.error);
    expect(res.generation.voiceId).toBeUndefined();
    expect(res.generation.projectId).toBeUndefined();
    expect((await storage.read(`${user}/${res.generation.id}.mp3`))?.byteLength).toBe(
      200 * FRAME_BYTES,
    );
  });

  it("geçersiz istek, başkasının sesi ve farklı örnekleme hızı reddedilir", async () => {
    const user = await newUser("sahip@example.com");
    const other = await newUser("baska@example.com");
    const a = await speech(user);
    const b = await speech(user);
    const foreign = await speech(other);
    for (const input of [
      { ids: [a], gapMs: 0 },
      { ids: [a, a], gapMs: 0 },
      { ids: [a, b], gapMs: 300 },
      { ids: Array.from({ length: MERGE_MAX_CLIPS + 1 }, () => randomUUID()), gapMs: 0 },
    ]) {
      expect(await mergeSpeech(db, storage, user, input, now)).toEqual({
        ok: false,
        error: "invalidInput",
      });
    }
    expect(await mergeSpeech(db, storage, user, { ids: [a, foreign], gapMs: 0 }, now)).toEqual({
      ok: false,
      error: "notFound",
    });
    // 48 kHz çerçeveler (384 bayt): 44,1 kHz sesle tek dosyada çözülemez.
    const frame48 = new Uint8Array(384);
    frame48.set([0xff, 0xfb, 0x94, 0x44]);
    const audio48 = new Uint8Array(384 * 10);
    for (let i = 0; i < 10; i++) audio48.set(frame48, i * 384);
    const c = await speech(user, { audio: audio48 });
    expect(await mergeSpeech(db, storage, user, { ids: [a, c], gapMs: 0 }, now)).toEqual({
      ok: false,
      error: "invalidInput",
    });
  });
});

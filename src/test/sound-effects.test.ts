// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { balance, sfxCost } from "@/lib/credits";
import {
  decodeEffect,
  encodeEffect,
  roundDuration,
  validDuration,
  type EffectOptions,
} from "@/lib/sound-effects";
import { createApiKey } from "@/server/api-keys.server";
import { openDb, type Db } from "@/server/db.server";
import { trimSpeech } from "@/server/editor.server";
import { localFileStorage, type FileStorage } from "@/server/file-storage.server";
import { createProject } from "@/server/projects.server";
import { handleApi, type ApiDeps } from "@/server/public-api.server";
import { generations } from "@/server/schema.server";
import {
  listGenerations,
  loadUserData,
  markEmailVerified,
  registerUser,
} from "@/server/services.server";
import {
  elevenLabsSfx,
  generateSoundEffect,
  type SfxProvider,
} from "@/server/sound-effects.server";
import { TtsError } from "@/server/tts.server";

import { FRAME_SECONDS, mp3Frames } from "./speech-fixtures";

const now = new Date("2026-10-19T10:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-sfx-test-"));
let db: Db;
let storage: FileStorage;

function useDb() {
  beforeEach(async () => {
    db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
    storage = localFileStorage(join(dir, `media-${randomUUID()}`));
  });
  afterEach(() => db.$client.close());
}
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

describe("ses efekti seçenekleri", () => {
  it("süre ve döngü kısa metne yazılır, geri okunur; bozuk değer otomatik sayılır", () => {
    const cases: [EffectOptions, string][] = [
      [{ duration: null, loop: false }, "auto"],
      [{ duration: 5, loop: false }, "5"],
      [{ duration: 2.5, loop: true }, "2.5+loop"],
      [{ duration: null, loop: true }, "auto+loop"],
    ];
    for (const [o, s] of cases) {
      expect(encodeEffect(o)).toBe(s);
      expect(decodeEffect(s)).toEqual(o);
    }
    expect(decodeEffect(null)).toEqual({ duration: null, loop: false });
    expect(decodeEffect("99")).toEqual({ duration: null, loop: false });
  });

  it("süre 0,5–30 sn ya da otomatik; ondalık bire yuvarlanır", () => {
    expect([null, 0.5, 30, 12.3].every(validDuration)).toBe(true);
    expect([0.4, 30.1, Number.NaN, Infinity].some(validDuration)).toBe(false);
    expect(roundDuration(2.345)).toBe(2.3);
    expect(roundDuration(null)).toBeNull();
  });

  it("ElevenLabs isteği: model, süre ve döngü yalnız seçilince; hata ve geçersiz ses", async () => {
    const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    let reply = () => new Response(new Uint8Array(mp3Frames(5)));
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return reply();
    }) as unknown as typeof fetch;
    const sfx = elevenLabsSfx({ apiKey: "test-anahtar", baseUrl: "https://eu.example", fetchImpl });
    expect(await sfx.generate("kapı gıcırtısı", { duration: 3, loop: true })).toEqual(mp3Frames(5));
    await sfx.generate("yağmur", { duration: null, loop: false });
    expect(seen[0]!.url).toBe("https://eu.example/v1/sound-generation?output_format=mp3_44100_128");
    expect(seen[0]!.headers.get("xi-api-key")).toBe("test-anahtar");
    expect(seen[0]!.body).toEqual({
      text: "kapı gıcırtısı",
      model_id: "eleven_text_to_sound_v2",
      duration_seconds: 3,
      loop: true,
    });
    expect(seen[1]!.body).toEqual({ text: "yağmur", model_id: "eleven_text_to_sound_v2" });

    reply = () => new Response("kota", { status: 429 });
    await expect(sfx.generate("x", { duration: null, loop: false })).rejects.toMatchObject({
      status: 429,
    });
    reply = () => new Response(new Uint8Array([1, 2, 3]));
    await expect(sfx.generate("x", { duration: null, loop: false })).rejects.toBeInstanceOf(
      TtsError,
    );
  });
});

async function newUser(email = "efekt@example.com") {
  const res = await registerUser(db, { name: "Efekt", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, now);
  return res.userId;
}

const voiceCredits = async (userId: string) =>
  balance((await loadUserData(db, userId, now)).grants, "voice", now);

function fakeSfx(fail?: Error) {
  const calls: { text: string; opts: EffectOptions }[] = [];
  const sfx: SfxProvider = {
    async generate(text, opts) {
      calls.push({ text, opts });
      if (fail) throw fail;
      return mp3Frames(200);
    },
  };
  return { sfx, calls };
}

describe("ses efekti üretimi", () => {
  useDb();

  it("süreye göre kredi düşer, ses kaydedilir; projede ve geçmişte kendi türüyle", async () => {
    const user = await newUser();
    const project = await createProject(db, user, { name: "Belgesel" }, now);
    if (!project.ok) throw new Error(project.error);
    const { sfx, calls } = fakeSfx();
    const res = await generateSoundEffect(
      db,
      { sfx, storage },
      user,
      {
        text: "  uzaktan gök gürültüsü  ",
        duration: 4.96,
        loop: true,
        projectId: project.project.id,
      },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    expect(calls).toEqual([{ text: "uzaktan gök gürültüsü", opts: { duration: 5, loop: true } }]);
    expect(res.generation).toMatchObject({
      type: "sfx",
      text: "uzaktan gök gürültüsü",
      cost: sfxCost(5),
      effect: { duration: 5, loop: true },
      audioUrl: `/media/audio/${res.generation.id}`,
      projectId: project.project.id,
    });
    expect(res.generation.style).toBeUndefined();
    expect(await voiceCredits(user)).toBe(5_000 - 200);
    expect(await storage.read(`${user}/${res.generation.id}.mp3`)).toEqual(mp3Frames(200));
    expect((await listGenerations(db, user, { type: "sfx" })).items).toHaveLength(1);
    expect((await listGenerations(db, user, { type: "audio" })).items).toEqual([]);

    const auto = await generateSoundEffect(
      db,
      { sfx, storage },
      user,
      { text: "kuş sesleri", duration: null, loop: false },
      now,
    );
    if (!auto.ok) throw new Error(auto.error);
    expect(auto.generation).toMatchObject({ cost: 200, effect: { duration: null, loop: false } });
  });

  it("geçersiz girdi, yetersiz kredi ve servis hatasında kredi düşmez, kayıt açılmaz", async () => {
    const user = await newUser();
    const { sfx, calls } = fakeSfx();
    for (const input of [
      { text: "  ", duration: null, loop: false },
      { text: "ş".repeat(401), duration: null, loop: false },
      { text: "rüzgâr", duration: 0.2, loop: false },
      { text: "rüzgâr", duration: 31, loop: false },
    ]) {
      expect(await generateSoundEffect(db, { sfx, storage }, user, input, now)).toEqual({
        ok: false,
        error: "invalidInput",
      });
    }
    expect(calls).toEqual([]);

    await db.$client.execute("update credit_grants set remaining = 100");
    expect(
      await generateSoundEffect(
        db,
        { sfx, storage },
        user,
        { text: "rüzgâr", duration: 3, loop: false },
        now,
      ),
    ).toEqual({ ok: false, error: "insufficient" });
    expect(calls).toEqual([]);

    await db.$client.execute("update credit_grants set remaining = 5000");
    const broken = fakeSfx(new TtsError("hata", 500));
    expect(
      await generateSoundEffect(
        db,
        { sfx: broken.sfx, storage },
        user,
        { text: "rüzgâr", duration: 3, loop: false },
        now,
      ),
    ).toEqual({ ok: false, error: "providerFailed" });
    expect(await voiceCredits(user)).toBe(5_000);
    expect(await db.select().from(generations)).toEqual([]);
  });

  it("düzenleyicide kırpılan efektin süresi güncellenir, döngü düşer; tümü seçilirse kalır", async () => {
    const user = await newUser();
    const res = await generateSoundEffect(
      db,
      { sfx: fakeSfx().sfx, storage },
      user,
      { text: "dalga", duration: 5, loop: true },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    const total = 200 * FRAME_SECONDS * 1000;
    const cut = await trimSpeech(
      db,
      storage,
      user,
      { id: res.generation.id, startMs: 0, endMs: 2000 },
      now,
    );
    if (!cut.ok) throw new Error(cut.error);
    expect(cut.generation).toMatchObject({ type: "sfx", edit: "trim", cost: 0, text: "dalga" });
    expect(cut.generation.effect?.loop).toBe(false);
    expect(cut.generation.effect?.duration).toBeCloseTo(2, 0);
    const whole = await trimSpeech(
      db,
      storage,
      user,
      { id: res.generation.id, startMs: 0, endMs: total },
      now,
    );
    if (!whole.ok) throw new Error(whole.error);
    expect(whole.generation.effect).toEqual({ duration: 5.2, loop: true });
  });
});

describe("geliştirici API'si: ses efekti", () => {
  useDb();

  const call = (key: string, body: unknown, d: Partial<ApiDeps>) =>
    handleApi(
      new Request("https://trai.example/api/v1/sound-effects", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      "sound-effects",
      { db: async () => db, now: () => now, storage, speech: null, image: null, video: null, ...d },
    );

  it("üretir (201), süre ve döngü yanıtta; kapalıysa 503, geçersiz süre 400", async () => {
    const user = await newUser();
    const key = await createApiKey(db, user, "x", now);
    if (!key.ok) throw new Error(key.error);
    const on = { sfx: { sfx: fakeSfx().sfx, storage } };
    const res = await call(key.key, { prompt: "kapı çalınıyor", duration_seconds: 2 }, on);
    expect(res.status).toBe(201);
    const g = (await res.json()) as Record<string, unknown>;
    expect(g).toMatchObject({
      type: "sfx",
      status: "completed",
      prompt: "kapı çalınıyor",
      cost: 80,
      duration_seconds: 2,
      loop: false,
    });
    expect(g["files"]).toEqual([
      `https://trai.example/api/v1/generations/${String(g["id"])}/files/0`,
    ]);

    const auto = await call(key.key, { prompt: "orman", loop: true }, on);
    expect(await auto.json()).toMatchObject({ cost: 200, duration_seconds: null, loop: true });
    expect((await call(key.key, { prompt: "x" }, {})).status).toBe(503);
    expect((await call(key.key, { prompt: "x", duration_seconds: 45 }, on)).status).toBe(400);
  });
});

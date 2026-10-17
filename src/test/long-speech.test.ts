// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { balance } from "@/lib/credits";
import { createApiKey } from "@/server/api-keys.server";
import { parseCues } from "@/server/captions.server";
import { openDb, type Db } from "@/server/db.server";
import { localFileStorage, type FileStorage } from "@/server/file-storage.server";
import { serveSubtitle } from "@/server/media.server";
import { handleApi } from "@/server/public-api.server";
import {
  SPEECH_MAX_PENDING,
  createSession,
  demoTopUp,
  failOrphanSpeech,
  generateSpeech,
  getGeneration,
  loadUserData,
  markEmailVerified,
  purchasePackage,
  refreshPending,
  registerUser,
  removeGeneration,
  type SpeechDeps,
} from "@/server/services.server";
import { TtsError, type SpeechContext, type TtsProvider } from "@/server/tts.server";

import { FRAME_BYTES, FRAME_SECONDS, fakeAlignment, mp3Frames } from "./speech-fixtures";

const now = new Date("2026-10-17T09:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-long-"));
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

/** Doğrulanmış, 250 bin ses kredili kullanıcı (deneme 5.000 + paket). */
async function newUser(email = "uzun@example.com") {
  const res = await registerUser(db, { name: "Uzun", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, now);
  await demoTopUp(db, res.userId, 1_000, now);
  const bought = await purchasePackage(db, res.userId, { packageId: "voice-250k" }, now);
  if (!bought.ok) throw new Error(bought.error);
  return res.userId;
}

const voiceCredits = async (id: string) =>
  balance((await loadUserData(db, id)).grants, "voice", now);

/** 5.000 karakteri aşan, iki parçaya bölünen metin. */
const LONG = Array.from({ length: 220 }, (_, i) => `Bu ${i + 1}. deneme cümlesidir.`).join(" ");
const CHUNK_FRAMES = 40;

type Synth = TtsProvider["synthesize"];

function fakeTts(synth?: Synth) {
  const calls: { text: string; context: SpeechContext | undefined }[] = [];
  const tts: TtsProvider = {
    listVoices: async () => [],
    synthesize:
      synth ??
      (async (_voice, text, _settings, context) => {
        calls.push({ text, context });
        return {
          audio: mp3Frames(CHUNK_FRAMES, { id3: true, info: true }),
          alignment: fakeAlignment(text, 0.0005),
        };
      }),
    cloneVoice: async () => "x",
    deleteVoice: async () => {},
  };
  return { tts, calls };
}

const deps = (tts: TtsProvider): SpeechDeps => ({
  tts,
  storage,
  catalog: async () => [{ id: "hazir-1", name: "Ayla", gender: "female", category: "premade" }],
  retryDelayMs: 0,
});

/** Sonuçlanana kadar askıda kalan sağlayıcı; testin sonunda bırakılır. */
function hangingTts() {
  const waiting: ((err: Error) => void)[] = [];
  const tts = fakeTts(
    () =>
      new Promise((_, reject) => {
        waiting.push(reject);
      }),
  ).tts;
  return { tts, release: () => waiting.forEach((r) => r(new Error("bırakıldı"))) };
}

async function settled(userId: string, id: string) {
  return vi.waitFor(
    async () => {
      const g = await getGeneration(db, userId, id);
      if (g?.status === "pending") throw new Error("hâlâ hazırlanıyor");
      return g!;
    },
    { timeout: 5_000, interval: 20 },
  );
}

describe("uzun metin seslendirme", () => {
  it("parçalara bölünür, arka planda seslendirilir; ses tek dosyada, altyazı kaydırılmış", async () => {
    const id = await newUser();
    const before = await voiceCredits(id);
    const { tts, calls } = fakeTts();
    const res = await generateSpeech(db, deps(tts), id, { text: LONG, voiceId: "hazir-1" }, now);
    if (!res.ok) throw new Error(res.error);
    expect(res.generation.status).toBe("pending");
    expect(res.generation.progress).toEqual({ done: 0, total: 2 });
    // Kredi hemen ve bir kez düşer.
    expect(await voiceCredits(id)).toBe(before - [...LONG].length);

    const done = await settled(id, res.generation.id);
    expect(done.status).toBeUndefined();
    expect(done.progress).toBeUndefined();
    expect(done.audioUrl).toBe(`/media/audio/${done.id}`);
    expect(done.subtitleUrl).toBe(`/media/subtitle/${done.id}`);

    // Parçalar komşu metinle gider ve kelime kaybı olmadan metni kapsar.
    expect(calls).toHaveLength(2);
    expect(calls[0]!.context?.previousText).toBeUndefined();
    expect(calls[0]!.context?.nextText).toBe(calls[1]!.text.slice(0, 300));
    expect(calls[1]!.context?.previousText).toBe(calls[0]!.text.slice(-300));
    expect(`${calls[0]!.text} ${calls[1]!.text}`).toBe(LONG);

    // ID3 ve Info çerçeveleri atılmış, yalnız ses çerçeveleri birleşmiş.
    const audio = await storage.read(`${id}/${done.id}.mp3`);
    expect(audio?.byteLength).toBe(2 * CHUNK_FRAMES * FRAME_BYTES);

    const cues = parseCues((await storage.read(`${id}/${done.id}-captions.json`))!)!;
    const second = cues.find((c) => c.text.startsWith(calls[1]!.text.slice(0, 10)))!;
    expect(second.start).toBe(Math.round(CHUNK_FRAMES * FRAME_SECONDS * 1000));
    expect(await voiceCredits(id)).toBe(before - [...LONG].length);
  });

  it("parça kalıcı hata verirse kredi aynı paketlere iade edilir, dosya kalmaz", async () => {
    const id = await newUser();
    const before = await voiceCredits(id);
    let n = 0;
    const { tts } = fakeTts(async (_v, text) => {
      if (++n === 2) throw new TtsError("ElevenLabs seslendirme başarısız (400)", 400);
      return { audio: mp3Frames(5), alignment: fakeAlignment(text) };
    });
    const res = await generateSpeech(db, deps(tts), id, { text: LONG, voiceId: "hazir-1" }, now);
    if (!res.ok) throw new Error(res.error);
    const done = await settled(id, res.generation.id);
    expect(done.status).toBe("failed");
    expect(done.audioUrl).toBeUndefined();
    expect(await voiceCredits(id)).toBe(before);
    expect(await storage.read(`${id}/${done.id}.mp3`)).toBeNull();
  });

  it("geçici hata (5xx) bir kez yeniden denenir", async () => {
    const id = await newUser();
    let n = 0;
    const { tts } = fakeTts(async (_v, text) => {
      if (++n === 1) throw new TtsError("ElevenLabs seslendirme başarısız (503)", 503);
      return { audio: mp3Frames(5), alignment: fakeAlignment(text) };
    });
    const res = await generateSpeech(db, deps(tts), id, { text: LONG, voiceId: "hazir-1" }, now);
    if (!res.ok) throw new Error(res.error);
    expect((await settled(id, res.generation.id)).status).toBeUndefined();
    expect(n).toBe(3);
  });

  it("zamanlama gelmezse ses yine kaydedilir, altyazı olmaz", async () => {
    const id = await newUser();
    const { tts } = fakeTts(async () => ({ audio: mp3Frames(5), alignment: null }));
    const res = await generateSpeech(db, deps(tts), id, { text: LONG, voiceId: "hazir-1" }, now);
    if (!res.ok) throw new Error(res.error);
    const done = await settled(id, res.generation.id);
    expect(done.audioUrl).toBeDefined();
    expect(done.subtitleUrl).toBeUndefined();
  });

  it("sunucu yeniden başlayınca yarım kalan iş iade edilir; iş sonradan bitse de iki kez iade olmaz", async () => {
    const id = await newUser();
    const before = await voiceCredits(id);
    const { tts, release } = hangingTts();
    const res = await generateSpeech(db, deps(tts), id, { text: LONG, voiceId: "hazir-1" }, now);
    if (!res.ok) throw new Error(res.error);

    // Çalışırken bekler.
    const live = await refreshPending(db, null, id, res.generation.id, now);
    expect(live.ok && live.generation.status).toBe("pending");
    expect(await failOrphanSpeech(db)).toBe(0);

    // Yeniden başlatma: bu süreçteki iş listesi boşalır.
    (globalThis as { __traiSpeechJobs?: Map<string, unknown> }).__traiSpeechJobs!.clear();
    const orphan = await refreshPending(db, null, id, res.generation.id, now);
    expect(orphan.ok && orphan.generation.status).toBe("failed");
    expect(await voiceCredits(id)).toBe(before);

    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(await voiceCredits(id)).toBe(before);
  });

  it("günlük bakım yarım kalan işleri iade eder", async () => {
    const id = await newUser();
    const before = await voiceCredits(id);
    const { tts, release } = hangingTts();
    const res = await generateSpeech(db, deps(tts), id, { text: LONG, voiceId: "hazir-1" }, now);
    if (!res.ok) throw new Error(res.error);
    (globalThis as { __traiSpeechJobs?: Map<string, unknown> }).__traiSpeechJobs!.clear();
    expect(await failOrphanSpeech(db)).toBe(1);
    expect(await voiceCredits(id)).toBe(before);
    release();
  });

  it(`aynı anda en fazla ${SPEECH_MAX_PENDING} uzun metin; kısa metin etkilenmez`, async () => {
    const id = await newUser();
    const { tts, release } = hangingTts();
    for (let i = 0; i < SPEECH_MAX_PENDING; i++) {
      const ok = await generateSpeech(db, deps(tts), id, { text: LONG, voiceId: "hazir-1" }, now);
      expect(ok.ok).toBe(true);
    }
    expect(
      await generateSpeech(db, deps(tts), id, { text: LONG, voiceId: "hazir-1" }, now),
    ).toEqual({ ok: false, error: "limit" });
    const short = await generateSpeech(
      db,
      deps(fakeTts().tts),
      id,
      { text: "Kısa metin.", voiceId: "hazir-1" },
      now,
    );
    expect(short.ok).toBe(true);
    release();
  });

  it("silinen işin kalan parçaları gönderilmez ve dosya yazılmaz", async () => {
    const id = await newUser();
    const before = await voiceCredits(id);
    const pending: (() => void)[] = [];
    const { tts, calls } = fakeTts();
    const slow = fakeTts(async (v, text, s, c) => {
      await new Promise<void>((r) => pending.push(r));
      return tts.synthesize(v, text, s, c);
    }).tts;
    // Tek tek gitsin diye üç parça ve aynı anda iki istek: üçüncü hiç başlamamalı.
    const text = `${LONG} ${LONG}`;
    const res = await generateSpeech(db, deps(slow), id, { text, voiceId: "hazir-1" }, now);
    if (!res.ok) throw new Error(res.error);
    expect(res.generation.progress?.total).toBe(3);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await removeGeneration(db, id, res.generation.id, storage);
    pending.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(2);
    expect(await storage.read(`${id}/${res.generation.id}.mp3`)).toBeNull();
    // Silinen üretimin kredisi iade edilmez (video ile aynı).
    expect(await voiceCredits(id)).toBe(before - [...text.trim()].length);
  });
});

describe("altyazı indirme", () => {
  async function setup() {
    const owner = await newUser("sahip@example.com");
    const other = await newUser("baska@example.com");
    const res = await generateSpeech(
      db,
      deps(fakeTts().tts),
      owner,
      { text: "Merhaba dünya. Bu bir altyazı denemesidir.", voiceId: "hazir-1" },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    return {
      owner,
      gid: res.generation.id,
      ownerToken: (await createSession(db, owner, now)).token,
      otherToken: (await createSession(db, other, now)).token,
    };
  }
  const request = (id: string, token?: string, query = "") =>
    new Request(`http://localhost:8080/media/subtitle/${id}${query}`, {
      headers: token ? { cookie: `trai_session=${encodeURIComponent(token)}` } : {},
    });

  it("sahibi SRT ve VTT indirir; başkası bulunamadı, oturumsuz istek 401 alır", async () => {
    const { gid, ownerToken, otherToken } = await setup();
    const srt = await serveSubtitle(request(gid, ownerToken, "?download=1"), gid, {
      db,
      storage,
      now,
    });
    expect(srt.status).toBe(200);
    expect(srt.headers.get("content-type")).toBe("application/x-subrip; charset=utf-8");
    expect(srt.headers.get("content-disposition")).toBe(
      `attachment; filename="trai-pro-${gid.slice(0, 8)}.srt"`,
    );
    expect(await srt.text()).toMatch(/^1\r\n00:00:00,000 --> /);

    const vtt = await serveSubtitle(request(gid, ownerToken, "?format=vtt"), gid, {
      db,
      storage,
      now,
    });
    expect(vtt.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
    expect(await vtt.text()).toMatch(/^WEBVTT\n\n00:00:00\.000 --> /);

    expect((await serveSubtitle(request(gid, otherToken), gid, { db, storage, now })).status).toBe(
      404,
    );
    expect((await serveSubtitle(request(gid), gid, { db, storage, now })).status).toBe(401);
  });

  it("API: uzun metin 202 ile döner; bitince altyazı adresleri gelir ve indirilir", async () => {
    const owner = await newUser("api@example.com");
    const key = await createApiKey(db, owner, "Sunucum", now);
    if (!key.ok) throw new Error(key.error);
    const apiDeps = {
      db: async () => db,
      now: () => now,
      storage,
      speech: deps(fakeTts().tts),
      image: null,
      video: null,
    };
    const call = (path: string, init: RequestInit = {}, query = "") =>
      handleApi(
        new Request(`https://trai.example/api/v1/${path}${query}`, {
          ...init,
          headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" },
        }),
        path,
        apiDeps,
      );

    const created = await call("tts", {
      method: "POST",
      body: JSON.stringify({ text: LONG, voice_id: "hazir-1" }),
    });
    expect(created.status).toBe(202);
    const body = (await created.json()) as { id: string; status: string; progress: unknown };
    expect(body).toMatchObject({ status: "pending", progress: { done: 0, total: 2 } });

    await settled(owner, body.id);
    const fetched = (await (await call(`generations/${body.id}`)).json()) as {
      status: string;
      subtitles: { srt: string; vtt: string };
    };
    expect(fetched.status).toBe("completed");
    expect(fetched.subtitles).toEqual({
      srt: `https://trai.example/api/v1/generations/${body.id}/subtitles?format=srt`,
      vtt: `https://trai.example/api/v1/generations/${body.id}/subtitles?format=vtt`,
    });
    const vtt = await call(`generations/${body.id}/subtitles`, {}, "?format=vtt");
    expect(vtt.status).toBe(200);
    expect(vtt.headers.get("content-disposition")).toContain(".vtt");
    expect(await vtt.text()).toMatch(/^WEBVTT/);
  });
});

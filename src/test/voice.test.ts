// @vitest-environment node
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { balance } from "@/lib/credits";
import { localAudioStorage, type AudioStorage } from "@/server/audio-storage.server";
import { openDb, type Db } from "@/server/db.server";
import { serveAudio } from "@/server/media.server";
import {
  createSession,
  createVoiceClone,
  deleteAccount,
  deleteVoiceClone,
  generateSpeech,
  loadUserData,
  markEmailVerified,
  registerUser,
  removeGeneration,
  type SpeechDeps,
} from "@/server/services.server";
import {
  ELEVENLABS_API,
  elevenLabsProvider,
  publicVoices,
  type CloneFile,
  type ProviderVoice,
  type TtsProvider,
} from "@/server/tts.server";

const now = new Date("2026-10-15T09:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-voice-"));
let db: Db;
let audioRoot: string;
let storage: AudioStorage;

const catalog: ProviderVoice[] = [
  { id: "hazir-1", name: "Ayla", gender: "female", category: "premade" },
  { id: "hazir-2", name: "Kaan", gender: "male", category: "premade" },
];

/** Çağrıları kaydeden sahte sağlayıcı. */
function fakeTts(opts: { fail?: boolean } = {}) {
  const calls = {
    synth: [] as [string, string][],
    cloned: [] as string[],
    deleted: [] as string[],
  };
  const tts: TtsProvider = {
    async listVoices() {
      return catalog;
    },
    async synthesize(voiceId, text) {
      calls.synth.push([voiceId, text]);
      if (opts.fail) throw new Error("ElevenLabs 500");
      return new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);
    },
    async cloneVoice({ name }) {
      calls.cloned.push(name);
      if (opts.fail) throw new Error("ElevenLabs 422");
      return `el-${calls.cloned.length}`;
    },
    async deleteVoice(id) {
      calls.deleted.push(id);
    },
  };
  return { tts, calls };
}

const deps = (tts: TtsProvider): SpeechDeps => ({ tts, storage, catalog: async () => catalog });
const audioFile = (bytes = 1024): CloneFile => ({
  name: "ornek.mp3",
  type: "audio/mpeg",
  data: new Uint8Array(bytes),
});

beforeEach(async () => {
  db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
  audioRoot = join(dir, `audio-${randomUUID()}`);
  storage = localAudioStorage(audioRoot);
});

afterEach(() => db.$client.close());

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

async function newUser(email = "ayse@example.com", verified = true) {
  const res = await registerUser(db, { name: "Ayşe", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  if (verified) await markEmailVerified(db, res.userId, now);
  return res.userId;
}

describe("ElevenLabs istemcisi", () => {
  function recorder(response: () => Response) {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), init });
      return response();
    }) as typeof fetch;
    return { seen, f };
  }

  it("seslendirme isteği doğru adres, anahtar başlığı ve modelle gider", async () => {
    const { seen, f } = recorder(() => new Response(new Uint8Array([1, 2, 3])));
    const p = elevenLabsProvider({ apiKey: "anahtar", fetchImpl: f });
    const audio = await p.synthesize("ses-1", "Merhaba");
    expect([...audio]).toEqual([1, 2, 3]);
    expect(seen[0]!.url).toBe(
      `${ELEVENLABS_API}/v1/text-to-speech/ses-1?output_format=mp3_44100_128`,
    );
    const headers = seen[0]!.init!.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe("anahtar");
    expect(JSON.parse(String(seen[0]!.init!.body))).toEqual({
      text: "Merhaba",
      model_id: "eleven_multilingual_v2",
    });
  });

  it("hata yanıtı istisna olur; yanıt gövdesi mesaja girmez", async () => {
    const { f } = recorder(() => new Response("gizli ayrıntı", { status: 401 }));
    const p = elevenLabsProvider({ apiKey: "x", fetchImpl: f });
    await expect(p.synthesize("ses-1", "Merhaba")).rejects.toThrow(
      "ElevenLabs seslendirme başarısız (401)",
    );
  });

  it("ses listesi cinsiyet ve kategoriyle eşlenir", async () => {
    const { f } = recorder(
      () =>
        new Response(
          JSON.stringify({
            voices: [
              { voice_id: "a", name: "A", category: "premade", labels: { gender: "female" } },
              { voice_id: "b", name: "B", category: "cloned", labels: {} },
            ],
          }),
        ),
    );
    const voices = await elevenLabsProvider({ apiKey: "x", fetchImpl: f }).listVoices();
    expect(voices).toEqual([
      { id: "a", name: "A", gender: "female", category: "premade" },
      { id: "b", name: "B", gender: null, category: "cloned" },
    ]);
  });

  it("klonlama multipart form ile ad ve dosyayı gönderir", async () => {
    const { seen, f } = recorder(() => new Response(JSON.stringify({ voice_id: "yeni" })));
    const id = await elevenLabsProvider({ apiKey: "x", fetchImpl: f }).cloneVoice({
      name: "TrAi Sesim",
      description: "d",
      file: audioFile(10),
    });
    expect(id).toBe("yeni");
    expect(seen[0]!.url).toBe(`${ELEVENLABS_API}/v1/voices/add`);
    const form = seen[0]!.init!.body as FormData;
    expect(form.get("name")).toBe("TrAi Sesim");
    expect((form.get("files") as File).name).toBe("ornek.mp3");
  });

  it("silinmiş sesi silmek hata vermez", async () => {
    const { f } = recorder(() => new Response(null, { status: 404 }));
    await expect(
      elevenLabsProvider({ apiKey: "x", fetchImpl: f }).deleteVoice("yok"),
    ).resolves.toBeUndefined();
  });

  it("hazır listeden kullanıcı klonları ayıklanır, izin listesi uygulanır", () => {
    const all: ProviderVoice[] = [
      ...catalog,
      { id: "klon-x", name: "X", gender: null, category: "cloned" },
      { id: "db-klon", name: "Y", gender: null, category: "generated" },
    ];
    expect(publicVoices(all, new Set(["db-klon"]), null).map((v) => v.id)).toEqual([
      "hazir-1",
      "hazir-2",
    ]);
    expect(publicVoices(all, new Set(), ["hazir-2"]).map((v) => v.id)).toEqual(["hazir-2"]);
  });
});

describe("gerçek seslendirme", () => {
  it("başarıda ses dosyası saklanır ve karakter başına kredi düşer", async () => {
    const id = await newUser();
    const { tts, calls } = fakeTts();
    const res = await generateSpeech(
      db,
      deps(tts),
      id,
      { text: "  Merhaba dünya ", voiceId: "hazir-1" },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    expect(calls.synth).toEqual([["hazir-1", "Merhaba dünya"]]);
    expect(res.generation.cost).toBe(13);
    expect(res.generation.audioUrl).toBe(`/media/audio/${res.generation.id}`);
    expect(await storage.read(`${id}/${res.generation.id}.mp3`)).not.toBeNull();
    expect(balance((await loadUserData(db, id)).grants, "voice", now)).toBe(5_000 - 13);
  });

  it("servis hata verirse kredi düşmez, kayıt ve dosya oluşmaz", async () => {
    const id = await newUser();
    const { tts } = fakeTts({ fail: true });
    expect(
      await generateSpeech(db, deps(tts), id, { text: "Merhaba", voiceId: "hazir-1" }, now),
    ).toEqual({
      ok: false,
      error: "providerFailed",
    });
    const data = await loadUserData(db, id);
    expect(balance(data.grants, "voice", now)).toBe(5_000);
    expect(data.generations).toHaveLength(0);
    expect(existsSync(join(audioRoot, id))).toBe(false);
  });

  it("kredi yetmezse servis hiç çağrılmaz", async () => {
    const id = await newUser("a@example.com", false);
    const { tts, calls } = fakeTts();
    expect(
      await generateSpeech(db, deps(tts), id, { text: "Merhaba", voiceId: "hazir-1" }, now),
    ).toEqual({
      ok: false,
      error: "insufficient",
    });
    expect(calls.synth).toHaveLength(0);
  });

  it("katalogda olmayan ses ve başkasının klonu reddedilir", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const { tts, calls } = fakeTts();
    const clone = await createVoiceClone(
      db,
      { tts },
      a,
      { name: "Sesim", consent: true, file: audioFile() },
      now,
    );
    if (!clone.ok) throw new Error(clone.error);

    expect(
      (await generateSpeech(db, deps(tts), b, { text: "Selam", voiceId: "baska-ses" }, now)).ok,
    ).toBe(false);
    expect(
      await generateSpeech(db, deps(tts), b, { text: "Selam", voiceId: clone.id }, now),
    ).toEqual({
      ok: false,
      error: "invalidInput",
    });
    const own = await generateSpeech(db, deps(tts), a, { text: "Selam", voiceId: clone.id }, now);
    expect(own.ok).toBe(true);
    expect(calls.synth.at(-1)).toEqual(["el-1", "Selam"]);
  });

  it("dakikada en fazla 20 seslendirme", async () => {
    const id = await newUser();
    const { tts } = fakeTts();
    for (let i = 0; i < 20; i++) {
      expect(
        (await generateSpeech(db, deps(tts), id, { text: "a", voiceId: "hazir-1" }, now)).ok,
      ).toBe(true);
    }
    const res = await generateSpeech(db, deps(tts), id, { text: "a", voiceId: "hazir-1" }, now);
    expect(res.ok === false && res.error).toBe("tooManyAttempts");
  });

  it("üretim silinince ses dosyası da silinir", async () => {
    const id = await newUser();
    const { tts } = fakeTts();
    const res = await generateSpeech(
      db,
      deps(tts),
      id,
      { text: "Merhaba", voiceId: "hazir-1" },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    await removeGeneration(db, id, res.generation.id, storage);
    expect(await storage.read(`${id}/${res.generation.id}.mp3`)).toBeNull();
  });
});

describe("gerçek ses klonu", () => {
  it("izin onayı, ses dosyası ve boyut sınırı zorunlu", async () => {
    const id = await newUser();
    const { tts, calls } = fakeTts();
    const bad = [
      { name: "Sesim", consent: false, file: audioFile() },
      { name: "Sesim", consent: true, file: { ...audioFile(), type: "image/png" } },
      { name: "Sesim", consent: true, file: audioFile(11 * 1024 * 1024) },
      { name: "  ", consent: true, file: audioFile() },
    ];
    for (const input of bad) {
      expect(await createVoiceClone(db, { tts }, id, input, now)).toEqual({
        ok: false,
        error: "invalidInput",
      });
    }
    expect(calls.cloned).toHaveLength(0);
  });

  it("klon sağlayıcıda açılır, izin zamanı kaydedilir ve canlı görünür", async () => {
    const id = await newUser();
    const { tts, calls } = fakeTts();
    const res = await createVoiceClone(
      db,
      { tts },
      id,
      { name: "Sesim", consent: true, file: audioFile() },
      now,
    );
    expect(res.ok).toBe(true);
    expect(calls.cloned).toEqual(["TrAi Sesim"]);
    const row = await db.query.voiceClones.findFirst();
    expect(row?.consentAt).toBe(now.toISOString());
    expect((await loadUserData(db, id)).clones[0]).toMatchObject({ name: "Sesim", live: true });
  });

  it("servis hata verirse klon kaydı oluşmaz", async () => {
    const id = await newUser();
    const { tts } = fakeTts({ fail: true });
    expect(
      await createVoiceClone(
        db,
        { tts },
        id,
        { name: "Sesim", consent: true, file: audioFile() },
        now,
      ),
    ).toEqual({
      ok: false,
      error: "providerFailed",
    });
    expect((await loadUserData(db, id)).clones).toHaveLength(0);
  });

  it("klon silinince sağlayıcıdaki ses de silinir", async () => {
    const id = await newUser();
    const { tts, calls } = fakeTts();
    const res = await createVoiceClone(
      db,
      { tts },
      id,
      { name: "Sesim", consent: true, file: audioFile() },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    expect(await deleteVoiceClone(db, { tts }, id, res.id)).toEqual({ ok: true });
    expect(calls.deleted).toEqual(["el-1"]);
    expect((await loadUserData(db, id)).clones).toHaveLength(0);
  });
});

describe("hesap silme temizliği", () => {
  it("sağlayıcıdaki klonlar ve kullanıcının ses dosyaları silinir", async () => {
    const id = await newUser();
    const { tts, calls } = fakeTts();
    await createVoiceClone(
      db,
      { tts },
      id,
      { name: "Sesim", consent: true, file: audioFile() },
      now,
    );
    await generateSpeech(db, deps(tts), id, { text: "Merhaba", voiceId: "hazir-1" }, now);
    expect(existsSync(join(audioRoot, id))).toBe(true);

    const res = await deleteAccount(
      db,
      id,
      { confirmEmail: "ayse@example.com", password: "gizli-sifre-1" },
      null,
      now,
      { tts, storage },
    );
    expect(res).toEqual({ ok: true });
    expect(calls.deleted).toEqual(["el-1"]);
    expect(existsSync(join(audioRoot, id))).toBe(false);
  });
});

describe("ses deposu", () => {
  it("dizin dışına çıkan anahtar reddedilir", async () => {
    await expect(storage.put("../disari.mp3", new Uint8Array(1))).rejects.toThrow();
    await expect(storage.read("a/../../b.mp3")).resolves.toBeNull();
  });
});

describe("ses dosyası rotası", () => {
  async function setup() {
    const owner = await newUser("sahip@example.com");
    const other = await newUser("baska@example.com");
    const { tts } = fakeTts();
    const res = await generateSpeech(
      db,
      deps(tts),
      owner,
      { text: "Merhaba", voiceId: "hazir-1" },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    const ownerSession = await createSession(db, owner, now);
    const otherSession = await createSession(db, other, now);
    return { id: res.generation.id, ownerSession, otherSession };
  }
  const request = (id: string, token?: string, query = "") =>
    new Request(`http://localhost:8080/media/audio/${id}${query}`, {
      headers: token ? { cookie: `trai_session=${encodeURIComponent(token)}` } : {},
    });

  it("sahibi dinler", async () => {
    const { id, ownerSession } = await setup();
    const res = await serveAudio(request(id, ownerSession.token), id, { db, storage, now });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x49);
  });

  it("başka kullanıcı bulunamadı alır, oturumsuz istek reddedilir", async () => {
    const { id, otherSession } = await setup();
    expect(
      (await serveAudio(request(id, otherSession.token), id, { db, storage, now })).status,
    ).toBe(404);
    expect((await serveAudio(request(id), id, { db, storage, now })).status).toBe(401);
  });

  it("indirme isteği dosya olarak döner", async () => {
    const { id, ownerSession } = await setup();
    const res = await serveAudio(request(id, ownerSession.token, "?download=1"), id, {
      db,
      storage,
      now,
    });
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="trai-pro-.{8}\.mp3"$/,
    );
  });
});

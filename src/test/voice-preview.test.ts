// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb, type Db } from "@/server/db.server";
import { localFileStorage, type FileStorage } from "@/server/file-storage.server";
import { voiceClones } from "@/server/schema.server";
import {
  createSession,
  deleteVoiceClone,
  markEmailVerified,
  registerUser,
  type SpeechDeps,
} from "@/server/services.server";
import { SESSION_COOKIE } from "@/server/session.server";
import type { ProviderVoice, TtsProvider } from "@/server/tts.server";
import { PREVIEW_TEXT, serveVoicePreview, voicePreview } from "@/server/voice-preview.server";

import { mp3Frames } from "./speech-fixtures";

const now = new Date("2026-10-19T12:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-preview-test-"));
let db: Db;
let storage: FileStorage;
const savedModel = process.env["ELEVENLABS_MODEL"];

beforeEach(async () => {
  // Kullanıcının .env'indeki model önbellek anahtarını değiştirmesin.
  process.env["ELEVENLABS_MODEL"] = "";
  db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
  storage = localFileStorage(join(dir, `media-${randomUUID()}`));
});
afterEach(() => {
  db.$client.close();
  if (savedModel === undefined) delete process.env["ELEVENLABS_MODEL"];
  else process.env["ELEVENLABS_MODEL"] = savedModel;
});
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

const CATALOG: ProviderVoice[] = Array.from({ length: 25 }, (_, i) => ({
  id: `hazir-${i}`,
  name: `Ses ${i}`,
  gender: null,
  category: "premade",
}));

function fakeDeps(opts: { fail?: boolean; gate?: Promise<void> } = {}) {
  const calls: { voiceId: string; text: string }[] = [];
  const tts: TtsProvider = {
    listVoices: async () => CATALOG,
    synthesize: async (voiceId, text) => {
      calls.push({ voiceId, text });
      if (opts.gate) await opts.gate;
      if (opts.fail) throw new Error("servis hatası");
      return { audio: mp3Frames(10), alignment: null };
    },
    cloneVoice: async () => "x",
    deleteVoice: async () => {},
  };
  const deps: SpeechDeps = { tts, storage, catalog: async () => CATALOG };
  return { deps, calls };
}

async function newUser(email: string) {
  const res = await registerUser(db, { name: "Dinleyen", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, now);
  return res.userId;
}

describe("ses örneği", () => {
  it("hazır sesin örneği bir kez seslendirilir, sonra herkese depodan gelir; dil başına ayrı", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const { deps, calls } = fakeDeps();
    expect(await voicePreview(db, deps, a, "hazir-1", "tr", now)).toEqual({
      ok: true,
      audio: mp3Frames(10),
    });
    expect(calls).toEqual([{ voiceId: "hazir-1", text: PREVIEW_TEXT.tr }]);
    expect(await storage.read("voice-previews/hazir-1-tr-eleven-multilingual-v2.mp3")).toEqual(
      mp3Frames(10),
    );
    expect((await voicePreview(db, deps, b, "hazir-1", "tr", now)).ok).toBe(true);
    expect(calls).toHaveLength(1);
    await voicePreview(db, deps, b, "hazir-1", "en", now);
    expect(calls.at(-1)).toEqual({ voiceId: "hazir-1", text: PREVIEW_TEXT.en });
  });

  it("katalogda olmayan ses ve geçersiz kimlik bulunamaz; aynı anda gelen iki istek bir kez seslendirir", async () => {
    const a = await newUser("a@example.com");
    let open!: () => void;
    const { deps, calls } = fakeDeps({ gate: new Promise((r) => (open = r)) });
    expect(await voicePreview(db, deps, a, "yok", "tr", now)).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await voicePreview(db, deps, a, "../../x", "tr", now)).toEqual({
      ok: false,
      error: "notFound",
    });
    const both = Promise.all([
      voicePreview(db, deps, a, "hazir-2", "tr", now),
      voicePreview(db, deps, a, "hazir-2", "tr", now),
    ]);
    await new Promise((r) => setTimeout(r, 20));
    open();
    expect((await both).every((r) => r.ok)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("klonun örneği yalnız sahibine, kendi klasöründe; klon silinince örnek de silinir", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    await db.insert(voiceClones).values({
      id: "clone-1",
      userId: a,
      name: "Sesim",
      providerVoiceId: "el-klon",
      consentAt: now.toISOString(),
      createdAt: now.toISOString(),
    });
    const { deps, calls } = fakeDeps();
    expect((await voicePreview(db, deps, b, "clone-1", "tr", now)).ok).toBe(false);
    expect((await voicePreview(db, deps, a, "clone-1", "tr", now)).ok).toBe(true);
    expect(calls).toEqual([{ voiceId: "el-klon", text: PREVIEW_TEXT.tr }]);
    expect(await storage.read(`${a}/clone-1-preview-tr.mp3`)).not.toBeNull();
    await deleteVoiceClone(db, { tts: deps.tts, storage }, a, "clone-1");
    expect(await storage.read(`${a}/clone-1-preview-tr.mp3`)).toBeNull();
  });

  it("saklanmamış örnek üretimi saatlik sınırlı; servis hatasında dosya yazılmaz", async () => {
    const a = await newUser("a@example.com");
    const { deps } = fakeDeps();
    for (let i = 0; i < 20; i++) {
      expect((await voicePreview(db, deps, a, `hazir-${i}`, "tr", now)).ok).toBe(true);
    }
    expect(await voicePreview(db, deps, a, "hazir-20", "tr", now)).toMatchObject({
      ok: false,
      error: "tooManyAttempts",
    });
    // Saklanmış örnek sınırdan etkilenmez.
    expect((await voicePreview(db, deps, a, "hazir-3", "tr", now)).ok).toBe(true);

    const b = await newUser("b@example.com");
    const broken = fakeDeps({ fail: true });
    expect(await voicePreview(db, broken.deps, b, "hazir-21", "tr", now)).toEqual({
      ok: false,
      error: "providerFailed",
    });
    expect(await storage.read("voice-previews/hazir-21-tr-eleven-multilingual-v2.mp3")).toBeNull();
  });

  it("adres: oturum gerekir; ses servisi yoksa 404; varsa MP3", async () => {
    const a = await newUser("a@example.com");
    const { token } = await createSession(db, a, now);
    const req = (cookie?: string) =>
      new Request("https://trai.example/media/voice-preview/hazir-1?lang=en", {
        headers: cookie ? { cookie } : {},
      });
    const { deps } = fakeDeps();
    const base = { db, now, storage };
    expect((await serveVoicePreview(req(), "hazir-1", { ...base, speech: deps })).status).toBe(401);
    const cookie = `${SESSION_COOKIE}=${token}`;
    expect(
      (await serveVoicePreview(req(cookie), "hazir-1", { ...base, speech: null })).status,
    ).toBe(404);
    const res = await serveVoicePreview(req(cookie), "hazir-1", { ...base, speech: deps });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(mp3Frames(10));
  });
});

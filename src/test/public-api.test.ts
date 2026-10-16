// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_API_KEYS,
  authenticateApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "@/server/api-keys.server";
import { openDb, type Db } from "@/server/db.server";
import { localFileStorage, type FileStorage } from "@/server/file-storage.server";
import type { ImageProvider } from "@/server/image.server";
import { handleApi, type ApiDeps } from "@/server/public-api.server";
import {
  deleteAccount,
  demoTopUp,
  markEmailVerified,
  purchasePackage,
  registerUser,
} from "@/server/services.server";
import type { TtsProvider } from "@/server/tts.server";
import type { VideoCheck, VideoProvider } from "@/server/video.server";

const now = new Date("2026-10-16T09:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-api-"));
let db: Db;
let storage: FileStorage;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1]);
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 1]);
const MP4 = new Uint8Array([0, 0, 0, 0x18]);

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

/** Doğrulanmış, ses (deneme) ve görsel/video paketi olan kullanıcı. */
async function newUser(email = "dev@example.com", { verified = true } = {}) {
  const res = await registerUser(db, { name: "Dev", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  if (!verified) return res.userId;
  await markEmailVerified(db, res.userId, now);
  await demoTopUp(db, res.userId, 500, now);
  const bought = await purchasePackage(db, res.userId, { packageId: "media-2d" }, now);
  if (!bought.ok) throw new Error(bought.error);
  return res.userId;
}

async function keyFor(userId: string) {
  const res = await createApiKey(db, userId, "Sunucum", now);
  if (!res.ok) throw new Error(res.error);
  return res.key;
}

let videoState: VideoCheck = { state: "pending" };
function deps(over: Partial<ApiDeps> = {}): ApiDeps {
  const tts = {
    listVoices: async () => [],
    synthesize: async () => MP3,
    cloneVoice: async () => "x",
    deleteVoice: async () => {},
  } satisfies TtsProvider;
  const images: ImageProvider = {
    generate: async ({ count }) =>
      Array.from({ length: count }, () => ({ data: JPEG, contentType: "image/jpeg" as const })),
  };
  const video: VideoProvider = {
    submit: async () => ({
      requestId: "req-12345678",
      statusUrl: "https://queue.fal.run/x/requests/req-12345678/status",
      responseUrl: "https://queue.fal.run/x/requests/req-12345678",
      cancelUrl: null,
    }),
    check: async () => videoState,
    cancel: async () => {},
  };
  return {
    db: async () => db,
    now: () => now,
    storage,
    speech: {
      tts,
      storage,
      catalog: async () => [{ id: "hazir-1", name: "Ayla", gender: "female", category: "premade" }],
    },
    image: { images, storage },
    video: { video, storage, webhookUrl: null },
    ...over,
  };
}

const call = (
  path: string,
  { key, method = "GET", body }: { key?: string; method?: string; body?: unknown } = {},
  d = deps(),
) =>
  handleApi(
    new Request(`https://trai.example/api/v1/${path}`, {
      method,
      headers: {
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    path,
    d,
  );

describe("API anahtarları", () => {
  it("yalnız doğrulanmış hesap açar; en çok 5 etkin anahtar; iptal edilen kabul edilmez", async () => {
    const unverified = await newUser("yeni@example.com", { verified: false });
    expect(await createApiKey(db, unverified, "x", now)).toEqual({
      ok: false,
      error: "unverified",
    });

    const id = await newUser();
    const first = await createApiKey(db, id, "  Üretim  ", now);
    if (!first.ok) throw new Error(first.error);
    expect(first.key).toMatch(/^trai_[A-Za-z0-9_-]{43}$/);
    expect(first.apiKey).toMatchObject({ name: "Üretim", prefix: first.key.slice(0, 13) });
    for (let i = 1; i < MAX_API_KEYS; i++) await keyFor(id);
    expect(await createApiKey(db, id, "fazla", now)).toEqual({ ok: false, error: "limit" });
    expect(await listApiKeys(db, id)).toHaveLength(MAX_API_KEYS);

    expect(await authenticateApiKey(db, first.key, now)).toMatchObject({ userId: id });
    expect(await revokeApiKey(db, id, first.apiKey.id, now)).toEqual({ ok: true });
    expect(await authenticateApiKey(db, first.key, now)).toBeNull();
    expect(await revokeApiKey(db, id, first.apiKey.id, now)).toEqual({
      ok: false,
      error: "notFound",
    });
    // İptal yer açar.
    expect((await createApiKey(db, id, "yeni", now)).ok).toBe(true);
  });

  it("anahtarın kendisi saklanmaz; hesap silinince anahtarlar da gider", async () => {
    const id = await newUser();
    const key = await keyFor(id);
    const stored = await db.$client.execute("select key_hash from api_keys");
    expect(JSON.stringify(stored.rows)).not.toContain(key);
    await deleteAccount(
      db,
      id,
      { confirmEmail: "dev@example.com", password: "gizli-sifre-1" },
      null,
      now,
    );
    expect(await authenticateApiKey(db, key, now)).toBeNull();
    expect((await db.$client.execute("select count(*) n from api_keys")).rows[0]!["n"]).toBe(0);
  });
});

describe("geliştirici API'si", () => {
  it("anahtarsız, hatalı ya da iptal edilmiş anahtarla 401", async () => {
    const id = await newUser();
    expect((await call("me")).status).toBe(401);
    expect((await call("me", { key: "trai_yanlis" })).status).toBe(401);
    const res = await createApiKey(db, id, "x", now);
    if (!res.ok) throw new Error(res.error);
    await revokeApiKey(db, id, res.apiKey.id, now);
    const r = await call("me", { key: res.key });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({
      error: { code: "unauthorized", message: "Missing or invalid API key." },
    });
  });

  it("me: krediler ve USD bakiye", async () => {
    const key = await keyFor(await newUser());
    const res = await call("me", { key });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      credits: { voice: 5_000, media: 100 },
      balance_usd: "2.00",
    });
  });

  it("görsel üretir, dosya anahtarla indirilir; başka kullanıcı göremez", async () => {
    const key = await keyFor(await newUser());
    const res = await call("images", { key, method: "POST", body: { prompt: "tilki", count: 2 } });
    expect(res.status).toBe(201);
    const g = (await res.json()) as { id: string; cost: number; status: string; files: string[] };
    expect(g).toMatchObject({ cost: 2, status: "completed" });
    expect(g.files).toEqual(
      [0, 1].map((i) => `https://trai.example/api/v1/generations/${g.id}/files/${i}`),
    );

    const file = await call(`generations/${g.id}/files/0`, { key });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(JPEG);
    expect(
      ((await call("me", { key }).then((r) => r.json())) as { credits: { media: number } }).credits
        .media,
    ).toBe(98);

    const other = await keyFor(await newUser("baska@example.com"));
    expect((await call(`generations/${g.id}`, { key: other })).status).toBe(404);
    expect((await call(`generations/${g.id}/files/0`, { key: other })).status).toBe(404);
  });

  it("seslendirme ve ses listesi (hazır sesler + kullanıcının klonları)", async () => {
    const key = await keyFor(await newUser());
    const voices = await call("voices", { key });
    expect(await voices.json()).toEqual({
      voices: [{ id: "hazir-1", name: "Ayla", gender: "female", type: "stock" }],
    });
    const res = await call("tts", {
      key,
      method: "POST",
      body: { text: "Merhaba", voice_id: "hazir-1" },
    });
    expect(res.status).toBe(201);
    const g = (await res.json()) as { id: string; cost: number; files: string[] };
    expect(g.cost).toBe(7);
    const file = await call(`generations/${g.id}/files/0`, { key });
    expect(file.headers.get("content-type")).toBe("audio/mpeg");
  });

  it("video kuyruğa alınır (202); durum sorgusu sağlayıcıyı kontrol eder", async () => {
    const key = await keyFor(await newUser());
    videoState = { state: "pending" };
    const res = await call("videos", {
      key,
      method: "POST",
      body: { prompt: "gemi", style: "anime" },
    });
    expect(res.status).toBe(202);
    const g = (await res.json()) as { id: string; status: string; cost: number };
    expect(g).toMatchObject({ status: "pending", cost: 15 });

    videoState = { state: "done", video: MP4 };
    const done = (await (await call(`generations/${g.id}`, { key })).json()) as {
      status: string;
      files: string[];
    };
    expect(done.status).toBe("completed");
    expect(done.files).toHaveLength(1);
  });

  it("hata kodları: geçersiz girdi, yetersiz kredi, kapalı servis, yanlış yöntem, bilinmeyen yol", async () => {
    const key = await keyFor(await newUser());
    const code = async (r: Response) => [
      r.status,
      ((await r.json()) as { error: { code: string } }).error.code,
    ];

    expect(
      await code(await call("images", { key, method: "POST", body: { prompt: "x", count: 3 } })),
    ).toEqual([400, "invalid_input"]);
    expect(
      await code(
        await call("tts", {
          key,
          method: "POST",
          body: { text: "x".repeat(5_001), voice_id: "hazir-1" },
        }),
      ),
    ).toEqual([400, "invalid_input"]);
    expect(
      await code(
        await call(
          "images",
          { key, method: "POST", body: { prompt: "x", count: 4 } },
          deps({ image: null }),
        ),
      ),
    ).toEqual([503, "service_unavailable"]);
    expect(await code(await call("images", { key }))).toEqual([405, "method_not_allowed"]);
    expect(await code(await call("nope", { key }))).toEqual([404, "not_found"]);

    const poor = await registerUser(
      db,
      { name: "P", email: "p@example.com", password: "gizli-sifre-1" },
      now,
    );
    if (!poor.ok) throw new Error(poor.error);
    await markEmailVerified(db, poor.userId, now);
    const poorKey = await keyFor(poor.userId);
    expect(
      await code(await call("images", { key: poorKey, method: "POST", body: { prompt: "x" } })),
    ).toEqual([402, "insufficient_credits"]);
  });

  it("anahtar başına dakikada 120 istek; aşınca 429 ve Retry-After", async () => {
    const key = await keyFor(await newUser());
    for (let i = 0; i < 120; i++) expect((await call("me", { key })).status).toBe(200);
    const res = await call("me", { key });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

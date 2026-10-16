// @vitest-environment node
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { balance } from "@/lib/credits";
import { openDb, type Db } from "@/server/db.server";
import { localFileStorage, type FileStorage } from "@/server/file-storage.server";
import {
  ContentRejected,
  decodeDataUri,
  falImageProvider,
  type GeneratedImage,
  type ImageProvider,
} from "@/server/image.server";
import { serveFile } from "@/server/media.server";
import {
  createSession,
  deleteAccount,
  demoTopUp,
  generateImages,
  loadUserData,
  markEmailVerified,
  purchasePackage,
  registerUser,
  removeGeneration,
} from "@/server/services.server";

const now = new Date("2026-10-16T09:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-image-"));
let db: Db;
let root: string;
let storage: FileStorage;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const dataUri = `data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fal.ai görsel sağlayıcısı", () => {
  it("istemi ve sayıyı gönderir, yanıttaki görseli çözer", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ images: [{ url: dataUri, content_type: "image/jpeg" }], has_nsfw_concepts: [false] }),
    );
    const images = await falImageProvider(
      { key: "fal-key", model: "fal-ai/flux/schnell" },
      fetchImpl as unknown as typeof fetch,
    ).generate({ prompt: "kırmızı bir tilki", count: 1 });

    expect(images).toEqual([{ data: JPEG, contentType: "image/jpeg" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://fal.run/fal-ai/flux/schnell");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Key fal-key");
    expect(JSON.parse(String(init.body))).toMatchObject({
      prompt: "kırmızı bir tilki",
      num_images: 1,
      enable_safety_checker: true,
      sync_mode: true,
    });
  });

  it("filtreye takılanları ayıklar; hepsi takılırsa ContentRejected", async () => {
    const two = vi.fn(async () =>
      json({ images: [{ url: dataUri }, { url: dataUri }], has_nsfw_concepts: [true, false] }),
    );
    const p = falImageProvider({ key: "k", model: "m" }, two as unknown as typeof fetch);
    expect(await p.generate({ prompt: "x", count: 2 })).toHaveLength(1);

    const none = vi.fn(async () => json({ images: [{ url: dataUri }], has_nsfw_concepts: [true] }));
    await expect(
      falImageProvider({ key: "k", model: "m" }, none as unknown as typeof fetch).generate({
        prompt: "x",
        count: 1,
      }),
    ).rejects.toBeInstanceOf(ContentRejected);
  });

  it("bağlantı dönerse yalnız https'ten indirir; hata durum kodunu taşır", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("https://fal.run")
        ? json({ images: [{ url: "https://v3.fal.media/files/a.png" }, { url: "http://x/b.png" }] })
        : new Response(JSON.stringify("x"), { headers: { "content-type": "image/png" } }),
    );
    const images = await falImageProvider(
      { key: "k", model: "m" },
      fetchImpl as unknown as typeof fetch,
    ).generate({ prompt: "x", count: 2 });
    expect(images.map((i) => i.contentType)).toEqual(["image/png"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const down = vi.fn(async () => json({ detail: "istem metni" }, 500));
    await expect(
      falImageProvider({ key: "k", model: "m" }, down as unknown as typeof fetch).generate({
        prompt: "x",
        count: 1,
      }),
    ).rejects.toThrow("500");
  });

  it("geçersiz data URI kabul edilmez", () => {
    expect(decodeDataUri("data:text/html;base64,PGh0bWw+")).toBeNull();
    expect(decodeDataUri("data:image/jpeg;base64,")).toBeNull();
  });
});

describe("gerçek görsel üretimi", () => {
  beforeEach(async () => {
    db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
    root = join(dir, `media-${randomUUID()}`);
    storage = localFileStorage(root);
  });
  afterEach(() => db.$client.close());
  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows dosya kilidini geç bırakabilir.
    }
  });

  /** Görsel paketi (100 kredi) almış kullanıcı. */
  async function newUser(email = "ayse@example.com") {
    const res = await registerUser(db, { name: "Ayşe", email, password: "gizli-sifre-1" }, now);
    if (!res.ok) throw new Error(res.error);
    await markEmailVerified(db, res.userId, now);
    await demoTopUp(db, res.userId, 500, now);
    const bought = await purchasePackage(db, res.userId, { packageId: "media-2d" }, now);
    if (!bought.ok) throw new Error(bought.error);
    return res.userId;
  }

  const mediaLeft = async (id: string) =>
    balance((await loadUserData(db, id, now)).grants, "media", now);

  function provider(result: GeneratedImage[] | Error): ImageProvider & { calls: number } {
    const p = {
      calls: 0,
      async generate() {
        p.calls++;
        if (result instanceof Error) throw result;
        return result;
      },
    };
    return p;
  }

  it("görselleri saklar, teslim edilen kadar kredi düşer, adresleri verir", async () => {
    const id = await newUser();
    const before = await mediaLeft(id);
    // 4 istendi, sağlayıcı (filtre sonrası) 3 döndürdü.
    const images = provider(
      Array.from({ length: 3 }, () => ({ data: JPEG, contentType: "image/jpeg" as const })),
    );
    const res = await generateImages(
      db,
      { images, storage },
      id,
      { text: " tilki ", count: 4 },
      now,
    );

    if (!res.ok) throw new Error(res.error);
    expect(res.generation).toMatchObject({ type: "image", text: "tilki", cost: 3 });
    expect(res.generation.fileUrls).toEqual(
      [0, 1, 2].map((i) => `/media/file/${res.generation.id}/${i}`),
    );
    expect(await mediaLeft(id)).toBe(before - 3);
    expect(existsSync(join(root, id, `${res.generation.id}-0.jpg`))).toBe(true);
  });

  it("sağlayıcı hatası ya da içerik reddinde kredi düşmez, dosya kalmaz", async () => {
    const id = await newUser();
    const before = await mediaLeft(id);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await generateImages(
        db,
        { images: provider(new Error("fal 500")), storage },
        id,
        { text: "x", count: 1 },
        now,
      ),
    ).toEqual({ ok: false, error: "providerFailed" });
    spy.mockRestore();
    expect(
      await generateImages(
        db,
        { images: provider(new ContentRejected()), storage },
        id,
        { text: "x", count: 1 },
        now,
      ),
    ).toEqual({ ok: false, error: "contentRejected" });
    expect(await mediaLeft(id)).toBe(before);
    expect(existsSync(join(root, id))).toBe(false);
  });

  it("geçersiz sayı, boş istem ve yetersiz kredi sağlayıcıya gitmeden reddedilir", async () => {
    const id = await newUser();
    const images = provider([{ data: JPEG, contentType: "image/jpeg" }]);
    const run = (text: string, count: number, userId = id) =>
      generateImages(db, { images, storage }, userId, { text, count }, now);
    expect(await run("x", 3)).toEqual({ ok: false, error: "invalidInput" });
    expect(await run("  ", 1)).toEqual({ ok: false, error: "invalidInput" });

    const poor = await registerUser(
      db,
      { name: "B", email: "b@example.com", password: "gizli-sifre-1" },
      now,
    );
    if (!poor.ok) throw new Error(poor.error);
    expect(await run("x", 1, poor.userId)).toEqual({ ok: false, error: "insufficient" });
    expect(images.calls).toBe(0);
  });

  it("10 dakikada 30 istek sınırı", async () => {
    const id = await newUser();
    const images = provider([{ data: JPEG, contentType: "image/jpeg" }]);
    for (let i = 0; i < 30; i++) {
      expect(
        (await generateImages(db, { images, storage }, id, { text: "x", count: 1 }, now)).ok,
      ).toBe(true);
    }
    expect(
      await generateImages(db, { images, storage }, id, { text: "x", count: 1 }, now),
    ).toMatchObject({
      ok: false,
      error: "tooManyAttempts",
    });
  });

  it("dosya yalnız sahibine sunulur; silinince dosyalar da gider", async () => {
    const owner = await newUser("sahip@example.com");
    const other = await newUser("baska@example.com");
    const images = provider([{ data: JPEG, contentType: "image/jpeg" }]);
    const res = await generateImages(db, { images, storage }, owner, { text: "x", count: 1 }, now);
    if (!res.ok) throw new Error(res.error);
    const gid = res.generation.id;
    const request = (token?: string, index = "0") =>
      new Request(`http://localhost:8080/media/file/${gid}/${index}`, {
        headers: token ? { cookie: `trai_session=${encodeURIComponent(token)}` } : {},
      });
    const mine = await createSession(db, owner, now);
    const theirs = await createSession(db, other, now);

    const ok = await serveFile(request(mine.token), gid, "0", { db, storage, now });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect((await serveFile(request(theirs.token), gid, "0", { db, storage, now })).status).toBe(
      404,
    );
    expect((await serveFile(request(mine.token, "1"), gid, "1", { db, storage, now })).status).toBe(
      404,
    );
    expect((await serveFile(request(mine.token, "x"), gid, "x", { db, storage, now })).status).toBe(
      404,
    );
    expect((await serveFile(request(), gid, "0", { db, storage, now })).status).toBe(401);

    await removeGeneration(db, owner, gid, storage);
    expect(existsSync(join(root, owner, `${gid}-0.jpg`))).toBe(false);
  });

  it("hesap silinince kullanıcının görsel dosyaları silinir", async () => {
    const id = await newUser();
    const images = provider([{ data: JPEG, contentType: "image/jpeg" }]);
    await generateImages(db, { images, storage }, id, { text: "x", count: 1 }, now);
    expect(existsSync(join(root, id))).toBe(true);
    await deleteAccount(
      db,
      id,
      { confirmEmail: "ayse@example.com", password: "gizli-sifre-1" },
      null,
      now,
      { tts: null, storage },
    );
    expect(existsSync(join(root, id))).toBe(false);
  });
});

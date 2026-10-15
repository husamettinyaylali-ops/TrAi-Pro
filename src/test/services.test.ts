// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { balance } from "@/lib/credits";
import { openDb, type Db } from "@/server/db.server";
import { hashPassword, verifyPassword } from "@/server/password.server";
import {
  addVoiceClone,
  authenticate,
  createSession,
  deleteSession,
  generateContent,
  getSessionUser,
  loadUserData,
  purchasePackage,
  registerUser,
  removeGeneration,
} from "@/server/services.server";

const now = new Date("2026-10-15T09:00:00Z");
const later = (days: number) => new Date(now.getTime() + days * 86_400_000);

// Her test kendi geçici SQLite dosyasını kullanır; klasör en sonda silinir.
const dir = mkdtempSync(join(tmpdir(), "trai-test-"));
let db: Db;

beforeEach(async () => {
  db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
});

afterEach(() => db.$client.close());

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir; geçici klasörü işletim sistemi temizler.
  }
});

async function newUser(email = "ayse@example.com") {
  const res = await registerUser(db, { name: "Ayşe", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  return res.userId;
}

describe("şifre", () => {
  it("özet doğru şifreyi kabul eder, yanlışı reddeder", async () => {
    const h = await hashPassword("parola-123");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain("parola-123");
    expect(await verifyPassword("parola-123", h)).toBe(true);
    expect(await verifyPassword("parola-124", h)).toBe(false);
  });
});

describe("kayıt ve giriş", () => {
  it("kayıtta 5.000 deneme kredisi tanımlanır", async () => {
    const id = await newUser();
    const data = await loadUserData(db, id);
    expect(balance(data.grants, "voice", now)).toBe(5_000);
    expect(data.grants[0]!.expiresAt).toBe("2026-10-22T09:00:00.000Z");
  });

  it("aynı e-posta büyük/küçük harf farkıyla da ikinci kez kaydedilemez", async () => {
    await newUser("ayse@example.com");
    const res = await registerUser(
      db,
      { name: "X", email: " AYSE@example.com ", password: "baska-sifre" },
      now,
    );
    expect(res).toEqual({ ok: false, error: "emailTaken" });
  });

  it("yanlış şifre ve bilinmeyen e-posta aynı hatayı verir", async () => {
    const id = await newUser();
    expect(
      await authenticate(db, { email: "ayse@example.com", password: "gizli-sifre-1" }),
    ).toEqual({ ok: true, userId: id });
    expect(await authenticate(db, { email: "ayse@example.com", password: "yanlis" })).toEqual({
      ok: false,
      error: "invalidCredentials",
    });
    expect(await authenticate(db, { email: "yok@example.com", password: "gizli-sifre-1" })).toEqual(
      { ok: false, error: "invalidCredentials" },
    );
  });
});

describe("oturum", () => {
  it("token düz metin saklanmaz; süresi dolunca geçersiz olur", async () => {
    const id = await newUser();
    const { token } = await createSession(db, id, now);
    const rows = await db.query.sessions.findMany();
    expect(rows[0]!.id).not.toBe(token);
    expect((await getSessionUser(db, token, now))?.id).toBe(id);
    expect(await getSessionUser(db, token, later(31))).toBeNull();
  });

  it("çıkışta oturum silinir", async () => {
    const id = await newUser();
    const { token } = await createSession(db, id, now);
    await deleteSession(db, token);
    expect(await getSessionUser(db, token, now)).toBeNull();
  });
});

describe("satın alma ve üretim", () => {
  it("paket alınınca sipariş ve kredi eklenir", async () => {
    const id = await newUser();
    const res = await purchasePackage(db, id, { packageId: "voice-1m", method: "card" }, now);
    expect(res.ok && res.order.amountUsd).toBe(22);
    const data = await loadUserData(db, id);
    expect(data.orders).toHaveLength(1);
    expect(balance(data.grants, "voice", now)).toBe(1_005_000);
  });

  it("bilinmeyen paket reddedilir", async () => {
    const id = await newUser();
    expect(await purchasePackage(db, id, { packageId: "bedava", method: "card" }, now)).toEqual({
      ok: false,
      error: "invalidInput",
    });
  });

  it("seslendirme maliyeti sunucuda hesaplanır ve önce erken dolan paketten düşer", async () => {
    const id = await newUser();
    await purchasePackage(db, id, { packageId: "voice-250k", method: "card" }, now);
    const res = await generateContent(
      db,
      id,
      { type: "tts", text: "  Merhaba dünya  ", voiceId: "defne" },
      now,
    );
    expect(res.ok && res.generation.cost).toBe(13);
    const data = await loadUserData(db, id);
    expect(data.grants.find((g) => g.packageId === "signup-bonus")!.remaining).toBe(4_987);
    expect(data.grants.find((g) => g.packageId === "voice-250k")!.remaining).toBe(250_000);
  });

  it("video ve görsel kredisi yoksa üretim yapılmaz, kayıt oluşmaz", async () => {
    const id = await newUser();
    expect(await generateContent(db, id, { type: "image", text: "kedi", count: 2 }, now)).toEqual({
      ok: false,
      error: "insufficient",
    });
    expect((await loadUserData(db, id)).generations).toHaveLength(0);
  });

  it("geçersiz girdiler reddedilir", async () => {
    const id = await newUser();
    await purchasePackage(db, id, { packageId: "media-2d", method: "card" }, now);
    const bad = [
      { type: "tts", text: "   ", voiceId: "defne" },
      { type: "tts", text: "merhaba", voiceId: "baskasinin-klonu" },
      { type: "image", text: "kedi", count: 3 },
      { type: "video", text: "gemi", styleIndex: 9 },
    ] as const;
    for (const input of bad)
      expect(await generateContent(db, id, input, now)).toEqual({
        ok: false,
        error: "invalidInput",
      });
  });

  it("görsel 1, video 5 kredi düşer", async () => {
    const id = await newUser();
    await purchasePackage(db, id, { packageId: "media-2d", method: "card" }, now);
    await generateContent(db, id, { type: "image", text: "kedi", count: 4 }, now);
    await generateContent(db, id, { type: "video", text: "gemi", styleIndex: 1 }, now);
    expect(balance((await loadUserData(db, id)).grants, "media", now)).toBe(91);
  });

  it("kullanıcı başkasının üretimini silemez", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const res = await generateContent(db, a, { type: "tts", text: "selam", voiceId: "defne" }, now);
    if (!res.ok) throw new Error(res.error);
    await removeGeneration(db, b, res.generation.id);
    expect((await loadUserData(db, a)).generations).toHaveLength(1);
    await removeGeneration(db, a, res.generation.id);
    expect((await loadUserData(db, a)).generations).toHaveLength(0);
  });
});

describe("ses klonu", () => {
  it("en fazla 5 klon; klon yalnız sahibinin seslendirmesinde kullanılır", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const first = await addVoiceClone(db, a, "Benim sesim", now);
    if (!first.ok) throw new Error(first.error);
    for (let i = 0; i < 4; i++) await addVoiceClone(db, a, `Ses ${i}`, now);
    expect(await addVoiceClone(db, a, "Altıncı", now)).toEqual({ ok: false, error: "limit" });

    expect(
      (await generateContent(db, a, { type: "tts", text: "selam", voiceId: first.id }, now)).ok,
    ).toBe(true);
    expect(
      await generateContent(db, b, { type: "tts", text: "selam", voiceId: first.id }, now),
    ).toEqual({ ok: false, error: "invalidInput" });
  });
});

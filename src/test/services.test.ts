// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { balance } from "@/lib/credits";
import { findPackage } from "@/lib/packages";
import { MIN_TOPUP_CENTS } from "@/lib/wallet";
import { openDb, type Db } from "@/server/db.server";
import { hashPassword, verifyPassword } from "@/server/password.server";
import {
  addVoiceClone,
  authenticate,
  changePassword,
  deleteAccount,
  demoTopUp,
  linkGoogle,
  createSession,
  deleteSession,
  generateContent,
  getSessionUser,
  loadUserData,
  markEmailVerified,
  purchasePackage,
  registerLimited,
  registerUser,
  removeGeneration,
  revokeOtherSessions,
  signInLimited,
  signInWithGoogle,
  unlinkGoogle,
  updateName,
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

/** Kayıt + e-posta doğrulama (deneme kredisi doğrulamada tanımlanır). */
async function newUser(email = "ayse@example.com", { verified = true } = {}) {
  const res = await registerUser(db, { name: "Ayşe", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  if (verified) await markEmailVerified(db, res.userId, now);
  return res.userId;
}

/** Paket fiyatı kadar demo bakiye yükleyip paketi bakiyeden alır. */
async function buy(userId: string, packageId: string) {
  const pkg = findPackage(packageId);
  if (pkg) {
    const res = await demoTopUp(
      db,
      userId,
      Math.max(MIN_TOPUP_CENTS, Math.round(pkg.priceUsd * 100)),
      now,
    );
    if (!res.ok) throw new Error(res.error);
  }
  return purchasePackage(db, userId, { packageId }, now);
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
  it("kayıtta kredi yok; e-posta doğrulanınca 5.000 deneme kredisi bir kez tanımlanır", async () => {
    const id = await newUser("ayse@example.com", { verified: false });
    const before = await loadUserData(db, id);
    expect(before.grants).toHaveLength(0);
    expect(before.security.emailVerified).toBe(false);

    await markEmailVerified(db, id, now);
    await markEmailVerified(db, id, now);
    const data = await loadUserData(db, id);
    expect(data.security.emailVerified).toBe(true);
    expect(balance(data.grants, "voice", now)).toBe(5_000);
    expect(data.grants).toHaveLength(1);
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
    const res = await buy(id, "voice-1m");
    expect(res.ok && res.order.amountUsd).toBe(22);
    const data = await loadUserData(db, id);
    expect(data.orders).toHaveLength(1);
    expect(balance(data.grants, "voice", now)).toBe(1_005_000);
  });

  it("bilinmeyen paket reddedilir", async () => {
    const id = await newUser();
    expect(await buy(id, "bedava")).toEqual({
      ok: false,
      error: "invalidInput",
    });
  });

  it("seslendirme maliyeti sunucuda hesaplanır ve önce erken dolan paketten düşer", async () => {
    const id = await newUser();
    await buy(id, "voice-250k");
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
    await buy(id, "media-2d");
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
    await buy(id, "media-2d");
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

describe("deneme sınırı", () => {
  const ip = "203.0.113.7";
  const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

  it("e-posta başına 5 yanlış denemeden sonra doğru şifre de 15 dakika reddedilir", async () => {
    await newUser();
    for (let i = 0; i < 5; i++) {
      const res = await signInLimited(
        db,
        { email: "ayse@example.com", password: "yanlis" },
        ip,
        now,
      );
      expect(res).toEqual({ ok: false, error: "invalidCredentials" });
    }
    const blocked = await signInLimited(
      db,
      { email: "ayse@example.com", password: "gizli-sifre-1" },
      ip,
      now,
    );
    expect(blocked).toEqual({ ok: false, error: "tooManyAttempts", retryAfterMinutes: 15 });
    const later = await signInLimited(
      db,
      { email: "ayse@example.com", password: "gizli-sifre-1" },
      ip,
      minutes(16),
    );
    expect(later.ok).toBe(true);
  });

  it("başarılı giriş e-posta sayacını sıfırlar", async () => {
    await newUser();
    for (let i = 0; i < 4; i++)
      await signInLimited(db, { email: "ayse@example.com", password: "yanlis" }, ip, now);
    expect(
      (await signInLimited(db, { email: "ayse@example.com", password: "gizli-sifre-1" }, ip, now))
        .ok,
    ).toBe(true);
    for (let i = 0; i < 4; i++)
      await signInLimited(db, { email: "ayse@example.com", password: "yanlis" }, ip, now);
    expect(
      (await signInLimited(db, { email: "ayse@example.com", password: "gizli-sifre-1" }, ip, now))
        .ok,
    ).toBe(true);
  });

  it("aynı IP'den farklı e-postalara 20 yanlış denemeden sonra IP engellenir", async () => {
    await newUser();
    for (let i = 0; i < 20; i++) {
      await signInLimited(db, { email: `kisi${i}@example.com`, password: "yanlis" }, ip, now);
    }
    const res = await signInLimited(
      db,
      { email: "ayse@example.com", password: "gizli-sifre-1" },
      ip,
      now,
    );
    expect(res.ok === false && res.error).toBe("tooManyAttempts");
    expect(
      (
        await signInLimited(
          db,
          { email: "ayse@example.com", password: "gizli-sifre-1" },
          "198.51.100.1",
          now,
        )
      ).ok,
    ).toBe(true);
  });

  it("aynı IP'den saatte en fazla 5 kayıt denemesi", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await registerLimited(
        db,
        { name: "K", email: `k${i}@example.com`, password: "gizli-sifre-1" },
        ip,
        now,
      );
      expect(res.ok).toBe(true);
    }
    const sixth = await registerLimited(
      db,
      { name: "K", email: "k6@example.com", password: "gizli-sifre-1" },
      ip,
      now,
    );
    expect(sixth).toEqual({ ok: false, error: "tooManyAttempts", retryAfterMinutes: 60 });
    expect(
      (
        await registerLimited(
          db,
          { name: "K", email: "k6@example.com", password: "gizli-sifre-1" },
          ip,
          minutes(61),
        )
      ).ok,
    ).toBe(true);
  });
});

describe("hesap yönetimi", () => {
  const ip = "203.0.113.9";
  const google = { sub: "g-1", email: "ayse.g@example.com", emailVerified: true, name: "Ayşe G" };

  it("ad değiştirilir; boş ad reddedilir", async () => {
    const id = await newUser();
    expect(await updateName(db, id, "  Ayşe Kaya ")).toEqual({ ok: true });
    expect((await db.query.users.findFirst())?.name).toBe("Ayşe Kaya");
    expect(await updateName(db, id, "   ")).toEqual({ ok: false, error: "invalidInput" });
  });

  it("şifre değişimi mevcut şifreyi ister, diğer oturumları kapatır", async () => {
    const id = await newUser();
    const keep = await createSession(db, id, now);
    const other = await createSession(db, id, now);

    expect(
      await changePassword(
        db,
        id,
        { current: "yanlis", next: "yeni-sifre-1" },
        keep.token,
        ip,
        now,
      ),
    ).toEqual({
      ok: false,
      error: "invalidCredentials",
    });
    expect(
      await changePassword(db, id, { current: "gizli-sifre-1", next: "kisa" }, keep.token, ip, now),
    ).toEqual({
      ok: false,
      error: "invalidInput",
    });
    expect(
      await changePassword(
        db,
        id,
        { current: "gizli-sifre-1", next: "yeni-sifre-1" },
        keep.token,
        ip,
        now,
      ),
    ).toEqual({ ok: true });

    expect(await getSessionUser(db, keep.token, now)).not.toBeNull();
    expect(await getSessionUser(db, other.token, now)).toBeNull();
    expect(
      (await authenticate(db, { email: "ayse@example.com", password: "yeni-sifre-1" })).ok,
    ).toBe(true);
    expect(
      (await authenticate(db, { email: "ayse@example.com", password: "gizli-sifre-1" })).ok,
    ).toBe(false);
  });

  it("Google ile açılan hesap mevcut şifre olmadan ilk şifresini belirler", async () => {
    const res = await signInWithGoogle(db, google, now);
    if (!res.ok) throw new Error(res.error);
    const { token } = await createSession(db, res.userId, now);
    expect((await loadUserData(db, res.userId)).security).toEqual({
      hasPassword: false,
      googleLinked: true,
      emailVerified: true,
    });
    expect(await changePassword(db, res.userId, { next: "ilk-sifre-1" }, token, ip, now)).toEqual({
      ok: true,
    });
    expect((await loadUserData(db, res.userId)).security.hasPassword).toBe(true);
  });

  it("diğer oturumları kapat", async () => {
    const id = await newUser();
    const keep = await createSession(db, id, now);
    const other = await createSession(db, id, now);
    await revokeOtherSessions(db, id, keep.token);
    expect(await getSessionUser(db, keep.token, now)).not.toBeNull();
    expect(await getSessionUser(db, other.token, now)).toBeNull();
  });

  it("şifreli hesaba Google bağlanır; aynı Google başka hesaba bağlanamaz", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    expect(await linkGoogle(db, a, google, now)).toEqual({ ok: true });
    expect((await loadUserData(db, a)).security).toEqual({
      hasPassword: true,
      googleLinked: true,
      emailVerified: true,
    });
    expect(await linkGoogle(db, b, google, now)).toEqual({
      ok: false,
      error: "googleAlreadyLinked",
    });
    expect(await linkGoogle(db, a, { ...google, sub: "g-2" }, now)).toEqual({
      ok: false,
      error: "googleAlreadyLinked",
    });
    // Bağlandıktan sonra Google ile giriş aynı hesaba gider.
    expect(await signInWithGoogle(db, google, now)).toEqual({
      ok: true,
      userId: a,
      created: false,
    });
  });

  it("şifresiz hesapta Google bağlantısı kaldırılamaz", async () => {
    const res = await signInWithGoogle(db, google, now);
    if (!res.ok) throw new Error(res.error);
    expect(await unlinkGoogle(db, res.userId)).toEqual({ ok: false, error: "noPassword" });
    const a = await newUser("a@example.com");
    await linkGoogle(db, a, { ...google, sub: "g-2" }, now);
    expect(await unlinkGoogle(db, a)).toEqual({ ok: true });
    expect((await loadUserData(db, a)).security.googleLinked).toBe(false);
  });

  it("hesap silme e-posta onayı ve şifre ister; tüm veriyi siler", async () => {
    const id = await newUser();
    const other = await newUser("b@example.com");
    await createSession(db, id, now);
    await buy(id, "media-2d");
    await generateContent(db, id, { type: "image", text: "kedi", count: 1 }, now);
    await addVoiceClone(db, id, "Sesim", now);

    expect(
      await deleteAccount(
        db,
        id,
        { confirmEmail: "baska@example.com", password: "gizli-sifre-1" },
        ip,
        now,
      ),
    ).toEqual({
      ok: false,
      error: "confirmMismatch",
    });
    expect(
      await deleteAccount(
        db,
        id,
        { confirmEmail: "AYSE@example.com", password: "yanlis" },
        ip,
        now,
      ),
    ).toEqual({
      ok: false,
      error: "invalidCredentials",
    });
    expect(
      await deleteAccount(
        db,
        id,
        { confirmEmail: "AYSE@example.com", password: "gizli-sifre-1" },
        ip,
        now,
      ),
    ).toEqual({ ok: true });

    for (const table of [
      "users",
      "sessions",
      "credit_grants",
      "orders",
      "generations",
      "voice_clones",
    ]) {
      const rows = await db.$client.execute({
        sql: `select count(*) n from ${table} where ${table === "users" ? "id" : "user_id"} = ?`,
        args: [id],
      });
      expect(Number(rows.rows[0]!["n"]), table).toBe(0);
    }
    // Diğer kullanıcıya dokunulmaz.
    expect((await loadUserData(db, other)).grants).toHaveLength(1);
  });
});

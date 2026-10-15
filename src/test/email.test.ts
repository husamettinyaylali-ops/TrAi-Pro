// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveAppUrl } from "@/lib/app-url";
import { balance } from "@/lib/credits";
import { openDb, type Db } from "@/server/db.server";
import { memoryMailer } from "@/server/email.server";
import { verifyEmailTemplate } from "@/server/email-templates.server";
import { users } from "@/server/schema.server";
import {
  authenticate,
  createSession,
  getSessionUser,
  loadUserData,
  markEmailVerified,
  registerUser,
  requestPasswordReset,
  resendVerification,
  resetPasswordWithToken,
  sendPasswordChangedNotice,
  sendVerificationEmail,
  signInLimited,
  signInWithGoogle,
  verifyEmailWithToken,
  type MailContext,
} from "@/server/services.server";

const now = new Date("2026-10-15T09:00:00Z");
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const appUrl = "https://trai.example";

const dir = mkdtempSync(join(tmpdir(), "trai-email-"));
let db: Db;
let mailer: ReturnType<typeof memoryMailer>;
let ctx: MailContext;

beforeEach(async () => {
  db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
  mailer = memoryMailer();
  ctx = { mailer, appUrl, lang: "tr" };
});

afterEach(() => db.$client.close());

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

async function newUser(email = "ayse@example.com") {
  const res = await registerUser(db, { name: "Ayşe", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  return res.userId;
}

/** Son gönderilen e-postadaki token. */
function lastToken(path: string): string {
  const text = mailer.sent.at(-1)!.text;
  const m = text.match(new RegExp(`${appUrl}${path}\\?token=([A-Za-z0-9_-]+)`));
  if (!m) throw new Error(`Bağlantı bulunamadı: ${text}`);
  return m[1]!;
}

describe("bağlantı kökü", () => {
  it("PUBLIC_URL varsa her zaman o kullanılır", () => {
    expect(resolveAppUrl("https://trai.example/", "http://kotu.example/x", true)).toBe(
      "https://trai.example",
    );
  });

  it("yayında PUBLIC_URL yoksa istek adresine güvenilmez", () => {
    expect(resolveAppUrl(undefined, "http://kotu.example/x", true)).toBeNull();
  });

  it("geliştirmede isteğin kökeni kullanılır", () => {
    expect(resolveAppUrl(undefined, "http://localhost:8080/sign-up", false)).toBe(
      "http://localhost:8080",
    );
  });
});

describe("e-posta doğrulama", () => {
  it("doğrulama e-postası gider; bağlantı e-postayı doğrular ve krediyi tanımlar", async () => {
    const id = await newUser();
    expect(await sendVerificationEmail(db, ctx, id, now)).toEqual({ ok: true });
    expect(mailer.sent[0]!.to).toBe("ayse@example.com");
    expect(mailer.sent[0]!.subject).toContain("doğrula");

    const token = lastToken("/verify-email");
    expect(await verifyEmailWithToken(db, token, later(5))).toEqual({ ok: true, userId: id });
    const data = await loadUserData(db, id);
    expect(data.security.emailVerified).toBe(true);
    expect(balance(data.grants, "voice", later(5))).toBe(5_000);
  });

  it("token tek kullanımlıktır ve düz metin saklanmaz", async () => {
    const id = await newUser();
    await sendVerificationEmail(db, ctx, id, now);
    const token = lastToken("/verify-email");
    const rows = await db.query.emailTokens.findMany();
    expect(rows[0]!.id).not.toBe(token);
    await verifyEmailWithToken(db, token, now);
    expect(await verifyEmailWithToken(db, token, now)).toEqual({
      ok: false,
      error: "invalidToken",
    });
  });

  it("24 saat sonra token geçersizdir", async () => {
    const id = await newUser();
    await sendVerificationEmail(db, ctx, id, now);
    expect(await verifyEmailWithToken(db, lastToken("/verify-email"), later(24 * 60 + 1))).toEqual({
      ok: false,
      error: "expiredToken",
    });
  });

  it("yeni token eskisini geçersiz kılar", async () => {
    const id = await newUser();
    await sendVerificationEmail(db, ctx, id, now);
    const old = lastToken("/verify-email");
    await sendVerificationEmail(db, ctx, id, now);
    expect(await verifyEmailWithToken(db, old, now)).toEqual({ ok: false, error: "invalidToken" });
    expect((await verifyEmailWithToken(db, lastToken("/verify-email"), now)).ok).toBe(true);
  });

  it("adres değiştiyse eski adrese giden bağlantı doğrulamaz", async () => {
    const id = await newUser();
    await sendVerificationEmail(db, ctx, id, now);
    await db.update(users).set({ email: "yeni@example.com" }).where(eq(users.id, id));
    expect(await verifyEmailWithToken(db, lastToken("/verify-email"), now)).toEqual({
      ok: false,
      error: "invalidToken",
    });
  });

  it("yeniden gönderme saatte 3; doğrulanmışsa gönderilmez", async () => {
    const id = await newUser();
    for (let i = 0; i < 3; i++) expect((await resendVerification(db, ctx, id, now)).ok).toBe(true);
    const fourth = await resendVerification(db, ctx, id, now);
    expect(fourth).toEqual({ ok: false, error: "tooManyAttempts", retryAfterMinutes: 60 });

    await markEmailVerified(db, id, now);
    expect(await resendVerification(db, ctx, id, later(61))).toEqual({
      ok: false,
      error: "alreadyVerified",
    });
  });

  it("gönderim hatası kullanıcıya hata olarak döner", async () => {
    const id = await newUser();
    const broken: MailContext = {
      ...ctx,
      mailer: {
        async send() {
          throw new Error("SMTP kapalı");
        },
      },
    };
    expect(await sendVerificationEmail(db, broken, id, now)).toEqual({
      ok: false,
      error: "sendFailed",
    });
  });
});

describe("şifre sıfırlama", () => {
  it("bilinmeyen e-postada aynı yanıt, e-posta gönderilmez", async () => {
    expect(await requestPasswordReset(db, ctx, "yok@example.com", "203.0.113.1", now)).toEqual({
      ok: true,
    });
    expect(mailer.sent).toHaveLength(0);
  });

  it("bağlantıyla şifre değişir, tüm oturumlar kapanır, e-posta doğrulanmış sayılır", async () => {
    const id = await newUser();
    const { token: session } = await createSession(db, id, now);
    expect(await requestPasswordReset(db, ctx, " AYSE@example.com ", null, now)).toEqual({
      ok: true,
    });
    expect(mailer.sent[0]!.subject).toContain("sıfırlama");

    const token = lastToken("/reset-password");
    expect(await resetPasswordWithToken(db, token, "kisa", now)).toEqual({
      ok: false,
      error: "invalidInput",
    });
    expect(await resetPasswordWithToken(db, token, "yepyeni-sifre", later(10))).toEqual({
      ok: true,
      userId: id,
    });

    expect(await getSessionUser(db, session, later(10))).toBeNull();
    expect(
      (await authenticate(db, { email: "ayse@example.com", password: "yepyeni-sifre" })).ok,
    ).toBe(true);
    expect(
      (await authenticate(db, { email: "ayse@example.com", password: "gizli-sifre-1" })).ok,
    ).toBe(false);
    expect((await loadUserData(db, id)).security.emailVerified).toBe(true);
    // Tek kullanımlık.
    expect(await resetPasswordWithToken(db, token, "baska-sifre-1", later(11))).toEqual({
      ok: false,
      error: "invalidToken",
    });
  });

  it("1 saat sonra sıfırlama bağlantısı geçersizdir", async () => {
    await newUser();
    await requestPasswordReset(db, ctx, "ayse@example.com", null, now);
    expect(
      await resetPasswordWithToken(db, lastToken("/reset-password"), "yepyeni-sifre", later(61)),
    ).toEqual({
      ok: false,
      error: "expiredToken",
    });
  });

  it("sıfırlama giriş kilidini açar", async () => {
    await newUser();
    for (let i = 0; i < 5; i++) {
      await signInLimited(db, { email: "ayse@example.com", password: "yanlis" }, null, now);
    }
    expect(
      (await signInLimited(db, { email: "ayse@example.com", password: "gizli-sifre-1" }, null, now))
        .ok,
    ).toBe(false);
    await requestPasswordReset(db, ctx, "ayse@example.com", null, now);
    await resetPasswordWithToken(db, lastToken("/reset-password"), "yepyeni-sifre", now);
    expect(
      (await signInLimited(db, { email: "ayse@example.com", password: "yepyeni-sifre" }, null, now))
        .ok,
    ).toBe(true);
  });

  it("aynı e-postaya saatte en fazla 3 sıfırlama isteği", async () => {
    await newUser();
    for (let i = 0; i < 3; i++) await requestPasswordReset(db, ctx, "ayse@example.com", null, now);
    expect(await requestPasswordReset(db, ctx, "ayse@example.com", null, now)).toEqual({
      ok: false,
      error: "tooManyAttempts",
      retryAfterMinutes: 60,
    });
    expect(mailer.sent).toHaveLength(3);
  });

  it("Google ile açılan şifresiz hesap sıfırlamayla şifre belirleyebilir", async () => {
    const g = await signInWithGoogle(
      db,
      { sub: "g-1", email: "zeynep@example.com", emailVerified: true, name: "Zeynep" },
      now,
    );
    if (!g.ok) throw new Error(g.error);
    await requestPasswordReset(db, ctx, "zeynep@example.com", null, now);
    await resetPasswordWithToken(db, lastToken("/reset-password"), "ilk-sifre-123", now);
    expect(
      (await authenticate(db, { email: "zeynep@example.com", password: "ilk-sifre-123" })).ok,
    ).toBe(true);
  });

  it("şifre değişti bildirimi sıfırlama bağlantısı içerir", async () => {
    const id = await newUser();
    await sendPasswordChangedNotice(db, ctx, id, now);
    expect(mailer.sent[0]!.subject).toContain("değiştirildi");
    expect(mailer.sent[0]!.text).toContain(`${appUrl}/forgot-password`);
  });
});

describe("Google ve doğrulanmış e-posta", () => {
  const profile = { sub: "g-9", email: "ayse@example.com", emailVerified: true, name: "Ayşe" };

  it("doğrulanmamış şifreli hesaba otomatik bağlanmaz", async () => {
    await newUser();
    expect(await signInWithGoogle(db, profile, now)).toEqual({
      ok: false,
      error: "googleEmailInUse",
    });
  });

  it("doğrulanmış şifreli hesaba otomatik bağlanır", async () => {
    const id = await newUser();
    await markEmailVerified(db, id, now);
    expect(await signInWithGoogle(db, profile, now)).toEqual({
      ok: true,
      userId: id,
      created: false,
    });
    expect((await loadUserData(db, id)).security.googleLinked).toBe(true);
  });
});

describe("şablonlar", () => {
  it("kullanıcı adı HTML'de kaçışlanır", () => {
    const t = verifyEmailTemplate(
      "tr",
      '<img src=x onerror="alert(1)">',
      `${appUrl}/verify-email?token=abc`,
    );
    expect(t.html).not.toContain("<img");
    expect(t.html).toContain("&lt;img");
  });

  it("İngilizce şablon", () => {
    const t = verifyEmailTemplate("en", "Ali", `${appUrl}/verify-email?token=abc`);
    expect(t.subject).toBe("TrAi Pro: verify your email address");
    expect(t.text).toContain("5,000 trial credits");
  });
});

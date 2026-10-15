import { createServerFn } from "@tanstack/react-start";
import {
  deleteCookie,
  getCookie,
  getRequest,
  getRequestIP,
  setCookie,
} from "@tanstack/react-start/server";
import { z } from "zod";

import { resolveAppUrl } from "@/lib/app-url";
import { clock } from "@/lib/clock";
import type { Lang } from "@/lib/i18n";
import type { Account, PaymentConfig, SessionPayload, StudioConfig } from "@/lib/types";

import { audioStorage } from "@/server/audio-storage.server";
import { checkUsdtTransfer, rpcClient, usdtConfig } from "@/server/bsc.server";
import { getDb } from "@/server/db.server";
import { getMailer } from "@/server/email.server";
import { env, isProduction } from "@/server/env.server";
import * as svc from "@/server/services.server";
import { SESSION_COOKIE } from "@/server/session.server";
import { cachedVoices, publicVoices, ttsProvider, voiceAllowList } from "@/server/tts.server";

// İstemci bu dosyadaki fonksiyonları RPC olarak çağırır; gövdeler yalnız sunucuda çalışır.

const parse =
  <T extends z.ZodTypeAny>(schema: T) =>
  (input: unknown): z.infer<T> =>
    schema.parse(input);

const email = z.string().trim().email().max(254);
const password = z.string().min(8).max(200);
const langSchema = z.enum(["tr", "en"]).optional();
const tokenSchema = z.string().min(20).max(200);

function setSessionCookie(token: string, expires: Date) {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    expires,
  });
}

/**
 * İsteğin IP'si. X-Forwarded-For yalnız TRUST_PROXY=on iken okunur;
 * aksi halde istemci sahte başlıkla sınırı aşabilir.
 */
function clientIp(): string | null {
  try {
    return getRequestIP({ xForwardedFor: env("TRUST_PROXY") === "on" }) ?? null;
  } catch {
    return null;
  }
}

/** E-posta bağlamı; yayında PUBLIC_URL yoksa bağlantı kurulamaz ve null döner. */
function mailContext(lang: Lang): svc.MailContext | null {
  const appUrl = resolveAppUrl(env("PUBLIC_URL"), getRequest().url, isProduction());
  if (!appUrl) {
    console.error("[e-posta] PUBLIC_URL tanımlı değil; e-posta bağlantısı kurulamıyor.");
    return null;
  }
  return { mailer: getMailer(), appUrl, lang };
}

async function currentSession(): Promise<{ user: Account; token: string } | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const user = await svc.getSessionUser(await getDb(), token, clock());
  return user ? { user, token } : null;
}

async function currentUser(): Promise<Account | null> {
  return (await currentSession())?.user ?? null;
}

async function payloadFor(user: Account): Promise<SessionPayload> {
  return { user, data: await svc.loadUserData(await getDb(), user.id, clock()) };
}

async function startSession(userId: string): Promise<SessionPayload> {
  const db = await getDb();
  const { token, expiresAt } = await svc.createSession(db, userId, clock());
  setSessionCookie(token, expiresAt);
  const user = await svc.getSessionUser(db, token, clock());
  if (!user) throw new Error("Oturum oluşturulamadı");
  return payloadFor(user);
}

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const user = await currentUser();
  return user ? payloadFor(user) : null;
});

export const signUp = createServerFn({ method: "POST" })
  .validator(
    parse(z.object({ name: z.string().trim().min(1).max(80), email, password, lang: langSchema })),
  )
  .handler(async ({ data }) => {
    const db = await getDb();
    const res = await svc.registerLimited(db, data, clientIp(), clock());
    if (!res.ok) return res;
    // Doğrulama e-postası gönderilemese de kayıt geçerlidir; kullanıcı yeniden isteyebilir.
    const ctx = mailContext(data.lang ?? "tr");
    if (ctx) await svc.sendVerificationEmail(db, ctx, res.userId, clock());
    return { ok: true as const, session: await startSession(res.userId) };
  });

export const signIn = createServerFn({ method: "POST" })
  .validator(parse(z.object({ email, password: z.string().min(1).max(200) })))
  .handler(async ({ data }) => {
    const res = await svc.signInLimited(await getDb(), data, clientIp(), clock());
    if (!res.ok) return res;
    return { ok: true as const, session: await startSession(res.userId) };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const token = getCookie(SESSION_COOKIE);
  if (token) await svc.deleteSession(await getDb(), token);
  deleteCookie(SESSION_COOKIE, { path: "/" });
  return { ok: true as const };
});

/** Demo ödemeler üretimde yalnız DEMO_PAYMENTS=on ise açıktır. */
const demoPaymentsEnabled = () => !isProduction() || env("DEMO_PAYMENTS") === "on";

/**
 * Açık ödeme yöntemleri ve alıcı bilgileri. Alıcı bilgileri (cüzdan adresi,
 * Binance kimliği, PayPal istemci kimliği) yalnız sunucu ortamından gelir.
 * Gerçek yöntemler kendi aşamalarında bağlanır; o zamana kadar kapalıdır.
 */
function paymentConfig(): PaymentConfig {
  return {
    demo: demoPaymentsEnabled(),
    usdtBep20: (() => {
      const usdt = usdtConfig();
      return usdt ? { address: usdt.address } : null;
    })(),
    binancePay: null,
    paypal: null,
  };
}

export const getPaymentConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PaymentConfig> => paymentConfig(),
);

/** Bakiye yükleme talebi. Demo yöntemi (yalnız geliştirmede) talebi hemen tamamlar. */
export const topUp = createServerFn({ method: "POST" })
  .validator(
    parse(
      z.object({
        method: z.enum(["usdt_bep20", "binance_pay", "paypal", "demo"]),
        amountCents: z.number().int(),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const cfg = paymentConfig();
    const db = await getDb();
    if (data.method === "demo") {
      if (!cfg.demo) return { ok: false as const, error: "methodDisabled" as const };
      const res = await svc.demoTopUp(db, user.id, data.amountCents, clock());
      if (!res.ok) return res;
      return { ok: true as const, intent: res.intent, session: await payloadFor(user) };
    }
    const enabled = { usdt_bep20: cfg.usdtBep20, binance_pay: cfg.binancePay, paypal: cfg.paypal }[
      data.method
    ];
    if (!enabled) return { ok: false as const, error: "methodDisabled" as const };
    const res = await svc.createTopUp(db, user.id, data, clock());
    if (!res.ok) return res;
    return { ok: true as const, intent: res.intent, session: await payloadFor(user) };
  });

/**
 * USDT (BEP20) ödemesini işlem kimliğiyle doğrular. Zincir herkese açık BSC
 * düğümünden sorgulanır; eşleşme kullanıcının bekleyen benzersiz tutarıyla yapılır.
 */
export const claimUsdt = createServerFn({ method: "POST" })
  .validator(parse(z.object({ txHash: z.string().max(100) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const cfg = usdtConfig();
    if (!cfg) return { ok: false as const, error: "methodDisabled" as const };
    const client = rpcClient(cfg.rpcUrl);
    const res = await svc.claimUsdtTopUp(
      await getDb(),
      user.id,
      data.txHash,
      (hash) => checkUsdtTransfer(client, hash, cfg.address, cfg.confirmations),
      clock(),
    );
    if (!res.ok) return res;
    return { ok: true as const, intent: res.intent, session: await payloadFor(user) };
  });

/** Paketi USD bakiyeden alır. */
export const purchase = createServerFn({ method: "POST" })
  .validator(parse(z.object({ packageId: z.string().max(40) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const res = await svc.purchasePackage(await getDb(), user.id, data, clock());
    if (!res.ok) return res;
    return { ok: true as const, order: res.order, session: await payloadFor(user) };
  });

const generateSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tts"), text: z.string().max(10_000), voiceId: z.string().max(80) }),
  z.object({ type: z.literal("image"), text: z.string().max(1_000), count: z.number().int() }),
  z.object({ type: z.literal("video"), text: z.string().max(1_000), styleIndex: z.number().int() }),
]);

/** ElevenLabs bağlıysa gerçek seslendirme bağımlılıkları; değilse null (demo kip). */
function speechDeps(): svc.SpeechDeps | null {
  const tts = ttsProvider();
  if (!tts) return null;
  return {
    tts,
    storage: audioStorage(),
    catalog: async () =>
      publicVoices(
        await cachedVoices(tts),
        await svc.clonedProviderIds(await getDb()),
        voiceAllowList(),
      ),
  };
}

/** Stüdyonun kipi ve hazır ses listesi. Liste alınamazsa canlı kipte boş döner. */
export const getStudioConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<StudioConfig> => {
    const deps = speechDeps();
    if (!deps) return { tts: "demo", cloning: false, voices: [] };
    try {
      const voices = await deps.catalog();
      return {
        tts: "live",
        cloning: true,
        voices: voices.map(({ id, name, gender }) => ({ id, name, gender })),
      };
    } catch (err) {
      console.error("[ses] ses listesi alınamadı:", err instanceof Error ? err.message : err);
      return { tts: "live", cloning: true, voices: [] };
    }
  },
);

export const generate = createServerFn({ method: "POST" })
  .validator(parse(generateSchema))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const db = await getDb();
    if (data.type === "tts") {
      // Servis bağlıyken demo seslendirmeye hiç düşülmez (sahte çıktıya kredi düşmesin).
      const deps = speechDeps();
      if (deps) {
        const res = await svc.generateSpeech(db, deps, user.id, data, clock());
        if (!res.ok) return res;
        return { ok: true as const, generation: res.generation, session: await payloadFor(user) };
      }
    }
    const res = await svc.generateContent(db, user.id, data, clock());
    if (!res.ok) return res;
    return { ok: true as const, generation: res.generation, session: await payloadFor(user) };
  });

export const deleteGeneration = createServerFn({ method: "POST" })
  .validator(parse(z.object({ id: z.string().max(80) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    await svc.removeGeneration(await getDb(), user.id, data.id, audioStorage());
    return { ok: true as const, session: await payloadFor(user) };
  });

/** Demo klon (yalnız ad). Servis bağlıyken kullanılmaz; gerçek klon uploadClone ile. */
export const addClone = createServerFn({ method: "POST" })
  .validator(parse(z.object({ name: z.string().max(80) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    if (ttsProvider()) return { ok: false as const, error: "invalidInput" as const };
    const res = await svc.addVoiceClone(await getDb(), user.id, data.name, clock());
    if (!res.ok) return res;
    return { ok: true as const, session: await payloadFor(user) };
  });

/** Gerçek ses klonu: FormData ile ad, izin onayı ve ses dosyası. */
export const uploadClone = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error("FormData bekleniyor");
    return input;
  })
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const tts = ttsProvider();
    const name = data.get("name");
    const file = data.get("file");
    if (!tts || typeof name !== "string" || !(file instanceof File)) {
      return { ok: false as const, error: "invalidInput" as const };
    }
    // Boyut, dosya belleğe okunmadan önce kontrol edilir.
    if (file.size > svc.MAX_CLONE_BYTES)
      return { ok: false as const, error: "invalidInput" as const };
    const res = await svc.createVoiceClone(
      await getDb(),
      { tts },
      user.id,
      {
        name,
        consent: data.get("consent") === "true",
        file: {
          name: file.name || "ornek",
          type: file.type,
          data: new Uint8Array(await file.arrayBuffer()),
        },
      },
      clock(),
    );
    if (!res.ok) return res;
    return { ok: true as const, session: await payloadFor(user) };
  });

export const deleteClone = createServerFn({ method: "POST" })
  .validator(parse(z.object({ id: z.string().max(80) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const res = await svc.deleteVoiceClone(await getDb(), { tts: ttsProvider() }, user.id, data.id);
    if (!res.ok) return res;
    return { ok: true as const, session: await payloadFor(user) };
  });

// ---------------------------------------------------------------- hesap yönetimi

const unauthorized = { ok: false as const, error: "unauthorized" as const };

export const updateProfile = createServerFn({ method: "POST" })
  .validator(parse(z.object({ name: z.string().max(200) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return unauthorized;
    const res = await svc.updateName(await getDb(), user.id, data.name);
    if (!res.ok) return res;
    const fresh = await currentUser();
    return { ok: true as const, session: await payloadFor(fresh ?? user) };
  });

export const changePassword = createServerFn({ method: "POST" })
  .validator(
    parse(
      z.object({
        current: z.string().max(200).optional(),
        next: z.string().max(200),
        lang: langSchema,
      }),
    ),
  )
  .handler(async ({ data }) => {
    const s = await currentSession();
    if (!s) return unauthorized;
    const db = await getDb();
    const res = await svc.changePassword(db, s.user.id, data, s.token, clientIp(), clock());
    if (!res.ok) return res;
    const ctx = mailContext(data.lang ?? "tr");
    if (ctx) await svc.sendPasswordChangedNotice(db, ctx, s.user.id, clock());
    return { ok: true as const, session: await payloadFor(s.user) };
  });

export const signOutOthers = createServerFn({ method: "POST" }).handler(async () => {
  const s = await currentSession();
  if (!s) return unauthorized;
  await svc.revokeOtherSessions(await getDb(), s.user.id, s.token);
  return { ok: true as const };
});

export const unlinkGoogle = createServerFn({ method: "POST" }).handler(async () => {
  const user = await currentUser();
  if (!user) return unauthorized;
  const res = await svc.unlinkGoogle(await getDb(), user.id);
  if (!res.ok) return res;
  return { ok: true as const, session: await payloadFor(user) };
});

export const deleteAccount = createServerFn({ method: "POST" })
  .validator(
    parse(
      z.object({ confirmEmail: z.string().max(254), password: z.string().max(200).optional() }),
    ),
  )
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return unauthorized;
    const res = await svc.deleteAccount(await getDb(), user.id, data, clientIp(), clock(), {
      tts: ttsProvider(),
      storage: audioStorage(),
    });
    if (!res.ok) return res;
    deleteCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true as const };
  });

// ---------------------------------------------------------------- e-posta doğrulama ve şifre sıfırlama

export const resendVerification = createServerFn({ method: "POST" })
  .validator(parse(z.object({ lang: langSchema })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return unauthorized;
    const ctx = mailContext(data.lang ?? "tr");
    if (!ctx) return { ok: false as const, error: "sendFailed" as const };
    return svc.resendVerification(await getDb(), ctx, user.id, clock());
  });

/** Doğrulama bağlantısı. Oturum aynı kullanıcıya aitse güncel veri de döner. */
export const verifyEmail = createServerFn({ method: "POST" })
  .validator(parse(z.object({ token: tokenSchema })))
  .handler(async ({ data }) => {
    const res = await svc.verifyEmailWithToken(await getDb(), data.token, clock());
    if (!res.ok) return res;
    const user = await currentUser();
    return user?.id === res.userId
      ? { ok: true as const, session: await payloadFor(user) }
      : { ok: true as const };
  });

/** Yanıt her durumda aynıdır; e-postanın kayıtlı olup olmadığı anlaşılmaz. */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator(parse(z.object({ email, lang: langSchema })))
  .handler(async ({ data }) => {
    const ctx = mailContext(data.lang ?? "tr");
    if (!ctx) return { ok: true as const };
    return svc.requestPasswordReset(await getDb(), ctx, data.email, clientIp(), clock());
  });

/** Yeni şifre; tüm oturumlar kapanır, kullanıcı yeni şifresiyle giriş yapar. */
export const resetPassword = createServerFn({ method: "POST" })
  .validator(
    parse(z.object({ token: tokenSchema, password: z.string().max(200), lang: langSchema })),
  )
  .handler(async ({ data }) => {
    const db = await getDb();
    const res = await svc.resetPasswordWithToken(db, data.token, data.password, clock());
    if (!res.ok) return res;
    deleteCookie(SESSION_COOKIE, { path: "/" });
    const ctx = mailContext(data.lang ?? "tr");
    if (ctx) await svc.sendPasswordChangedNotice(db, ctx, res.userId, clock());
    return { ok: true as const };
  });

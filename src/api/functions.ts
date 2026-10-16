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
import { LIMITS } from "@/lib/rate-limit";
import { clock } from "@/lib/clock";
import type { Lang } from "@/lib/i18n";
import type { Account, PaymentConfig, SessionPayload, StudioConfig } from "@/lib/types";

import {
  adjustBalance,
  adminEmails,
  adminOverview,
  completeIntentManually,
  isAdmin,
  recentActions,
  searchIntents,
  searchUsers,
  userDetail,
} from "@/server/admin.server";
import { fileStorage } from "@/server/file-storage.server";
import { binanceConfig, sharedIncoming } from "@/server/binance.server";
import { checkUsdtTransfer, rpcClient, usdtConfig } from "@/server/bsc.server";
import {
  createApiKey as createUserApiKey,
  listApiKeys as listUserApiKeys,
  revokeApiKey as revokeUserApiKey,
} from "@/server/api-keys.server";
import { getDb } from "@/server/db.server";
import { imageDeps, receiptContext, speechDeps, videoDeps } from "@/server/deps.server";
import { getMailer } from "@/server/email.server";
import { paypalConfig, sharedPaypal } from "@/server/paypal.server";
import { env, isProduction } from "@/server/env.server";
import * as projectSvc from "@/server/projects.server";
import { setupStatus, testIntegration } from "@/server/setup-check.server";
import * as svc from "@/server/services.server";
import { SESSION_COOKIE } from "@/server/session.server";
import { ttsProvider } from "@/server/tts.server";

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
  const db = await getDb();
  const [data, admin] = await Promise.all([
    svc.loadUserData(db, user.id, clock()),
    isAdmin(db, user.id, adminEmails(env("ADMIN_EMAILS"))),
  ]);
  return { user, data, admin };
}

/** Yönetici oturumu; değilse hata kodu. Her yönetim fonksiyonu önce bunu çağırır. */
async function requireAdmin(): Promise<
  { ok: true; user: Account } | { ok: false; error: "unauthorized" | "forbidden" }
> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const allowed = await isAdmin(await getDb(), user.id, adminEmails(env("ADMIN_EMAILS")));
  return allowed ? { ok: true, user } : { ok: false, error: "forbidden" };
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

/** Tamamlanan bakiye yüklemesinin makbuzu (her ödeme için bir kez; hata ödemeyi etkilemez). */
async function sendReceipt(intentId: string) {
  const ctx = receiptContext(getRequest().url);
  if (ctx) await svc.sendTopUpReceipt(await getDb(), ctx, intentId, clock());
}

/** Demo ödemeler üretimde yalnız DEMO_PAYMENTS=on ise açıktır. */
const demoPaymentsEnabled = () => !isProduction() || env("DEMO_PAYMENTS") === "on";

/**
 * Açık ödeme yöntemleri ve alıcı bilgileri. Alıcı bilgileri (cüzdan adresi,
 * Binance kimliği, PayPal istemci kimliği) yalnız sunucu ortamından gelir.
 * Yöntem, gerekli ortam değişkenleri tam değilse kapalıdır.
 */
function paymentConfig(): PaymentConfig {
  return {
    demo: demoPaymentsEnabled(),
    usdtBep20: (() => {
      const usdt = usdtConfig();
      return usdt ? { address: usdt.address } : null;
    })(),
    binancePay: (() => {
      const binance = binanceConfig();
      return binance ? { binanceId: binance.binanceId } : null;
    })(),
    paypal: (() => {
      const paypal = paypalConfig();
      return paypal ? { clientId: paypal.clientId, sandbox: paypal.sandbox } : null;
    })(),
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
        lang: langSchema,
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
    await sendReceipt(res.intent.id);
    return { ok: true as const, intent: res.intent, session: await payloadFor(user) };
  });

/**
 * Binance Pay ödemesini kontrol eder: hesabımıza gelen ödemeler arasında
 * kullanıcının bekleyen benzersiz tutarı aranır. Panel açıkken düzenli çağrılır.
 */
export const claimBinance = createServerFn({ method: "POST" }).handler(async () => {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "unauthorized" as const };
  const cfg = binanceConfig();
  if (!cfg) return { ok: false as const, error: "methodDisabled" as const };
  const res = await svc.claimBinanceTopUp(await getDb(), user.id, sharedIncoming(cfg), clock());
  if (!res.ok) return res;
  await sendReceipt(res.intent.id);
  return { ok: true as const, intent: res.intent, session: await payloadFor(user) };
});

/** Bekleyen PayPal talebi için PayPal siparişi açar (PayPal düğmesinin createOrder'ı). */
export const startPaypal = createServerFn({ method: "POST" })
  .validator(parse(z.object({ intentId: z.string().max(64) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const cfg = paypalConfig();
    if (!cfg) return { ok: false as const, error: "methodDisabled" as const };
    return svc.startPaypalOrder(await getDb(), user.id, data.intentId, sharedPaypal(cfg), clock());
  });

/** Kullanıcının onayladığı PayPal siparişini tahsil edip bakiyeye yazar (onApprove). */
export const capturePaypal = createServerFn({ method: "POST" })
  .validator(parse(z.object({ orderId: z.string().max(64) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const cfg = paypalConfig();
    if (!cfg) return { ok: false as const, error: "methodDisabled" as const };
    const res = await svc.capturePaypalTopUp(
      await getDb(),
      user.id,
      data.orderId,
      sharedPaypal(cfg),
      clock(),
    );
    if (!res.ok) return res;
    await sendReceipt(res.intent.id);
    return { ok: true as const, intent: res.intent, session: await payloadFor(user) };
  });

/** Paketi USD bakiyeden alır. */
export const purchase = createServerFn({ method: "POST" })
  .validator(parse(z.object({ packageId: z.string().max(40), lang: langSchema })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const db = await getDb();
    const res = await svc.purchasePackage(db, user.id, data, clock());
    if (!res.ok) return res;
    const ctx = receiptContext(getRequest().url);
    if (ctx)
      await svc.sendPurchaseReceipt(db, { ...ctx, lang: data.lang ?? "tr" }, user.id, res.order);
    return { ok: true as const, order: res.order, session: await payloadFor(user) };
  });

const id = z.string().min(1).max(80);
// Proje kullanıcının değilse sunucuda yok sayılır; ad düzeltilen sürüme eski adı taşır.
const generationMeta = { projectId: id.optional(), title: z.string().max(200).optional() };
const generateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tts"),
    text: z.string().max(10_000),
    voiceId: z.string().max(80),
    ...generationMeta,
  }),
  z.object({
    type: z.literal("image"),
    text: z.string().max(1_000),
    count: z.number().int(),
    ...generationMeta,
  }),
  z.object({
    type: z.literal("video"),
    text: z.string().max(1_000),
    styleIndex: z.number().int(),
    ...generationMeta,
  }),
]);

export const getStudioConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<StudioConfig> => {
    const image = imageDeps() ? ("live" as const) : ("demo" as const);
    const video = videoDeps() ? ("live" as const) : ("demo" as const);
    const deps = speechDeps();
    if (!deps) return { tts: "demo", cloning: false, image, video, voices: [] };
    try {
      const voices = await deps.catalog();
      return {
        tts: "live",
        cloning: true,
        image,
        video,
        voices: voices.map(({ id, name, gender }) => ({ id, name, gender })),
      };
    } catch (err) {
      console.error("[ses] ses listesi alınamadı:", err instanceof Error ? err.message : err);
      return { tts: "live", cloning: true, image, video, voices: [] };
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
    if (data.type === "image") {
      // Servis bağlıyken örnek görsele düşülmez (sahte çıktıya kredi düşmesin).
      const deps = imageDeps();
      if (deps) {
        const res = await svc.generateImages(db, deps, user.id, data, clock());
        if (!res.ok) return res;
        return { ok: true as const, generation: res.generation, session: await payloadFor(user) };
      }
    }
    if (data.type === "video") {
      const deps = videoDeps();
      if (deps) {
        const res = await svc.startVideo(db, deps, user.id, data, clock());
        if (!res.ok) return res;
        return { ok: true as const, generation: res.generation, session: await payloadFor(user) };
      }
    }
    const res = await svc.generateContent(db, user.id, data, clock());
    if (!res.ok) return res;
    return { ok: true as const, generation: res.generation, session: await payloadFor(user) };
  });

/** Hazırlanan videonun durumunu sağlayıcıdan sorar; stüdyo bekleyen video varken düzenli çağırır. */
export const checkVideo = createServerFn({ method: "POST" })
  .validator(parse(z.object({ id: z.string().max(80) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const deps = videoDeps();
    if (!deps) return { ok: false as const, error: "notFound" as const };
    const res = await svc.refreshVideo(await getDb(), deps, user.id, data.id, clock());
    if (!res.ok) return res;
    return { ok: true as const, generation: res.generation, session: await payloadFor(user) };
  });

export const deleteGeneration = createServerFn({ method: "POST" })
  .validator(parse(z.object({ id: z.string().max(80) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    await svc.removeGeneration(await getDb(), user.id, data.id, fileStorage());
    return { ok: true as const, session: await payloadFor(user) };
  });

/** Stüdyo/proje geçmişi: üretimler yeniden eskiye sayfa sayfa (oturum yanıtında yok). */
export const listGenerations = createServerFn({ method: "POST" })
  .validator(
    parse(
      z.object({
        type: z.enum(["tts", "image", "video"]).optional(),
        projectId: id.optional(),
        cursor: z.string().max(120).regex(svc.HISTORY_CURSOR_RE).optional(),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    return { ok: true as const, ...(await svc.listGenerations(await getDb(), user.id, data)) };
  });

/** Kullanıcının tek üretimi (proje sayfasından stüdyoda düzenlemeye açmak için). */
export const getGeneration = createServerFn({ method: "POST" })
  .validator(parse(z.object({ id })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    const generation = await svc.getGeneration(await getDb(), user.id, data.id);
    return generation
      ? { ok: true as const, generation }
      : { ok: false as const, error: "notFound" as const };
  });

/** Üretimi projeye taşır ya da projeden çıkarır (`projectId: null`). */
export const moveGeneration = createServerFn({ method: "POST" })
  .validator(parse(z.object({ id, projectId: id.nullable() })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    return svc.moveGeneration(await getDb(), user.id, data.id, data.projectId, clock());
  });

/** Üretime ad verir; boş ad adı kaldırır. */
export const renameGeneration = createServerFn({ method: "POST" })
  .validator(parse(z.object({ id, title: z.string().max(200) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    return svc.renameGeneration(await getDb(), user.id, data.id, data.title);
  });

// ---------------------------------------------------------------- projeler

const projectFields = { name: z.string().max(200), notes: z.string().max(10_000).optional() };

export const listProjects = createServerFn({ method: "POST" }).handler(async () => {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "unauthorized" as const };
  return { ok: true as const, projects: await projectSvc.listProjects(await getDb(), user.id) };
});

export const createProject = createServerFn({ method: "POST" })
  .validator(parse(z.object(projectFields)))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    return projectSvc.createProject(await getDb(), user.id, data, clock());
  });

export const updateProject = createServerFn({ method: "POST" })
  .validator(
    parse(z.object({ id, name: projectFields.name.optional(), notes: projectFields.notes })),
  )
  .handler(async ({ data: { id: projectId, ...changes } }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    return projectSvc.updateProject(await getDb(), user.id, projectId, changes, clock());
  });

/** Projeyi siler; üretimleri projesiz kalır. */
export const deleteProject = createServerFn({ method: "POST" })
  .validator(parse(z.object({ id })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    return projectSvc.deleteProject(await getDb(), user.id, data.id);
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
      storage: fileStorage(),
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

// ---------------------------------------------------------------- yönetim paneli

/** Kurulum kontrolü: hangi servisler yapılandırıldı (anahtar değerleri dönmez). */
export const adminSetup = createServerFn({ method: "POST" }).handler(async () => {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  return {
    ok: true as const,
    production: isProduction(),
    items: setupStatus(new URL(getRequest().url).origin),
  };
});

/** Bir servise bağlantı testi; e-posta testi yöneticinin kendi adresine gider. */
export const adminTestSetup = createServerFn({ method: "POST" })
  .validator(
    parse(
      z.object({
        id: z.enum([
          "site",
          "email",
          "tts",
          "fal",
          "google",
          "usdt",
          "binance",
          "paypal",
          "backup",
        ]),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth;
    const db = await getDb();
    const now = clock();
    const key = `setup:test:${auth.user.id}`;
    const limited = await svc.blocked(db, [[key, LIMITS.setupTestPerAdmin]], now);
    if (limited) return limited;
    await svc.recordAttempt(db, key, now);
    const result = await testIntegration(data.id, { adminEmail: auth.user.email, now });
    return { ok: true as const, result };
  });

/** Özet ve son yönetici işlemleri. */
export const adminDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const db = await getDb();
  const [overview, actions] = await Promise.all([
    adminOverview(db, clock()),
    recentActions(db, { limit: 30 }),
  ]);
  return { ok: true as const, overview, actions };
});

export const adminSearchUsers = createServerFn({ method: "POST" })
  .validator(parse(z.object({ query: z.string().max(200) })))
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth;
    return { ok: true as const, users: await searchUsers(await getDb(), data.query) };
  });

export const adminUserDetail = createServerFn({ method: "POST" })
  .validator(parse(z.object({ userId: z.string().max(64) })))
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth;
    const detail = await userDetail(await getDb(), data.userId);
    if (!detail) return { ok: false as const, error: "notFound" as const };
    return { ok: true as const, detail };
  });

export const adminAdjustBalance = createServerFn({ method: "POST" })
  .validator(
    parse(
      z.object({
        userId: z.string().max(64),
        amountCents: z.number().int(),
        reason: z.string().max(1000),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth;
    return adjustBalance(await getDb(), auth.user.id, data, clock());
  });

export const adminSearchIntents = createServerFn({ method: "POST" })
  .validator(parse(z.object({ query: z.string().max(200) })))
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth;
    return { ok: true as const, intents: await searchIntents(await getDb(), data.query) };
  });

/** Sağlayıcıda doğrulanmış ama eşleşmemiş ödemeyi elle tamamlar. */
export const adminCompleteIntent = createServerFn({ method: "POST" })
  .validator(
    parse(
      z.object({
        intentId: z.string().max(64),
        providerRef: z.string().max(200),
        reason: z.string().max(1000),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth;
    const res = await completeIntentManually(await getDb(), auth.user.id, data, clock());
    if (res.ok) await sendReceipt(res.intent.id);
    return res;
  });

// ---------------------------------------------------------------- geliştirici API anahtarları

export const listApiKeys = createServerFn({ method: "GET" }).handler(async () => {
  const user = await currentUser();
  if (!user) return { ok: false as const, error: "unauthorized" as const };
  return { ok: true as const, keys: await listUserApiKeys(await getDb(), user.id) };
});

/** Yeni anahtar; düz anahtar yalnız bu yanıtta döner. */
export const createApiKey = createServerFn({ method: "POST" })
  .validator(parse(z.object({ name: z.string().max(80) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    return createUserApiKey(await getDb(), user.id, data.name, clock());
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .validator(parse(z.object({ id: z.string().max(64) })))
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false as const, error: "unauthorized" as const };
    return revokeUserApiKey(await getDb(), user.id, data.id, clock());
  });

import { randomInt, randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  sum,
} from "drizzle-orm";

import {
  IMAGE_COUNTS,
  MAX_CLONES,
  MAX_TTS_CHARS,
  balance,
  createGrant,
  mediaCost,
  spend,
  ttsCost,
  type CreditKind,
  type Grant,
} from "@/lib/credits";
import { clock } from "@/lib/clock";
import { findPackage, signupBonus } from "@/lib/packages";
import { GENERATION_TITLE_MAX } from "@/lib/projects";
import {
  isDefaultVoiceSettings,
  normalizeVoiceSettings,
  type VoiceSettings,
} from "@/lib/voice-settings";
import { LIMITS, checkLimit, retryMinutes, type Limit } from "@/lib/rate-limit";
import {
  MAX_TOPUP_CENTS,
  MIN_TOPUP_CENTS,
  TOPUP_TTL_MS,
  centsFromAmount,
  formatCents,
  normalizeAmount,
  uniqueCryptoAmount,
  type AmountDecimals,
} from "@/lib/wallet";
import type {
  Account,
  ActionErrorCode,
  AuthErrorCode,
  ClaimErrorCode,
  EmailErrorCode,
  GenerateInput,
  GoogleErrorCode,
  Generation,
  GenerationPage,
  GenerationType,
  Order,
  RateLimited,
  TokenErrorCode,
  TopUpIntent,
  TopUpMethod,
  UserData,
} from "@/lib/types";
import { splitForSpeech } from "@/lib/speech-text";
import { stockVoices } from "@/lib/voices";

import type { Lang } from "@/lib/i18n";

import type { FileStorage } from "./file-storage.server";
import {
  ContentRejected,
  extensionOf,
  type GeneratedImage,
  type ImageProvider,
} from "./image.server";
import {
  VIDEO_STYLE_COUNT,
  stylePrompt,
  type VideoCheck,
  type VideoJob,
  type VideoProvider,
} from "./video.server";
import type { BinanceIncome, IncomingFetcher } from "./binance.server";
import {
  ORDER_ID_RE,
  type PaypalCapture,
  type PaypalClient,
  type PaypalMoney,
} from "./paypal.server";
import { TX_HASH_RE, type TransferCheck } from "./bsc.server";
import type { Db } from "./db.server";
import type { EmailMessage, Mailer } from "./email.server";
import {
  passwordChangedTemplate,
  purchaseReceiptTemplate,
  topUpReceiptTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from "./email-templates.server";
import type { GoogleProfile } from "./google.server";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password.server";
import {
  apiKeys,
  authAttempts,
  creditGrants,
  emailTokens,
  generations,
  oauthAccounts,
  orders,
  paymentIntents,
  projects,
  sessions,
  users,
  voiceClones,
  walletEntries,
} from "./schema.server";
import { SESSION_DAYS, hashToken, newSessionToken } from "./session.server";
import {
  TtsError,
  type CloneFile,
  type ProviderVoice,
  type SpeechResult,
  type TtsProvider,
} from "./tts.server";
import { buildCues, encodeCues, type Cue, type SpeechAlignment } from "./captions.server";
import { concatBytes, readMp3 } from "./mp3.server";

const DAY = 86_400_000;
const SAMPLE_IMAGE_COUNT = 4;

/** Üretimin projesi ve adı (düzeltilen sürüm eski adı taşır). */
export type GenerationMeta = Pick<GenerateInput, "projectId" | "title">;

export type Result<T, E extends string> = ({ ok: true } & T) | { ok: false; error: E };

export const normEmail = (e: string) => e.trim().toLocaleLowerCase("en-US");

// ---------------------------------------------------------------- hesap ve oturum

export async function registerUser(
  db: Db,
  input: { name: string; email: string; password: string },
  now: Date,
): Promise<Result<{ userId: string }, AuthErrorCode>> {
  const email = normEmail(input.email);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (existing) return { ok: false, error: "emailTaken" };

  const userId = randomUUID();
  const passwordHash = await hashPassword(input.password);
  // Deneme kredisi e-posta doğrulanınca tanımlanır (markEmailVerified).
  await db.insert(users).values({
    id: userId,
    name: input.name.trim(),
    email,
    passwordHash,
    createdAt: now.toISOString(),
  });
  return { ok: true, userId };
}

export type Conn = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * E-posta sahipliği kanıtlandı: doğrulama tarihini yazar ve deneme kredisini
 * (daha önce verilmediyse) tanımlar. Tekrar çağrılması zararsızdır.
 */
export async function markEmailVerified(conn: Conn, userId: string, now: Date): Promise<void> {
  await conn
    .update(users)
    .set({ emailVerifiedAt: now.toISOString() })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
  const bonus = await conn
    .select({ id: creditGrants.id })
    .from(creditGrants)
    .where(and(eq(creditGrants.userId, userId), eq(creditGrants.packageId, "signup-bonus")))
    .get();
  if (!bonus) {
    const grant = createGrant({ id: randomUUID(), packageId: "signup-bonus", ...signupBonus }, now);
    await conn.insert(creditGrants).values({ ...grant, userId });
  }
}

export async function authenticate(
  db: Db,
  input: { email: string; password: string },
): Promise<Result<{ userId: string }, AuthErrorCode>> {
  const row = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, normEmail(input.email)))
    .get();
  // Hesap yoksa da özet hesaplanır; yanıt süresi e-postanın kayıtlı olup olmadığını ele vermez.
  const valid = await verifyPassword(input.password, row?.passwordHash ?? DUMMY_HASH);
  if (!row || !valid) return { ok: false, error: "invalidCredentials" };
  return { ok: true, userId: row.id };
}

/**
 * Google profiliyle giriş ya da kayıt. Daha önce bağlanmış hesap varsa ona girilir.
 * Aynı e-postayla hesap varsa yalnız o hesabın e-postası doğrulanmışsa otomatik
 * bağlanır. Doğrulanmamış hesabı e-postanın sahibi değil başkası açmış olabilir;
 * bağlama o kişiye de erişim bırakırdı.
 */
export async function signInWithGoogle(
  db: Db,
  profile: GoogleProfile,
  now: Date,
): Promise<Result<{ userId: string; created: boolean }, GoogleErrorCode>> {
  if (!profile.emailVerified) return { ok: false, error: "googleUnverified" };

  const linked = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.providerUserId, profile.sub)))
    .get();
  if (linked) return { ok: true, userId: linked.userId, created: false };

  const email = normEmail(profile.email);
  const existing = await db
    .select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (existing) {
    if (!existing.emailVerifiedAt) return { ok: false, error: "googleEmailInUse" };
    const mine = await db
      .select({ sub: oauthAccounts.providerUserId })
      .from(oauthAccounts)
      .where(and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.userId, existing.id)))
      .get();
    if (mine) return { ok: false, error: "googleAlreadyLinked" };
    await db.insert(oauthAccounts).values({
      provider: "google",
      providerUserId: profile.sub,
      userId: existing.id,
      createdAt: now.toISOString(),
    });
    return { ok: true, userId: existing.id, created: false };
  }

  const userId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      name: profile.name.slice(0, 80),
      email,
      passwordHash: null,
      createdAt: now.toISOString(),
    });
    await tx.insert(oauthAccounts).values({
      provider: "google",
      providerUserId: profile.sub,
      userId,
      createdAt: now.toISOString(),
    });
    // Google e-postayı doğrulamıştır.
    await markEmailVerified(tx, userId, now);
  });
  return { ok: true, userId, created: true };
}

// ---------------------------------------------------------------- deneme sınırı

async function rateCheck(db: Db, key: string, limit: Limit, now: Date) {
  const since = new Date(now.getTime() - limit.windowMs).toISOString();
  const rows = await db
    .select({ at: authAttempts.createdAt })
    .from(authAttempts)
    .where(and(eq(authAttempts.key, key), gt(authAttempts.createdAt, since)));
  return checkLimit(
    rows.map((r) => r.at),
    limit,
    now,
  );
}

export async function recordAttempt(db: Db, key: string, now: Date) {
  await db.insert(authAttempts).values({ id: randomUUID(), key, createdAt: now.toISOString() });
  // Bir günden eski kayıtlar artık hiçbir pencereye girmez.
  await db
    .delete(authAttempts)
    .where(lt(authAttempts.createdAt, new Date(now.getTime() - DAY).toISOString()));
}

/** Kontrol edilen anahtarlardan en uzun bekleme süresini döner; hepsi serbestse null. */
export async function blocked(
  db: Db,
  checks: [key: string, limit: Limit][],
  now: Date,
): Promise<RateLimited | null> {
  let wait = 0;
  for (const [key, limit] of checks) {
    const res = await rateCheck(db, key, limit, now);
    if (!res.allowed) wait = Math.max(wait, res.retryAfterMs);
  }
  return wait > 0
    ? { ok: false, error: "tooManyAttempts", retryAfterMinutes: retryMinutes(wait) }
    : null;
}

const signInKeys = (email: string, ip: string | null) => ({
  email: `signin:email:${normEmail(email)}`,
  ip: ip ? `signin:ip:${ip}` : null,
});

/** Şifreyle giriş; başarısız denemeler e-posta ve IP başına sayılır, başarıda e-posta sayacı sıfırlanır. */
export async function signInLimited(
  db: Db,
  input: { email: string; password: string },
  ip: string | null,
  now: Date,
): Promise<Result<{ userId: string }, AuthErrorCode> | RateLimited> {
  const keys = signInKeys(input.email, ip);
  const checks: [string, Limit][] = [[keys.email, LIMITS.signInPerEmail]];
  if (keys.ip) checks.push([keys.ip, LIMITS.signInPerIp]);
  const stop = await blocked(db, checks, now);
  if (stop) return stop;

  const res = await authenticate(db, input);
  if (!res.ok) {
    for (const [key] of checks) await recordAttempt(db, key, now);
    return res;
  }
  await db.delete(authAttempts).where(eq(authAttempts.key, keys.email));
  return res;
}

/** Kayıt; IP başına her deneme sayılır (deneme kredisi toplamayı ve e-posta taramayı yavaşlatır). */
export async function registerLimited(
  db: Db,
  input: { name: string; email: string; password: string },
  ip: string | null,
  now: Date,
): Promise<Result<{ userId: string }, AuthErrorCode> | RateLimited> {
  const key = ip ? `signup:ip:${ip}` : null;
  if (key) {
    const stop = await blocked(db, [[key, LIMITS.signUpPerIp]], now);
    if (stop) return stop;
    await recordAttempt(db, key, now);
  }
  return registerUser(db, input, now);
}

export async function createSession(db: Db, userId: string, now: Date) {
  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY);
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  return { token, expiresAt };
}

export async function getSessionUser(db: Db, token: string, now: Date): Promise<Account | null> {
  const id = hashToken(token);
  const row = await db
    .select({
      expiresAt: sessions.expiresAt,
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  if (Date.parse(row.expiresAt) <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  return { id: row.id, name: row.name, email: row.email, createdAt: row.createdAt };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

// ---------------------------------------------------------------- kullanıcı verisi

type GrantRow = typeof creditGrants.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
export type GenerationRow = typeof generations.$inferSelect;

const toGrant = ({ userId: _u, ...g }: GrantRow): Grant => g;

export const toOrder = ({ userId: _u, amountCents, ...o }: OrderRow): Order => ({
  ...o,
  amountUsd: amountCents / 100,
});

export const toGeneration = (g: GenerationRow): Generation => ({
  id: g.id,
  type: g.type,
  text: g.text,
  voiceId: g.voiceId ?? undefined,
  style: g.style ?? undefined,
  images: g.images ?? undefined,
  audioUrl: g.audioKey ? `/media/audio/${g.id}` : undefined,
  fileUrls: g.files?.map((_, i) => `/media/file/${g.id}/${i}`),
  status: g.status ?? undefined,
  cost: g.cost,
  createdAt: g.createdAt,
  title: g.title ?? undefined,
  projectId: g.projectId ?? undefined,
  voiceSettings: g.voiceSettings ?? undefined,
  subtitleUrl: g.captionsKey ? `/media/subtitle/${g.id}` : undefined,
  progress: g.type === "tts" && g.status === "pending" ? speechProgress(g.id) : undefined,
  edit: g.editKind ?? undefined,
  sourceId: g.sourceId ?? undefined,
});

/** Kayda yazılacak ses ayarları: aralığa kırpılır; varsayılansa boş. */
function storedSettings(raw: Partial<VoiceSettings> | undefined): VoiceSettings | null {
  if (!raw) return null;
  const s = normalizeVoiceSettings(raw);
  return isDefaultVoiceSettings(s) ? null : s;
}

/** Kullanıcının verdiği ad: kırpılır; boşsa null, sınırı aşarsa geçersiz (undefined). */
export function cleanTitle(raw: string | null | undefined): string | null | undefined {
  const t = raw?.trim() ?? "";
  if (!t) return null;
  return [...t].length <= GENERATION_TITLE_MAX ? t : undefined;
}

export async function loadUserData(db: Db, userId: string, now: Date = clock()): Promise<UserData> {
  const [grantRows, orderRows, cloneRows, auth, google, wallet] = await Promise.all([
    db
      .select()
      .from(creditGrants)
      .where(eq(creditGrants.userId, userId))
      .orderBy(asc(creditGrants.grantedAt)),
    db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)),
    db
      .select({
        id: voiceClones.id,
        name: voiceClones.name,
        createdAt: voiceClones.createdAt,
        providerVoiceId: voiceClones.providerVoiceId,
      })
      .from(voiceClones)
      .where(eq(voiceClones.userId, userId))
      .orderBy(asc(voiceClones.createdAt)),
    db
      .select({ passwordHash: users.passwordHash, verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId))
      .get(),
    db
      .select({ sub: oauthAccounts.providerUserId })
      .from(oauthAccounts)
      .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, "google")))
      .get(),
    loadWallet(db, userId, now),
  ]);
  return {
    grants: grantRows.map(toGrant),
    orders: orderRows.map(toOrder),
    clones: cloneRows.map(({ providerVoiceId, ...c }) => ({
      ...c,
      live: Boolean(providerVoiceId),
    })),
    security: {
      hasPassword: Boolean(auth?.passwordHash),
      googleLinked: Boolean(google),
      emailVerified: Boolean(auth?.verifiedAt),
    },
    wallet,
  };
}

// ---------------------------------------------------------------- bakiye ve satın alma

type IntentRow = typeof paymentIntents.$inferSelect;

/** Bakiyeye yazılacak tutar: kriptoda ödenen benzersiz tutar (sente aşağı), diğerlerinde istenen tutar. */
const creditCentsFor = (r: Pick<IntentRow, "payCurrency" | "payAmount" | "amountCents">) =>
  r.payCurrency === "USDT" ? centsFromAmount(r.payAmount) : r.amountCents;

export const toIntent = (r: IntentRow): TopUpIntent => ({
  id: r.id,
  method: r.method,
  amountCents: r.amountCents,
  payAmount: r.payAmount,
  creditCents: creditCentsFor(r),
  payCurrency: r.payCurrency,
  status: r.status,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
});

/** Talep oluşturulmadan bu kadar önceki işlemler kabul edilmez (saat farkı payı). */
const CLAIM_CLOCK_SKEW_MS = 5 * 60_000;

type CryptoMethod = "usdt_bep20" | "binance_pay";
const CRYPTO_METHODS: ReadonlySet<TopUpMethod> = new Set<CryptoMethod>([
  "usdt_bep20",
  "binance_pay",
]);
/** Binance uygulamasında güvenle girilebilen 2 ondalık; zincirde 4. */
const AMOUNT_DECIMALS: Record<CryptoMethod, AmountDecimals> = { usdt_bep20: 4, binance_pay: 2 };

export async function walletBalance(conn: Conn, userId: string): Promise<number> {
  const row = await conn
    .select({ total: sum(walletEntries.amountCents) })
    .from(walletEntries)
    .where(eq(walletEntries.userId, userId))
    .get();
  return Number(row?.total ?? 0);
}

/** Süresi dolan bekleyen talepler "expired" olur (ödeme gelirse eşleşmez; destekle çözülür). */
async function expireIntents(conn: Conn, now: Date) {
  await conn
    .update(paymentIntents)
    .set({ status: "expired" })
    .where(
      and(eq(paymentIntents.status, "pending"), lte(paymentIntents.expiresAt, now.toISOString())),
    );
}

/**
 * Bakiye yükleme talebi. Kripto yöntemlerinde, aynı yöntemde ödemesi hâlâ
 * gelebilecek taleplerle çakışmayan benzersiz tutar atanır: bekleyenler, yeni
 * talep yüzünden geçersiz kalanlar ve süresi az önce dolanlar. Böylece eski
 * talebe yapılmış bir ödeme, aynı tutarı alan başka bir kullanıcıya yazılamaz.
 * Kullanıcının aynı yöntemde bekleyen eski talebi geçersiz olur (tek bekleyen tutar).
 */
export async function createTopUp(
  db: Db,
  userId: string,
  input: { method: TopUpMethod; amountCents: number; lang?: Lang | undefined },
  now: Date,
  rand: () => number = Math.random,
): Promise<Result<{ intent: TopUpIntent }, "invalidInput" | "busy"> | RateLimited> {
  const cents = input.amountCents;
  if (!Number.isInteger(cents) || cents < MIN_TOPUP_CENTS || cents > MAX_TOPUP_CENTS) {
    return { ok: false, error: "invalidInput" };
  }
  const key = `topup:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.topUpPerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);
  return db.transaction(async (tx) => {
    await expireIntents(tx, now);
    await tx
      .update(paymentIntents)
      .set({ status: "expired" })
      .where(
        and(
          eq(paymentIntents.userId, userId),
          eq(paymentIntents.method, input.method),
          eq(paymentIntents.status, "pending"),
        ),
      );

    let payAmount: string;
    let payCurrency: "USDT" | "USD";
    if (CRYPTO_METHODS.has(input.method)) {
      const recent = await tx
        .select({ amount: paymentIntents.payAmount })
        .from(paymentIntents)
        .where(
          and(
            eq(paymentIntents.method, input.method),
            ne(paymentIntents.status, "completed"),
            gt(
              paymentIntents.expiresAt,
              new Date(now.getTime() - CLAIM_CLOCK_SKEW_MS).toISOString(),
            ),
          ),
        );
      const unique = uniqueCryptoAmount(
        cents,
        new Set(recent.map((p) => p.amount)),
        rand,
        AMOUNT_DECIMALS[input.method as CryptoMethod],
      );
      if (!unique) return { ok: false, error: "busy" } as const;
      payAmount = unique;
      payCurrency = "USDT";
    } else {
      payAmount = formatCents(cents);
      payCurrency = "USD";
    }

    const row: IntentRow = {
      id: randomUUID(),
      userId,
      method: input.method,
      amountCents: cents,
      payAmount,
      payCurrency,
      status: "pending",
      providerRef: null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TOPUP_TTL_MS).toISOString(),
      completedAt: null,
      lang: input.lang ?? null,
      receiptSentAt: null,
    };
    await tx.insert(paymentIntents).values(row);
    return { ok: true, intent: toIntent(row) } as const;
  });
}

/**
 * Doğrulanmış ödemeyle talebi tamamlar ve bakiyeye yazar. Aynı talep aynı işlem
 * kimliğiyle tekrar gelirse sonuç değişmez (idempotent); işlem kimliği başka bir
 * talepte kullanılmışsa reddedilir.
 */
export async function completeTopUp(
  db: Db,
  intentId: string,
  providerRef: string,
  now: Date,
  /** Para tahsil edildiyse (PayPal) talep bu arada geçersiz kalmış olsa da bakiyeye yazılır. */
  opts: { allowExpired?: boolean } = {},
): Promise<
  Result<{ intent: TopUpIntent; userId: string }, "notFound" | "notPending" | "duplicateRef">
> {
  return db.transaction((tx) => completeTopUpIn(tx, intentId, providerRef, now, opts));
}

/** completeTopUp'ın gövdesi; başka bir kaydı aynı transaction'da yazmak için (yönetici işlemi). */
export async function completeTopUpIn(
  tx: Conn,
  intentId: string,
  providerRef: string,
  now: Date,
  opts: { allowExpired?: boolean } = {},
): Promise<
  Result<{ intent: TopUpIntent; userId: string }, "notFound" | "notPending" | "duplicateRef">
> {
  const intent = await tx
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, intentId))
    .get();
  if (!intent) return { ok: false, error: "notFound" } as const;
  if (intent.status === "completed") {
    return intent.providerRef === providerRef
      ? ({ ok: true, intent: toIntent(intent), userId: intent.userId } as const)
      : ({ ok: false, error: "notPending" } as const);
  }
  const open = intent.status === "pending" || (opts.allowExpired && intent.status === "expired");
  if (!open) return { ok: false, error: "notPending" } as const;
  const used = await tx
    .select({ id: paymentIntents.id })
    .from(paymentIntents)
    .where(
      and(eq(paymentIntents.method, intent.method), eq(paymentIntents.providerRef, providerRef)),
    )
    .get();
  if (used) return { ok: false, error: "duplicateRef" } as const;

  const done: IntentRow = {
    ...intent,
    status: "completed",
    providerRef,
    completedAt: now.toISOString(),
  };
  await tx
    .update(paymentIntents)
    .set({ status: "completed", providerRef, completedAt: done.completedAt })
    .where(and(eq(paymentIntents.id, intentId), ne(paymentIntents.status, "completed")));
  await tx.insert(walletEntries).values({
    id: randomUUID(),
    userId: intent.userId,
    kind: "topup",
    amountCents: creditCentsFor(intent),
    reference: intent.id,
    createdAt: now.toISOString(),
  });
  return { ok: true, intent: toIntent(done), userId: intent.userId } as const;
}

/** Geliştirme/demo: talep açılır ve hemen tamamlanır. Üretimde API katmanı kapatır. */
export async function demoTopUp(
  db: Db,
  userId: string,
  amountCents: number,
  now: Date,
): Promise<Result<{ intent: TopUpIntent }, "invalidInput" | "busy"> | RateLimited> {
  const created = await createTopUp(db, userId, { method: "demo", amountCents }, now);
  if (!created.ok) return created;
  const done = await completeTopUp(db, created.intent.id, `demo-${created.intent.id}`, now);
  if (!done.ok) return { ok: false, error: "invalidInput" };
  return { ok: true, intent: done.intent };
}

/** Paketi USD bakiyeden alır: düşüm, sipariş ve kredi tek transaction'dadır. */
export async function purchasePackage(
  db: Db,
  userId: string,
  input: { packageId: string },
  now: Date,
): Promise<Result<{ order: Order }, ActionErrorCode>> {
  const pkg = findPackage(input.packageId);
  if (!pkg) return { ok: false, error: "invalidInput" };
  const price = Math.round(pkg.priceUsd * 100);
  const grant = createGrant(
    { id: randomUUID(), kind: pkg.kind, packageId: pkg.id, credits: pkg.credits, days: pkg.days },
    now,
  );
  const row: OrderRow = {
    id: grant.id,
    userId,
    packageId: pkg.id,
    kind: pkg.kind,
    credits: pkg.credits,
    days: pkg.days,
    amountCents: price,
    method: "balance",
    status: "paid",
    createdAt: grant.grantedAt,
    expiresAt: grant.expiresAt,
  };
  const ok = await db.transaction(async (tx) => {
    if ((await walletBalance(tx, userId)) < price) return false;
    await tx.insert(walletEntries).values({
      id: randomUUID(),
      userId,
      kind: "purchase",
      amountCents: -price,
      reference: row.id,
      createdAt: now.toISOString(),
    });
    await tx.insert(orders).values(row);
    await tx.insert(creditGrants).values({ ...grant, userId });
    return true;
  });
  if (!ok) return { ok: false, error: "insufficientBalance" };
  return { ok: true, order: toOrder(row) };
}

/**
 * USDT (BEP20) ödemesini işlem kimliğiyle doğrular ve kullanıcının bekleyen
 * talebini tamamlar. Eşleşme benzersiz tutarla yapılır: zincir herkese açık
 * olduğundan yalnız işlem kimliğine güvenilseydi, alıcı adresi izleyen biri
 * başkasının ödemesini sahiplenebilirdi.
 */
export async function claimUsdtTopUp(
  db: Db,
  userId: string,
  txHash: string,
  check: (hash: string) => Promise<TransferCheck>,
  now: Date,
): Promise<Result<{ intent: TopUpIntent }, ClaimErrorCode> | RateLimited> {
  const hash = txHash.trim().toLowerCase();
  if (!TX_HASH_RE.test(hash)) return { ok: false, error: "invalidInput" };

  const key = `claim:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.claimPerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);

  const pending = await db
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.userId, userId),
        eq(paymentIntents.method, "usdt_bep20"),
        eq(paymentIntents.status, "pending"),
        gt(paymentIntents.expiresAt, now.toISOString()),
      ),
    );
  if (!pending.length) return { ok: false, error: "noPending" };

  let res: TransferCheck;
  try {
    res = await check(hash);
  } catch (err) {
    console.error("[ödeme] BSC sorgusu başarısız:", err instanceof Error ? err.message : err);
    return { ok: false, error: "providerFailed" };
  }
  if (!res.ok)
    return { ok: false, error: res.error === "oddAmount" ? "amountMismatch" : res.error };

  const intent = pending.find((p) => p.payAmount === res.amount);
  if (!intent) return { ok: false, error: "amountMismatch" };
  if (res.blockTime * 1000 < Date.parse(intent.createdAt) - CLAIM_CLOCK_SKEW_MS) {
    return { ok: false, error: "tooOld" };
  }

  const done = await completeTopUp(db, intent.id, hash, now);
  if (!done.ok)
    return { ok: false, error: done.error === "duplicateRef" ? "duplicateRef" : "noPending" };
  return { ok: true, intent: done.intent };
}

/**
 * Binance Pay ödemesini doğrular: hesabımıza gelen C2C USDT ödemeleri arasında
 * kullanıcının bekleyen 2 ondalıklı benzersiz tutarıyla eşleşen ve talepten
 * sonra yapılmış ilk kullanılmamış işlem talebi tamamlar. Binance geçmişi not
 * alanı döndürmediği için eşleşme tutar ve zamanla yapılır.
 */
export async function claimBinanceTopUp(
  db: Db,
  userId: string,
  incoming: IncomingFetcher,
  now: Date,
): Promise<Result<{ intent: TopUpIntent }, ClaimErrorCode> | RateLimited> {
  const key = `binance:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.binanceCheckPerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);

  const pending = await db
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.userId, userId),
        eq(paymentIntents.method, "binance_pay"),
        eq(paymentIntents.status, "pending"),
        gt(paymentIntents.expiresAt, now.toISOString()),
      ),
    );
  if (!pending.length) return { ok: false, error: "noPending" };

  let list: BinanceIncome[];
  try {
    // Sabit pencere: tüm kullanıcılar aynı önbelleği paylaşır.
    list = await incoming(new Date(now.getTime() - TOPUP_TTL_MS - CLAIM_CLOCK_SKEW_MS), now);
  } catch (err) {
    console.error(
      "[ödeme] Binance Pay sorgusu başarısız:",
      err instanceof Error ? err.message : err,
    );
    return { ok: false, error: "providerFailed" };
  }

  let duplicate = false;
  for (const intent of pending) {
    const since = Date.parse(intent.createdAt) - CLAIM_CLOCK_SKEW_MS;
    const matches = list
      .filter((i) => i.time >= since && normalizeAmount(i.amount, 2) === intent.payAmount)
      .sort((a, b) => a.time - b.time);
    for (const income of matches) {
      const done = await completeTopUp(db, intent.id, `binance:${income.transactionId}`, now);
      if (done.ok) return { ok: true, intent: done.intent };
      if (done.error !== "duplicateRef") return { ok: false, error: "noPending" };
      duplicate = true;
    }
  }
  return { ok: false, error: duplicate ? "duplicateRef" : "notFound" };
}

/** PayPal sipariş açıklaması (ödeme ekranında görünür). */
const PAYPAL_DESCRIPTION = "TrAi Pro bakiye yükleme";

/**
 * Kullanıcının bekleyen PayPal talebi için PayPal siparişi açar. Tutar ve
 * talep kimliği sunucudan gelir; sipariş talebe custom_id ile bağlanır.
 */
export async function startPaypalOrder(
  db: Db,
  userId: string,
  intentId: string,
  paypal: Pick<PaypalClient, "createOrder">,
  now: Date,
): Promise<Result<{ orderId: string }, "noPending" | "providerFailed"> | RateLimited> {
  const key = `paypal:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.paypalOrderPerUser]], now);
  if (stop) return stop;

  const intent = await db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.id, intentId), eq(paymentIntents.userId, userId)))
    .get();
  if (
    !intent ||
    intent.method !== "paypal" ||
    intent.status !== "pending" ||
    intent.expiresAt <= now.toISOString()
  ) {
    return { ok: false, error: "noPending" };
  }
  await recordAttempt(db, key, now);
  try {
    const orderId = await paypal.createOrder({
      reference: intent.id,
      value: intent.payAmount,
      description: PAYPAL_DESCRIPTION,
    });
    return { ok: true, orderId };
  } catch (err) {
    console.error("[ödeme] PayPal siparişi açılamadı:", err instanceof Error ? err.message : err);
    return { ok: false, error: "providerFailed" };
  }
}

const isUsd = (m: PaypalMoney | null, value: string) => m?.currency === "USD" && m.value === value;

/**
 * Tahsil edilmiş PayPal ödemesini talebe yazar. Para alındığı için talep bu
 * arada geçersiz kalmış olsa da yazılır; tutar tutmazsa yazılmaz ve loglanır.
 */
export async function creditPaypalCapture(
  db: Db,
  intentId: string,
  capture: PaypalCapture,
  now: Date,
): Promise<Result<{ intent: TopUpIntent; userId: string }, ClaimErrorCode>> {
  if (capture.status === "PENDING") return { ok: false, error: "unconfirmed" };
  if (capture.status !== "COMPLETED") return { ok: false, error: "failed" };
  const intent = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, intentId))
    .get();
  if (!intent || intent.method !== "paypal") return { ok: false, error: "notFound" };
  if (!isUsd(capture.amount, intent.payAmount)) {
    console.error(
      `[ödeme] PayPal tahsilat tutarı talep ${intent.id} ile eşleşmiyor; elle incelenmeli.`,
    );
    return { ok: false, error: "amountMismatch" };
  }
  const done = await completeTopUp(db, intent.id, `paypal:${capture.id}`, now, {
    allowExpired: true,
  });
  if (done.ok) return done;
  return { ok: false, error: done.error === "duplicateRef" ? "duplicateRef" : "noPending" };
}

/**
 * Kullanıcının onayladığı PayPal siparişini tahsil edip bakiyeye yazar.
 * Tahsilattan önce sipariş okunur: talep bu kullanıcının mı, tutar aynı mı,
 * talep hâlâ geçerli mi. Tutmazsa tahsil edilmez (kullanıcıdan para alınmaz).
 * Tekrar çağrılması zararsızdır (zaten tahsil edilmiş sipariş yeniden yazılmaz).
 */
export async function capturePaypalTopUp(
  db: Db,
  userId: string,
  orderId: string,
  paypal: Pick<PaypalClient, "getOrder" | "captureOrder">,
  now: Date,
): Promise<Result<{ intent: TopUpIntent }, ClaimErrorCode> | RateLimited> {
  if (!ORDER_ID_RE.test(orderId)) return { ok: false, error: "invalidInput" };
  const key = `claim:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.claimPerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);

  try {
    let order = await paypal.getOrder(orderId);
    if (!order?.customId) return { ok: false, error: "notFound" };
    const intent = await db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, order.customId))
      .get();
    if (!intent || intent.userId !== userId || intent.method !== "paypal") {
      return { ok: false, error: "notFound" };
    }
    if (!isUsd(order.amount, intent.payAmount)) return { ok: false, error: "amountMismatch" };

    if (order.status === "APPROVED") {
      if (intent.status !== "pending" || intent.expiresAt <= now.toISOString()) {
        return { ok: false, error: "noPending" };
      }
      const captured = await paypal.captureOrder(orderId);
      if (captured === "declined") return { ok: false, error: "declined" };
      order = captured;
    }
    if (order.status === "VOIDED") return { ok: false, error: "failed" };
    if (!order.capture) return { ok: false, error: "unconfirmed" };

    const res = await creditPaypalCapture(db, intent.id, order.capture, now);
    return res.ok ? { ok: true, intent: res.intent } : res;
  } catch (err) {
    console.error("[ödeme] PayPal tahsilatı başarısız:", err instanceof Error ? err.message : err);
    return { ok: false, error: "providerFailed" };
  }
}

async function loadWallet(db: Db, userId: string, now: Date): Promise<UserData["wallet"]> {
  const [entries, pending, balanceCents] = await Promise.all([
    db
      .select()
      .from(walletEntries)
      .where(eq(walletEntries.userId, userId))
      .orderBy(desc(walletEntries.createdAt))
      .limit(100),
    db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.userId, userId),
          eq(paymentIntents.status, "pending"),
          gt(paymentIntents.expiresAt, now.toISOString()),
        ),
      )
      .orderBy(desc(paymentIntents.createdAt)),
    walletBalance(db, userId),
  ]);
  return {
    balanceCents,
    entries: entries.map(({ userId: _u, ...e }) => e),
    pending: pending.map(toIntent),
  };
}

// ---------------------------------------------------------------- üretim

interface Plan {
  kind: CreditKind;
  cost: number;
  row: Omit<GenerationRow, "id" | "userId" | "cost" | "createdAt">;
}

async function planGeneration(db: Db, userId: string, input: GenerateInput): Promise<Plan | null> {
  const text = input.text.trim();
  if (!text) return null;
  const pick = (n: number) => {
    const start = randomInt(SAMPLE_IMAGE_COUNT);
    return Array.from({ length: n }, (_, i) => (start + i) % SAMPLE_IMAGE_COUNT);
  };

  switch (input.type) {
    case "tts": {
      if ([...text].length > MAX_TTS_CHARS) return null;
      const stock = stockVoices.some((v) => v.id === input.voiceId);
      const own =
        !stock &&
        (await db
          .select({ id: voiceClones.id })
          .from(voiceClones)
          .where(and(eq(voiceClones.id, input.voiceId), eq(voiceClones.userId, userId)))
          .get());
      if (!stock && !own) return null;
      return {
        kind: "voice",
        cost: ttsCost(text),
        row: {
          type: "tts",
          text,
          voiceId: input.voiceId,
          style: null,
          images: null,
          audioKey: null,
          files: null,
          status: null,
          job: null,
          charges: null,
          projectId: null,
          title: null,
          voiceSettings: storedSettings(input.settings),
          captionsKey: null,
          editKind: null,
          sourceId: null,
        },
      };
    }
    case "image": {
      if (!isImageCount(input.count) || text.length > 400) return null;
      return {
        kind: "media",
        cost: mediaCost("image", input.count),
        row: {
          type: "image",
          text,
          voiceId: null,
          style: null,
          images: pick(input.count),
          audioKey: null,
          files: null,
          status: null,
          job: null,
          charges: null,
          projectId: null,
          title: null,
          voiceSettings: null,
          captionsKey: null,
          editKind: null,
          sourceId: null,
        },
      };
    }
    case "video": {
      if (
        !Number.isInteger(input.styleIndex) ||
        input.styleIndex < 0 ||
        input.styleIndex >= VIDEO_STYLE_COUNT ||
        text.length > 400
      )
        return null;
      return {
        kind: "media",
        cost: mediaCost("video", 1),
        row: {
          type: "video",
          text,
          voiceId: null,
          style: String(input.styleIndex),
          images: pick(1),
          audioKey: null,
          files: null,
          status: null,
          job: null,
          charges: null,
          projectId: null,
          title: null,
          voiceSettings: null,
          captionsKey: null,
          editKind: null,
          sourceId: null,
        },
      };
    }
  }
}

/** Maliyeti sunucuda hesaplar; kredi düşümü ve kayıt tek transaction'dadır. */
export async function generateContent(
  db: Db,
  userId: string,
  input: GenerateInput,
  now: Date,
): Promise<Result<{ generation: Generation }, ActionErrorCode>> {
  const plan = await planGeneration(db, userId, input);
  if (!plan) return { ok: false, error: "invalidInput" };

  const row: GenerationRow = {
    ...plan.row,
    id: randomUUID(),
    userId,
    cost: plan.cost,
    createdAt: now.toISOString(),
  };
  if (!(await chargeAndRecord(db, userId, plan.kind, plan.cost, row, now, input))) {
    return { ok: false, error: "insufficient" };
  }
  return { ok: true, generation: toGeneration(row) };
}

/**
 * Krediyi düşer ve üretimi kaydeder; ikisi tek transaction'dadır. Hangi
 * paketten kaç kredi düşüldüğü kayda yazılır (başarısız işte iade için).
 * Bakiye yetmezse false; row.charges çağırana göre doldurulur.
 */
export async function chargeAndRecord(
  db: Db,
  userId: string,
  kind: CreditKind,
  cost: number,
  row: GenerationRow,
  now: Date,
  meta: GenerationMeta = {},
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Proje yalnız kullanıcının kendisininse bağlanır (silinmiş ya da başkasının
    // projesi yok sayılır, üretim projesiz kaydedilir). Projenin son etkinliği güncellenir.
    row.projectId = null;
    if (meta.projectId) {
      const touched = await tx
        .update(projects)
        .set({ updatedAt: now.toISOString() })
        .where(and(eq(projects.id, meta.projectId), eq(projects.userId, userId)));
      if (touched.rowsAffected === 1) row.projectId = meta.projectId;
    }
    row.title = cleanTitle(meta.title) ?? null;
    const current = (
      await tx.select().from(creditGrants).where(eq(creditGrants.userId, userId))
    ).map(toGrant);
    const next = spend(current, kind, cost, now);
    if (!next) return false;
    const charges: { grantId: string; amount: number }[] = [];
    for (const g of next) {
      const before = current.find((c) => c.id === g.id);
      if (before && before.remaining !== g.remaining) {
        charges.push({ grantId: g.id, amount: before.remaining - g.remaining });
        await tx
          .update(creditGrants)
          .set({ remaining: g.remaining })
          .where(eq(creditGrants.id, g.id));
      }
    }
    row.charges = charges;
    await tx.insert(generations).values(row);
    return true;
  });
}

/** Kullanıcının tek bir üretimi; başkasınınki ya da yoksa null. */
export async function getGeneration(
  db: Db,
  userId: string,
  id: string,
): Promise<Generation | null> {
  const row = await db
    .select()
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.userId, userId)))
    .get();
  return row ? toGeneration(row) : null;
}

/** Stüdyo geçmişinin sayfa boyutu. */
export const HISTORY_PAGE_SIZE = 20;
/** Geçmiş imleci: sayfanın son üretiminin zamanı ve kimliği ("<ISO zaman>|<kimlik>"). */
export const HISTORY_CURSOR_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[\w-]{1,80}$/;

/**
 * Kullanıcının üretimleri, yeniden eskiye sayfa sayfa; türe ve projeye göre
 * süzülebilir. Oturum yanıtı geçmişi taşımaz; stüdyo bu sayfaları ayrıca ister.
 * Aynı anda oluşan üretimler kimliğe göre sıralanır, sayfa sınırında kayıt atlanmaz.
 */
export async function listGenerations(
  db: Db,
  userId: string,
  input: {
    type?: GenerationType | undefined;
    projectId?: string | undefined;
    cursor?: string | undefined;
  },
  limit = HISTORY_PAGE_SIZE,
): Promise<GenerationPage> {
  const where = [eq(generations.userId, userId)];
  if (input.type) where.push(eq(generations.type, input.type));
  if (input.projectId) where.push(eq(generations.projectId, input.projectId));
  if (input.cursor !== undefined) {
    if (!HISTORY_CURSOR_RE.test(input.cursor)) return { items: [], next: null };
    const [at, id] = input.cursor.split("|") as [string, string];
    where.push(
      or(
        lt(generations.createdAt, at),
        and(eq(generations.createdAt, at), lt(generations.id, id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(generations)
    .where(and(...where))
    .orderBy(desc(generations.createdAt), desc(generations.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toGeneration),
    next: rows.length > limit && last ? `${last.createdAt}|${last.id}` : null,
  };
}

/**
 * Üretimi bir projeye taşır ya da projeden çıkarır (`projectId` null). Üretim
 * ve hedef proje kullanıcının değilse "bulunamadı"; hedef projenin son
 * etkinliği güncellenir.
 */
export async function moveGeneration(
  db: Db,
  userId: string,
  id: string,
  projectId: string | null,
  now: Date,
): Promise<Result<{ generation: Generation }, "notFound">> {
  return db.transaction(async (tx) => {
    if (projectId) {
      const touched = await tx
        .update(projects)
        .set({ updatedAt: now.toISOString() })
        .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
      if (touched.rowsAffected !== 1) return { ok: false, error: "notFound" };
    }
    const row = await tx
      .update(generations)
      .set({ projectId })
      .where(and(eq(generations.id, id), eq(generations.userId, userId)))
      .returning()
      .get();
    return row ? { ok: true, generation: toGeneration(row) } : { ok: false, error: "notFound" };
  });
}

/** Üretime ad verir; boş ad adı kaldırır (metin/istem gösterilir). */
export async function renameGeneration(
  db: Db,
  userId: string,
  id: string,
  title: string,
): Promise<Result<{ generation: Generation }, "notFound" | "invalidInput">> {
  const clean = cleanTitle(title);
  if (clean === undefined) return { ok: false, error: "invalidInput" };
  const row = await db
    .update(generations)
    .set({ title: clean })
    .where(and(eq(generations.id, id), eq(generations.userId, userId)))
    .returning()
    .get();
  return row ? { ok: true, generation: toGeneration(row) } : { ok: false, error: "notFound" };
}

/** Üretimi siler; ses, görsel ya da video dosyası varsa depodan da kaldırılır. */
export async function removeGeneration(
  db: Db,
  userId: string,
  id: string,
  storage?: FileStorage,
): Promise<void> {
  const row = await db
    .select({
      audioKey: generations.audioKey,
      captionsKey: generations.captionsKey,
      files: generations.files,
    })
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.userId, userId)))
    .get();
  if (!row) return;
  await db.delete(generations).where(and(eq(generations.id, id), eq(generations.userId, userId)));
  // Arka planda süren uzun seslendirme kalan parçaları göndermez.
  const job = speechJobs.get(id);
  if (job) job.cancelled = true;
  if (!storage) return;
  const keys = [
    ...(row.audioKey ? [row.audioKey] : []),
    ...(row.captionsKey ? [row.captionsKey] : []),
    ...(row.files ?? []),
  ];
  await Promise.all(keys.map((k) => storage.remove(k)));
}

const isImageCount = (n: number) => (IMAGE_COUNTS as readonly number[]).includes(n);

// ---------------------------------------------------------------- gerçek görsel üretimi (fal.ai)

export interface ImageDeps {
  images: ImageProvider;
  storage: FileStorage;
}

/**
 * Görsel üretir, dosyaları depoya yazar ve krediyi teslim edilen görsel sayısı
 * kadar düşer. Sağlayıcı hata verir ya da içeriği reddederse kredi düşülmez.
 */
export async function generateImages(
  db: Db,
  deps: ImageDeps,
  userId: string,
  input: { text: string; count: number } & GenerationMeta,
  now: Date,
): Promise<Result<{ generation: Generation }, ActionErrorCode> | RateLimited> {
  const text = input.text.trim();
  if (!text || text.length > 400 || !isImageCount(input.count)) {
    return { ok: false, error: "invalidInput" };
  }
  const grants = (await db.select().from(creditGrants).where(eq(creditGrants.userId, userId))).map(
    toGrant,
  );
  if (balance(grants, "media", now) < mediaCost("image", input.count)) {
    return { ok: false, error: "insufficient" };
  }

  const key = `image:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.imagePerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);

  let images: GeneratedImage[];
  try {
    images = await deps.images.generate({ prompt: text, count: input.count });
  } catch (err) {
    if (err instanceof ContentRejected) return { ok: false, error: "contentRejected" };
    console.error("[görsel] üretim başarısız:", err instanceof Error ? err.message : err);
    return { ok: false, error: "providerFailed" };
  }

  const id = randomUUID();
  const files = images.map((img, i) => `${userId}/${id}-${i}.${extensionOf(img.contentType)}`);
  await Promise.all(files.map((k, i) => deps.storage.put(k, images[i]!.data)));
  const cost = mediaCost("image", files.length);
  const row: GenerationRow = {
    id,
    userId,
    type: "image",
    text,
    voiceId: null,
    style: null,
    images: null,
    audioKey: null,
    files,
    status: null,
    job: null,
    charges: null,
    projectId: null,
    title: null,
    voiceSettings: null,
    captionsKey: null,
    editKind: null,
    sourceId: null,
    cost,
    createdAt: now.toISOString(),
  };
  if (!(await chargeAndRecord(db, userId, "media", cost, row, now, input))) {
    await Promise.all(files.map((k) => deps.storage.remove(k)));
    return { ok: false, error: "insufficient" };
  }
  return { ok: true, generation: toGeneration(row) };
}

// ---------------------------------------------------------------- gerçek video üretimi (fal.ai kuyruğu)

export interface VideoDeps {
  video: VideoProvider;
  storage: FileStorage;
  /** Yayında fal.ai'nin iş bitince haber vereceği adres; yoksa yalnız sorgulama. */
  webhookUrl: string | null;
}

/** Aynı anda hazırlanabilecek video sayısı. */
export const VIDEO_MAX_PENDING = 3;
/** Bu süreyi aşan iş iptal edilir, kredi iade edilir. */
export const VIDEO_MAX_AGE_MS = 60 * 60_000;

/**
 * Video işini sağlayıcıya gönderir ve krediyi hemen düşer (beklerken başka
 * harcamada kullanılmasın). Gönderim başarısızsa kredi düşülmez; iş sonradan
 * başarısız olursa refreshVideo krediyi aynı paketlere iade eder.
 */
export async function startVideo(
  db: Db,
  deps: VideoDeps,
  userId: string,
  input: { text: string; styleIndex: number } & GenerationMeta,
  now: Date,
): Promise<Result<{ generation: Generation }, ActionErrorCode> | RateLimited> {
  const text = input.text.trim();
  if (
    !text ||
    text.length > 400 ||
    !Number.isInteger(input.styleIndex) ||
    input.styleIndex < 0 ||
    input.styleIndex >= VIDEO_STYLE_COUNT
  ) {
    return { ok: false, error: "invalidInput" };
  }
  const cost = mediaCost("video", 1);
  const grants = (await db.select().from(creditGrants).where(eq(creditGrants.userId, userId))).map(
    toGrant,
  );
  if (balance(grants, "media", now) < cost) return { ok: false, error: "insufficient" };

  const pending = await db
    .select({ n: count() })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        eq(generations.type, "video"),
        eq(generations.status, "pending"),
      ),
    )
    .get();
  if ((pending?.n ?? 0) >= VIDEO_MAX_PENDING) return { ok: false, error: "limit" };

  const key = `video:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.videoPerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);

  let job: VideoJob;
  try {
    job = await deps.video.submit({
      prompt: stylePrompt(text, input.styleIndex),
      webhookUrl: deps.webhookUrl,
    });
  } catch (err) {
    console.error("[video] iş gönderilemedi:", err instanceof Error ? err.message : err);
    return { ok: false, error: "providerFailed" };
  }

  const row: GenerationRow = {
    id: randomUUID(),
    userId,
    type: "video",
    text,
    voiceId: null,
    style: String(input.styleIndex),
    images: null,
    audioKey: null,
    files: null,
    status: "pending",
    job,
    charges: null,
    projectId: null,
    title: null,
    voiceSettings: null,
    captionsKey: null,
    editKind: null,
    sourceId: null,
    cost,
    createdAt: now.toISOString(),
  };
  if (!(await chargeAndRecord(db, userId, "media", cost, row, now, input))) {
    await deps.video.cancel(job).catch(() => {});
    return { ok: false, error: "insufficient" };
  }
  return { ok: true, generation: toGeneration(row) };
}

/** Başarısız işi (video, uzun seslendirme) işaretler ve krediyi düşüldüğü paketlere iade eder (bir kez). */
async function failGeneration(db: Db, row: GenerationRow): Promise<GenerationRow> {
  return db.transaction(async (tx) => {
    const res = await tx
      .update(generations)
      .set({ status: "failed" })
      .where(and(eq(generations.id, row.id), eq(generations.status, "pending")));
    if (res.rowsAffected === 0) {
      return (await tx.select().from(generations).where(eq(generations.id, row.id)).get()) ?? row;
    }
    for (const c of row.charges ?? []) {
      await tx
        .update(creditGrants)
        .set({ remaining: sql`${creditGrants.remaining} + ${c.amount}` })
        .where(eq(creditGrants.id, c.grantId));
    }
    return { ...row, status: "failed" as const };
  });
}

/**
 * Bekleyen video işinin durumunu sağlayıcıdan sorar. Bittiyse video depoya
 * yazılır; başarısızsa ya da çok uzun sürdüyse kredi iade edilir. Aynı anda
 * gelen iki kontrol (sayfa ve webhook) işi bir kez sonuçlandırır.
 */
async function settleVideo(db: Db, deps: VideoDeps, row: GenerationRow, now: Date) {
  if (row.status !== "pending" || !row.job) return row;
  let check: VideoCheck;
  try {
    check = await deps.video.check(row.job);
  } catch (err) {
    console.error("[video] iş durumu alınamadı:", err instanceof Error ? err.message : err);
    check = { state: "pending" };
  }
  if (check.state === "pending") {
    if (now.getTime() - Date.parse(row.createdAt) < VIDEO_MAX_AGE_MS) return row;
    await deps.video.cancel(row.job).catch(() => {});
    return failGeneration(db, row);
  }
  if (check.state === "failed") return failGeneration(db, row);

  const key = `${row.userId}/${row.id}-0.mp4`;
  await deps.storage.put(key, check.video);
  const files = [key];
  await db
    .update(generations)
    .set({ status: null, files })
    .where(and(eq(generations.id, row.id), eq(generations.status, "pending")));
  return { ...row, status: null, files };
}

/** Kullanıcının kendi video işini kontrol eder (stüdyo sayfası düzenli çağırır). */
export async function refreshVideo(
  db: Db,
  deps: VideoDeps,
  userId: string,
  id: string,
  now: Date,
): Promise<Result<{ generation: Generation }, "notFound">> {
  const row = await db
    .select()
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.userId, userId)))
    .get();
  if (!row || row.type !== "video") return { ok: false, error: "notFound" };
  return { ok: true, generation: toGeneration(await settleVideo(db, deps, row, now)) };
}

/**
 * Webhook'tan gelen iş kimliğiyle kontrol. Webhook gövdesine güvenilmez:
 * yalnız hangi işin kontrol edileceğini söyler, sonuç sağlayıcıdan okunur.
 */
export async function refreshVideoByRequest(
  db: Db,
  deps: VideoDeps,
  requestId: string,
  now: Date,
): Promise<boolean> {
  const row = await db
    .select()
    .from(generations)
    .where(
      and(
        eq(generations.status, "pending"),
        sql`json_extract(${generations.job}, '$.requestId') = ${requestId}`,
      ),
    )
    .get();
  if (!row) return false;
  await settleVideo(db, deps, row, now);
  return true;
}

// ---------------------------------------------------------------- gerçek seslendirme (ElevenLabs)

export interface SpeechDeps {
  tts: TtsProvider;
  storage: FileStorage;
  /** Herkese açık hazır sesler (kullanıcı klonları ayıklanmış). */
  catalog: () => Promise<ProviderVoice[]>;
  /** Uzun metinde geçici hata alan parça bu kadar bekleyip bir kez yeniden denenir. */
  retryDelayMs?: number;
}

/** Kullanıcı başına aynı anda arka planda seslendirilebilecek uzun metin sayısı. */
export const SPEECH_MAX_PENDING = 2;
/** Uzun metinde aynı anda sağlayıcıya gönderilen parça sayısı. */
const SPEECH_CONCURRENCY = 2;
/** Komşu parçadan bağlam olarak verilen karakter sayısı. */
const SPEECH_CONTEXT_CHARS = 300;

interface SpeechJob {
  total: number;
  done: number;
  /** Üretim silindi: kalan parçalar gönderilmez. */
  cancelled: boolean;
}

/**
 * Bu süreçte arka planda çalışan uzun seslendirmeler. Listede olmayan bekleyen
 * kayıt yarım kalmıştır (sunucu yeniden başladı) ve iade edilir. Geliştirmede
 * modül yeniden yüklense de kaybolmasın diye global nesnede durur.
 */
const speechJobs: Map<string, SpeechJob> = ((
  globalThis as { __traiSpeechJobs?: Map<string, SpeechJob> }
).__traiSpeechJobs ??= new Map());

function speechProgress(id: string): { done: number; total: number } | undefined {
  const job = speechJobs.get(id);
  return job ? { done: job.done, total: job.total } : undefined;
}

/** Veritabanındaki klonların sağlayıcı kimlikleri; hazır ses listesinden ayıklanır. */
export async function clonedProviderIds(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ id: voiceClones.providerVoiceId })
    .from(voiceClones)
    .where(isNotNull(voiceClones.providerVoiceId));
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

/** Seçilen sesi sağlayıcı kimliğine çevirir: kullanıcının kendi klonu ya da katalogdaki hazır ses. */
async function resolveVoice(
  db: Db,
  deps: SpeechDeps,
  userId: string,
  voiceId: string,
): Promise<string | null> {
  if (voiceId.startsWith("clone-")) {
    const row = await db
      .select({ pid: voiceClones.providerVoiceId })
      .from(voiceClones)
      .where(and(eq(voiceClones.id, voiceId), eq(voiceClones.userId, userId)))
      .get();
    return row?.pid ?? null;
  }
  const voices = await deps.catalog();
  return voices.some((v) => v.id === voiceId) ? voiceId : null;
}

/**
 * Parçaların sesi tek MP3'te birleşir; altyazı zamanları her parçanın birleşik
 * dosyadaki başlangıcına kaydırılır. Zamanlaması eksik parça varsa altyazı
 * üretilmez. MP3 okunamazsa null.
 */
function assembleSpeech(results: SpeechResult[]): { audio: Uint8Array; cues: Cue[] } | null {
  const cuesOf = (timed: { alignment: SpeechAlignment | null; offset: number }[]) =>
    timed.every((t) => t.alignment)
      ? buildCues(timed as { alignment: SpeechAlignment; offset: number }[])
      : [];
  if (results.length === 1) {
    const only = results[0]!;
    return { audio: only.audio, cues: cuesOf([{ alignment: only.alignment, offset: 0 }]) };
  }
  const parts = results.map((r) => readMp3(r.audio));
  if (parts.some((p) => !p)) return null;
  let offset = 0;
  const timed = parts.map((p, i) => {
    const at = { alignment: results[i]!.alignment, offset };
    offset += p!.seconds;
    return at;
  });
  return { audio: concatBytes(parts.map((p) => p!.data)), cues: cuesOf(timed) };
}

/** Ses ve (varsa) altyazı depoya yazılır. */
async function storeSpeech(
  storage: FileStorage,
  userId: string,
  id: string,
  speech: { audio: Uint8Array; cues: Cue[] },
): Promise<{ audioKey: string; captionsKey: string | null }> {
  const audioKey = `${userId}/${id}.mp3`;
  await storage.put(audioKey, speech.audio);
  if (!speech.cues.length) return { audioKey, captionsKey: null };
  const captionsKey = `${userId}/${id}-captions.json`;
  await storage.put(captionsKey, encodeCues(speech.cues));
  return { audioKey, captionsKey };
}

const removeSpeech = (
  storage: FileStorage,
  keys: { audioKey: string; captionsKey: string | null },
) => Promise.all([keys.audioKey, keys.captionsKey].flatMap((k) => (k ? [storage.remove(k)] : [])));

/** Geçici hata (ağ, zaman aşımı, 429, 5xx) bir kez yeniden denenir. */
async function synthesizeWithRetry(
  deps: SpeechDeps,
  ...args: Parameters<TtsProvider["synthesize"]>
): Promise<SpeechResult> {
  try {
    return await deps.tts.synthesize(...args);
  } catch (err) {
    if (err instanceof TtsError && err.status !== 429 && err.status < 500) throw err;
    await new Promise((r) => setTimeout(r, deps.retryDelayMs ?? 2_000));
    return deps.tts.synthesize(...args);
  }
}

/** En çok `limit` iş aynı anda; biri başarısız olursa yenisi başlamaz. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (next < items.length && !failed) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const head = (s: string | undefined) =>
  s === undefined ? undefined : [...s].slice(0, SPEECH_CONTEXT_CHARS).join("");
const tail = (s: string | undefined) =>
  s === undefined ? undefined : [...s].slice(-SPEECH_CONTEXT_CHARS).join("");

/**
 * Uzun metnin arka plan işi: parçalar (en çok ikisi aynı anda) seslendirilir,
 * birleştirilir ve kayıt tamamlanır. Herhangi bir parça başarısız olursa kredi
 * aynı paketlere iade edilir. Bu arada kayıt silinmiş ya da iade edilmişse
 * yazılan dosyalar kaldırılır.
 */
async function runLongSpeech(
  db: Db,
  deps: SpeechDeps,
  row: GenerationRow,
  job: SpeechJob,
  input: { providerVoiceId: string; chunks: string[]; settings: VoiceSettings | null },
): Promise<void> {
  const { chunks } = input;
  try {
    const results = await mapLimit(chunks, SPEECH_CONCURRENCY, async (chunk, i) => {
      if (job.cancelled) throw new Error("üretim silindi");
      const result = await synthesizeWithRetry(
        deps,
        input.providerVoiceId,
        chunk,
        input.settings ?? undefined,
        { previousText: tail(chunks[i - 1]), nextText: head(chunks[i + 1]) },
      );
      job.done += 1;
      return result;
    });
    const speech = assembleSpeech(results);
    if (!speech) throw new Error("ses parçaları birleştirilemedi");
    const keys = await storeSpeech(deps.storage, row.userId, row.id, speech);
    const res = await db
      .update(generations)
      .set({ status: null, ...keys })
      .where(and(eq(generations.id, row.id), eq(generations.status, "pending")));
    if (res.rowsAffected === 0) await removeSpeech(deps.storage, keys);
  } catch (err) {
    if (!job.cancelled) {
      console.error("[ses] uzun seslendirme başarısız:", err instanceof Error ? err.message : err);
    }
    await failGeneration(db, row);
  } finally {
    speechJobs.delete(row.id);
  }
}

/**
 * Gerçek seslendirme. Kısa metin (tek parça) hemen seslendirilir; kredi yalnız
 * başarıda düşer: bakiye ön kontrolü, sağlayıcı çağrısı, ardından tek
 * transaction'da düşüm ve kayıt. Düşüm eşzamanlı başka bir istek yüzünden
 * başarısız olursa üretilen dosya silinir.
 *
 * 5.000 karakteri aşan metin parçalara bölünür ve arka planda seslendirilir:
 * kredi hemen düşer (beklerken başka harcamada kullanılmasın), kayıt "pending"
 * döner, iş başarısız olursa kredi iade edilir. Altyazı, sağlayıcı zamanlama
 * verdiyse sesle birlikte kaydedilir.
 */
export async function generateSpeech(
  db: Db,
  deps: SpeechDeps,
  userId: string,
  input: {
    text: string;
    voiceId: string;
    settings?: Partial<VoiceSettings> | undefined;
  } & GenerationMeta,
  now: Date,
): Promise<Result<{ generation: Generation }, ActionErrorCode> | RateLimited> {
  const text = input.text.trim();
  if (!text || [...text].length > MAX_TTS_CHARS) return { ok: false, error: "invalidInput" };
  const settings = storedSettings(input.settings);
  let providerVoiceId: string | null;
  try {
    providerVoiceId = await resolveVoice(db, deps, userId, input.voiceId);
  } catch (err) {
    // Sağlayıcının ses listesi alınamadı.
    console.error("[ses] ses listesi alınamadı:", err instanceof Error ? err.message : err);
    return { ok: false, error: "providerFailed" };
  }
  if (!providerVoiceId) return { ok: false, error: "invalidInput" };

  const cost = ttsCost(text);
  const grants = (await db.select().from(creditGrants).where(eq(creditGrants.userId, userId))).map(
    toGrant,
  );
  if (balance(grants, "voice", now) < cost) return { ok: false, error: "insufficient" };

  const chunks = splitForSpeech(text);
  const long = chunks.length > 1;
  if (long) {
    const pending = await db
      .select({ n: count() })
      .from(generations)
      .where(
        and(
          eq(generations.userId, userId),
          eq(generations.type, "tts"),
          eq(generations.status, "pending"),
        ),
      )
      .get();
    if ((pending?.n ?? 0) >= SPEECH_MAX_PENDING) return { ok: false, error: "limit" };
  }

  const key = `tts:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.ttsPerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);

  const id = randomUUID();
  const row: GenerationRow = {
    id,
    userId,
    type: "tts",
    text,
    voiceId: input.voiceId,
    style: null,
    images: null,
    audioKey: null,
    files: null,
    status: long ? "pending" : null,
    job: null,
    charges: null,
    projectId: null,
    title: null,
    voiceSettings: settings,
    captionsKey: null,
    editKind: null,
    sourceId: null,
    cost,
    createdAt: now.toISOString(),
  };

  if (long) {
    // İş, kayıt görünür olmadan önce listeye girer: aradaki kontrol onu yarım sanmasın.
    const job: SpeechJob = { total: chunks.length, done: 0, cancelled: false };
    speechJobs.set(id, job);
    let charged = false;
    try {
      charged = await chargeAndRecord(db, userId, "voice", cost, row, now, input);
    } finally {
      if (!charged) speechJobs.delete(id);
    }
    if (!charged) return { ok: false, error: "insufficient" };
    void runLongSpeech(db, deps, row, job, { providerVoiceId, chunks, settings }).catch(
      (err: unknown) =>
        console.error("[ses] uzun seslendirme işi:", err instanceof Error ? err.message : err),
    );
    return { ok: true, generation: toGeneration(row) };
  }

  let speech: { audio: Uint8Array; cues: Cue[] } | null;
  try {
    speech = assembleSpeech([
      await deps.tts.synthesize(providerVoiceId, text, settings ?? undefined),
    ]);
  } catch (err) {
    console.error("[ses] seslendirme başarısız:", err instanceof Error ? err.message : err);
    return { ok: false, error: "providerFailed" };
  }
  if (!speech) return { ok: false, error: "providerFailed" };

  const keys = await storeSpeech(deps.storage, userId, id, speech);
  Object.assign(row, keys);
  if (!(await chargeAndRecord(db, userId, "voice", cost, row, now, input))) {
    await removeSpeech(deps.storage, keys);
    return { ok: false, error: "insufficient" };
  }
  return { ok: true, generation: toGeneration(row) };
}

/** Bekleyen uzun seslendirme bu süreçte çalışmıyorsa yarım kalmıştır: kredi iade edilir. */
async function settleSpeech(db: Db, row: GenerationRow): Promise<GenerationRow> {
  if (row.status !== "pending" || speechJobs.has(row.id)) return row;
  return failGeneration(db, row);
}

/**
 * Bekleyen üretimin durumu (stüdyo sayfası düzenli çağırır): video sağlayıcıdan
 * sorulur, uzun seslendirme yarım kaldıysa iade edilir.
 */
export async function refreshPending(
  db: Db,
  video: VideoDeps | null,
  userId: string,
  id: string,
  now: Date,
): Promise<Result<{ generation: Generation }, "notFound">> {
  const row = await db
    .select()
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.userId, userId)))
    .get();
  if (!row) return { ok: false, error: "notFound" };
  const fresh =
    row.type === "tts"
      ? await settleSpeech(db, row)
      : row.type === "video" && video
        ? await settleVideo(db, video, row, now)
        : row;
  return { ok: true, generation: toGeneration(fresh) };
}

/**
 * Sunucu yeniden başlayınca yarım kalan uzun seslendirmeler: kredi iade edilir
 * (günlük bakım çağırır). İade edilen kayıt sayısını döner.
 */
export async function failOrphanSpeech(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(generations)
    .where(and(eq(generations.type, "tts"), eq(generations.status, "pending")));
  let n = 0;
  for (const row of rows) {
    if (speechJobs.has(row.id)) continue;
    await failGeneration(db, row);
    n += 1;
  }
  return n;
}

// ---------------------------------------------------------------- ses klonu

export async function addVoiceClone(
  db: Db,
  userId: string,
  name: string,
  now: Date,
): Promise<Result<{ id: string }, ActionErrorCode>> {
  const clean = name.trim();
  if (!clean || clean.length > 40) return { ok: false, error: "invalidInput" };
  return db.transaction(async (tx) => {
    const row = await tx
      .select({ n: count() })
      .from(voiceClones)
      .where(eq(voiceClones.userId, userId))
      .get();
    if ((row?.n ?? 0) >= MAX_CLONES) return { ok: false, error: "limit" } as const;
    const id = `clone-${randomUUID()}`;
    await tx.insert(voiceClones).values({ id, userId, name: clean, createdAt: now.toISOString() });
    return { ok: true, id } as const;
  });
}

/** Klon için yüklenebilecek en büyük ses dosyası. */
export const MAX_CLONE_BYTES = 10 * 1024 * 1024;

async function cloneCount(conn: Conn, userId: string): Promise<number> {
  const row = await conn
    .select({ n: count() })
    .from(voiceClones)
    .where(eq(voiceClones.userId, userId))
    .get();
  return row?.n ?? 0;
}

/**
 * Gerçek ses klonu (ElevenLabs Instant Voice Clone). Kullanıcının "bu ses bana ait
 * ya da izinliyim" onayı zorunludur ve zamanıyla kaydedilir.
 */
export async function createVoiceClone(
  db: Db,
  deps: { tts: TtsProvider },
  userId: string,
  input: { name: string; consent: boolean; file: CloneFile },
  now: Date,
): Promise<Result<{ id: string }, ActionErrorCode> | RateLimited> {
  const clean = input.name.trim();
  const { file } = input;
  if (!clean || clean.length > 40 || !input.consent) return { ok: false, error: "invalidInput" };
  if (!file.type.startsWith("audio/") || file.data.byteLength === 0) {
    return { ok: false, error: "invalidInput" };
  }
  if (file.data.byteLength > MAX_CLONE_BYTES) return { ok: false, error: "invalidInput" };
  if ((await cloneCount(db, userId)) >= MAX_CLONES) return { ok: false, error: "limit" };

  const key = `clone:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.clonePerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);

  let providerVoiceId: string;
  try {
    providerVoiceId = await deps.tts.cloneVoice({
      name: `TrAi ${clean}`,
      description: `TrAi Pro kullanıcı klonu (${userId})`,
      file,
    });
  } catch (err) {
    console.error("[ses] klonlama başarısız:", err instanceof Error ? err.message : err);
    return { ok: false, error: "providerFailed" };
  }

  const id = `clone-${randomUUID()}`;
  const added = await db.transaction(async (tx) => {
    // Eşzamanlı yüklemelerde sınır ikinci kez kontrol edilir.
    if ((await cloneCount(tx, userId)) >= MAX_CLONES) return false;
    await tx.insert(voiceClones).values({
      id,
      userId,
      name: clean,
      providerVoiceId,
      consentAt: now.toISOString(),
      createdAt: now.toISOString(),
    });
    return true;
  });
  if (!added) {
    await deps.tts.deleteVoice(providerVoiceId).catch(() => undefined);
    return { ok: false, error: "limit" };
  }
  return { ok: true, id };
}

/** Klonu siler; sağlayıcıdaki ses de (varsa) kaldırılır. */
export async function deleteVoiceClone(
  db: Db,
  deps: { tts: TtsProvider | null },
  userId: string,
  cloneId: string,
): Promise<Result<object, "invalidInput">> {
  const row = await db
    .select({ pid: voiceClones.providerVoiceId })
    .from(voiceClones)
    .where(and(eq(voiceClones.id, cloneId), eq(voiceClones.userId, userId)))
    .get();
  if (!row) return { ok: false, error: "invalidInput" };
  if (row.pid && deps.tts) {
    try {
      await deps.tts.deleteVoice(row.pid);
    } catch (err) {
      console.error(
        "[ses] sağlayıcıdaki klon silinemedi:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  await db
    .delete(voiceClones)
    .where(and(eq(voiceClones.id, cloneId), eq(voiceClones.userId, userId)));
  return { ok: true };
}

// ---------------------------------------------------------------- hesap yönetimi

async function authRow(db: Db, userId: string) {
  return db
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

/**
 * Şifre gerektiren hesap işlemlerinde mevcut şifreyi doğrular. Yanlış denemeler
 * giriş sınırına sayılır; çalınmış bir oturumla şifre tahmini de yavaşlar.
 */
async function confirmPassword(
  db: Db,
  row: { email: string; passwordHash: string },
  password: string | undefined,
  ip: string | null,
  now: Date,
): Promise<Result<object, "invalidCredentials"> | RateLimited> {
  const keys = signInKeys(row.email, ip);
  const checks: [string, Limit][] = [[keys.email, LIMITS.signInPerEmail]];
  if (keys.ip) checks.push([keys.ip, LIMITS.signInPerIp]);
  const stop = await blocked(db, checks, now);
  if (stop) return stop;
  if (password && (await verifyPassword(password, row.passwordHash))) return { ok: true };
  for (const [key] of checks) await recordAttempt(db, key, now);
  return { ok: false, error: "invalidCredentials" };
}

export async function updateName(
  db: Db,
  userId: string,
  name: string,
): Promise<Result<object, "invalidInput">> {
  const clean = name.trim();
  if (!clean || clean.length > 80) return { ok: false, error: "invalidInput" };
  await db.update(users).set({ name: clean }).where(eq(users.id, userId));
  return { ok: true };
}

/** Bu oturum dışındaki tüm oturumları kapatır. */
export async function revokeOtherSessions(db: Db, userId: string, keepToken: string) {
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, hashToken(keepToken))));
}

/**
 * Şifreyi değiştirir. Google ile açılmış (şifresiz) hesapta mevcut şifre istenmez,
 * ilk şifre belirlenir. Başarıda bu oturum dışındaki oturumlar kapanır.
 */
export async function changePassword(
  db: Db,
  userId: string,
  input: { current?: string | undefined; next: string },
  keepToken: string,
  ip: string | null,
  now: Date,
): Promise<Result<object, "invalidCredentials" | "invalidInput"> | RateLimited> {
  if (input.next.length < 8 || input.next.length > 200) return { ok: false, error: "invalidInput" };
  const row = await authRow(db, userId);
  if (!row) return { ok: false, error: "invalidCredentials" };
  if (row.passwordHash) {
    const check = await confirmPassword(
      db,
      { email: row.email, passwordHash: row.passwordHash },
      input.current,
      ip,
      now,
    );
    if (!check.ok) return check;
  }
  const passwordHash = await hashPassword(input.next);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, hashToken(keepToken))));
  });
  return { ok: true };
}

/** Oturumu açık kullanıcının isteğiyle Google hesabını bağlar; e-postaların aynı olması gerekmez. */
export async function linkGoogle(
  db: Db,
  userId: string,
  profile: GoogleProfile,
  now: Date,
): Promise<Result<object, "googleAlreadyLinked">> {
  const bySub = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.providerUserId, profile.sub)))
    .get();
  if (bySub)
    return bySub.userId === userId ? { ok: true } : { ok: false, error: "googleAlreadyLinked" };

  const mine = await db
    .select({ sub: oauthAccounts.providerUserId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.userId, userId)))
    .get();
  if (mine) return { ok: false, error: "googleAlreadyLinked" };

  await db.insert(oauthAccounts).values({
    provider: "google",
    providerUserId: profile.sub,
    userId,
    createdAt: now.toISOString(),
  });
  return { ok: true };
}

/** Google bağlantısını kaldırır; şifresi olmayan hesap girişsiz kalacağı için izin verilmez. */
export async function unlinkGoogle(db: Db, userId: string): Promise<Result<object, "noPassword">> {
  const row = await authRow(db, userId);
  if (!row?.passwordHash) return { ok: false, error: "noPassword" };
  await db
    .delete(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, "google")));
  return { ok: true };
}

/**
 * Hesabı ve tüm verisini siler. Onay için e-posta yazılır; şifreli hesapta şifre de istenir.
 * Bağlı tablolar açıkça silinir (yabancı anahtar zincirine güvenilmez).
 * Not: gerçek ödeme bağlandığında siparişler yasal saklama süresince anonimleştirilerek tutulmalı.
 */
export async function deleteAccount(
  db: Db,
  userId: string,
  input: { confirmEmail: string; password?: string | undefined },
  ip: string | null,
  now: Date,
  cleanup: { tts: TtsProvider | null; storage: FileStorage | null } = { tts: null, storage: null },
): Promise<Result<object, "confirmMismatch" | "invalidCredentials"> | RateLimited> {
  const row = await authRow(db, userId);
  if (!row) return { ok: false, error: "invalidCredentials" };
  if (normEmail(input.confirmEmail) !== row.email) return { ok: false, error: "confirmMismatch" };
  if (row.passwordHash) {
    const check = await confirmPassword(
      db,
      { email: row.email, passwordHash: row.passwordHash },
      input.password,
      ip,
      now,
    );
    if (!check.ok) return check;
  }

  // Kişisel veri dışarıda kalmasın: sağlayıcıdaki klonlar ve ses dosyaları da silinir.
  // Bunlar en iyi çabayla yapılır; başarısızlık hesap silmeyi durdurmaz, loglanır.
  if (cleanup.tts) {
    const clones = await db
      .select({ pid: voiceClones.providerVoiceId })
      .from(voiceClones)
      .where(and(eq(voiceClones.userId, userId), isNotNull(voiceClones.providerVoiceId)));
    for (const c of clones) {
      await cleanup.tts
        .deleteVoice(c.pid!)
        .catch((err: unknown) =>
          console.error("[ses] klon silinemedi:", err instanceof Error ? err.message : err),
        );
    }
  }
  if (cleanup.storage) {
    await cleanup.storage
      .removePrefix(userId)
      .catch((err: unknown) =>
        console.error("[ses] dosyalar silinemedi:", err instanceof Error ? err.message : err),
      );
  }

  await db.transaction(async (tx) => {
    for (const table of [
      sessions,
      creditGrants,
      generations,
      projects,
      voiceClones,
      oauthAccounts,
      emailTokens,
      apiKeys,
    ]) {
      await tx.delete(table).where(eq(table.userId, userId));
    }
    // Mali kayıtlar (siparişler, bakiye defteri, ödeme talepleri) yasal saklama
    // için kalır; kişisel bilgi taşımazlar ve anonim kullanıcı satırına bağlı kalır.
    await tx
      .update(paymentIntents)
      .set({ status: "expired" })
      .where(and(eq(paymentIntents.userId, userId), eq(paymentIntents.status, "pending")));
    await tx
      .update(users)
      .set({
        name: "",
        email: deletedEmail(userId),
        passwordHash: null,
        emailVerifiedAt: null,
        deletedAt: now.toISOString(),
      })
      .where(eq(users.id, userId));
  });
  return { ok: true };
}

/** Silinmiş hesabın e-posta yeri: benzersiz, gönderilemez (.invalid) ve gerçek adresi taşımaz. */
export const deletedEmail = (userId: string) => `deleted-${userId}@invalid`;

// ---------------------------------------------------------------- e-posta: doğrulama ve şifre sıfırlama

const TOKEN_TTL = { verify: DAY, reset: 60 * 60_000 } as const;
export type TokenPurpose = keyof typeof TOKEN_TTL;

/** E-posta gönderimi için bağlam; bağlantılar appUrl köküne göre kurulur. */
export interface MailContext {
  mailer: Mailer;
  appUrl: string;
  lang: Lang;
}

/** Yeni token üretir; aynı amaçlı kullanılmamış eski token'lar geçersiz olur. */
export async function issueEmailToken(
  db: Db,
  userId: string,
  purpose: TokenPurpose,
  email: string,
  now: Date,
): Promise<string> {
  const token = newSessionToken();
  await db.transaction(async (tx) => {
    await tx
      .delete(emailTokens)
      .where(
        and(
          eq(emailTokens.userId, userId),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.usedAt),
        ),
      );
    await tx.insert(emailTokens).values({
      id: hashToken(token),
      userId,
      purpose,
      email,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TOKEN_TTL[purpose]).toISOString(),
      usedAt: null,
    });
  });
  return token;
}

/** Token'ı tek seferlik kullanır; eşzamanlı iki kullanımdan yalnız biri geçer. */
async function consumeEmailToken(
  conn: Conn,
  token: string,
  purpose: TokenPurpose,
  now: Date,
): Promise<Result<{ userId: string; email: string }, TokenErrorCode>> {
  const row = await conn
    .select()
    .from(emailTokens)
    .where(and(eq(emailTokens.id, hashToken(token)), eq(emailTokens.purpose, purpose)))
    .get();
  if (!row || row.usedAt) return { ok: false, error: "invalidToken" };
  if (Date.parse(row.expiresAt) <= now.getTime()) return { ok: false, error: "expiredToken" };
  const res = await conn
    .update(emailTokens)
    .set({ usedAt: now.toISOString() })
    .where(and(eq(emailTokens.id, row.id), isNull(emailTokens.usedAt)));
  if (res.rowsAffected === 0) return { ok: false, error: "invalidToken" };
  return { ok: true, userId: row.userId, email: row.email };
}

async function deliver(ctx: MailContext, msg: EmailMessage): Promise<boolean> {
  try {
    await ctx.mailer.send(msg);
    return true;
  } catch (err) {
    console.error(
      `[e-posta] "${msg.subject}" gönderilemedi:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

export async function sendVerificationEmail(
  db: Db,
  ctx: MailContext,
  userId: string,
  now: Date,
): Promise<Result<object, EmailErrorCode>> {
  const user = await db
    .select({ name: users.name, email: users.email, verifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user) return { ok: false, error: "sendFailed" };
  if (user.verifiedAt) return { ok: false, error: "alreadyVerified" };
  const token = await issueEmailToken(db, userId, "verify", user.email, now);
  const url = `${ctx.appUrl}/verify-email?token=${token}`;
  const sent = await deliver(ctx, {
    to: user.email,
    ...verifyEmailTemplate(ctx.lang, user.name, url),
  });
  return sent ? { ok: true } : { ok: false, error: "sendFailed" };
}

/** Doğrulama e-postasını yeniden gönderir; kullanıcı başına saatte 3. */
export async function resendVerification(
  db: Db,
  ctx: MailContext,
  userId: string,
  now: Date,
): Promise<Result<object, EmailErrorCode> | RateLimited> {
  const key = `verify:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.verifyResendPerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);
  return sendVerificationEmail(db, ctx, userId, now);
}

/** Doğrulama bağlantısı: e-postayı doğrulanmış işaretler ve deneme kredisini tanımlar. */
export async function verifyEmailWithToken(
  db: Db,
  token: string,
  now: Date,
): Promise<Result<{ userId: string }, TokenErrorCode>> {
  return db.transaction(async (tx) => {
    const used = await consumeEmailToken(tx, token, "verify", now);
    if (!used.ok) return used;
    const user = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, used.userId))
      .get();
    // Adres token verildikten sonra değiştiyse eski adresin doğrulaması geçmez.
    if (!user || user.email !== used.email) return { ok: false, error: "invalidToken" } as const;
    await markEmailVerified(tx, used.userId, now);
    return { ok: true, userId: used.userId } as const;
  });
}

/**
 * Şifre sıfırlama isteği. Yanıt her durumda aynıdır; e-postanın kayıtlı olup
 * olmadığı anlaşılmaz. Sınır, var olmayan adresler için de sayılır.
 */
export async function requestPasswordReset(
  db: Db,
  ctx: MailContext,
  email: string,
  ip: string | null,
  now: Date,
): Promise<{ ok: true } | RateLimited> {
  const norm = normEmail(email);
  const checks: [string, Limit][] = [[`reset:email:${norm}`, LIMITS.resetPerEmail]];
  if (ip) checks.push([`reset:ip:${ip}`, LIMITS.resetPerIp]);
  const stop = await blocked(db, checks, now);
  if (stop) return stop;
  for (const [key] of checks) await recordAttempt(db, key, now);

  const user = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.email, norm))
    .get();
  if (user) {
    const token = await issueEmailToken(db, user.id, "reset", user.email, now);
    const url = `${ctx.appUrl}/reset-password?token=${token}`;
    await deliver(ctx, { to: user.email, ...resetPasswordTemplate(ctx.lang, user.name, url) });
  }
  return { ok: true };
}

/**
 * Sıfırlama bağlantısıyla yeni şifre. Tüm oturumlar kapanır, o e-postanın giriş
 * deneme sayacı sıfırlanır; e-posta sahipliği kanıtlandığı için doğrulanmış sayılır.
 */
export async function resetPasswordWithToken(
  db: Db,
  token: string,
  next: string,
  now: Date,
): Promise<Result<{ userId: string }, TokenErrorCode | "invalidInput">> {
  if (next.length < 8 || next.length > 200) return { ok: false, error: "invalidInput" };
  const passwordHash = await hashPassword(next);
  return db.transaction(async (tx) => {
    const used = await consumeEmailToken(tx, token, "reset", now);
    if (!used.ok) return used;
    const user = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, used.userId))
      .get();
    if (!user || user.email !== used.email) return { ok: false, error: "invalidToken" } as const;
    await tx.update(users).set({ passwordHash }).where(eq(users.id, used.userId));
    await tx.delete(sessions).where(eq(sessions.userId, used.userId));
    await tx.delete(authAttempts).where(eq(authAttempts.key, `signin:email:${user.email}`));
    await markEmailVerified(tx, used.userId, now);
    return { ok: true, userId: used.userId } as const;
  });
}

/** "Şifren değiştirildi" güvenlik bildirimi; gönderilemezse işlem yine geçerlidir. */
export async function sendPasswordChangedNotice(
  db: Db,
  ctx: MailContext,
  userId: string,
  now: Date,
): Promise<void> {
  const user = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user) return;
  const resetUrl = `${ctx.appUrl}/forgot-password`;
  await deliver(ctx, {
    to: user.email,
    ...passwordChangedTemplate(ctx.lang, user.name, now, resetUrl),
  });
}

// ---------------------------------------------------------------- ödeme makbuzları

/** Makbuz e-postası için gönderici ve bağlantı kökü (dil, ödeme talebinden gelir). */
export interface ReceiptContext {
  mailer: Mailer;
  appUrl: string;
}

/**
 * Tamamlanan bakiye yüklemesinin makbuzu. Ödeme hangi yoldan tamamlanırsa
 * tamamlansın (kullanıcı doğrulaması, webhook, yönetici) her ödeme için bir kez
 * gider: gönderim koşullu güncellemeyle işaretlenir. Demo yüklemeye ve silinmiş
 * hesaba gönderilmez. Gönderim hatası ödemeyi etkilemez, loglanır.
 */
export async function sendTopUpReceipt(
  db: Db,
  ctx: ReceiptContext,
  intentId: string,
  now: Date,
): Promise<boolean> {
  const claim = await db
    .update(paymentIntents)
    .set({ receiptSentAt: now.toISOString() })
    .where(
      and(
        eq(paymentIntents.id, intentId),
        eq(paymentIntents.status, "completed"),
        ne(paymentIntents.method, "demo"),
        isNull(paymentIntents.receiptSentAt),
      ),
    );
  if (claim.rowsAffected === 0) return false;
  const row = await db
    .select({
      intent: paymentIntents,
      name: users.name,
      email: users.email,
      deletedAt: users.deletedAt,
    })
    .from(paymentIntents)
    .innerJoin(users, eq(users.id, paymentIntents.userId))
    .where(eq(paymentIntents.id, intentId))
    .get();
  if (!row || row.deletedAt) return false;
  const lang: Lang = row.intent.lang ?? "tr";
  return deliver(
    { ...ctx, lang },
    {
      to: row.email,
      ...topUpReceiptTemplate(lang, row.name, {
        method: row.intent.method,
        creditCents: creditCentsFor(row.intent),
        balanceCents: await walletBalance(db, row.intent.userId),
        reference: row.intent.id,
        when: now,
        historyUrl: `${ctx.appUrl}/payment-history`,
      }),
    },
  );
}

/** Bakiyeden alınan paketin makbuzu. */
export async function sendPurchaseReceipt(
  db: Db,
  ctx: ReceiptContext & { lang: Lang },
  userId: string,
  order: Order,
): Promise<boolean> {
  const user = await db
    .select({ name: users.name, email: users.email, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user || user.deletedAt) return false;
  return deliver(ctx, {
    to: user.email,
    ...purchaseReceiptTemplate(ctx.lang, user.name, {
      kind: order.kind,
      credits: order.credits,
      days: order.days,
      priceCents: Math.round(order.amountUsd * 100),
      balanceCents: await walletBalance(db, userId),
      expiresAt: new Date(order.expiresAt),
      studioUrl: `${ctx.appUrl}/labs`,
    }),
  });
}

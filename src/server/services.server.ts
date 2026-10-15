import { randomInt, randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, gt, isNotNull, isNull, lt, ne } from "drizzle-orm";

import {
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
import { findPackage, signupBonus } from "@/lib/packages";
import { LIMITS, checkLimit, retryMinutes, type Limit } from "@/lib/rate-limit";
import type {
  Account,
  ActionErrorCode,
  AuthErrorCode,
  EmailErrorCode,
  GenerateInput,
  GoogleErrorCode,
  Generation,
  Order,
  PaymentMethod,
  RateLimited,
  TokenErrorCode,
  UserData,
} from "@/lib/types";
import { stockVoices } from "@/lib/voices";

import type { Lang } from "@/lib/i18n";

import type { AudioStorage } from "./audio-storage.server";
import type { Db } from "./db.server";
import type { EmailMessage, Mailer } from "./email.server";
import {
  passwordChangedTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from "./email-templates.server";
import type { GoogleProfile } from "./google.server";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password.server";
import {
  authAttempts,
  creditGrants,
  emailTokens,
  generations,
  oauthAccounts,
  orders,
  sessions,
  users,
  voiceClones,
} from "./schema.server";
import { SESSION_DAYS, hashToken, newSessionToken } from "./session.server";
import type { CloneFile, ProviderVoice, TtsProvider } from "./tts.server";

const DAY = 86_400_000;
const SAMPLE_IMAGE_COUNT = 4;
const VIDEO_STYLE_COUNT = 4;

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

type Conn = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

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

async function recordAttempt(db: Db, key: string, now: Date) {
  await db.insert(authAttempts).values({ id: randomUUID(), key, createdAt: now.toISOString() });
  // Bir günden eski kayıtlar artık hiçbir pencereye girmez.
  await db
    .delete(authAttempts)
    .where(lt(authAttempts.createdAt, new Date(now.getTime() - DAY).toISOString()));
}

/** Kontrol edilen anahtarlardan en uzun bekleme süresini döner; hepsi serbestse null. */
async function blocked(
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
type GenerationRow = typeof generations.$inferSelect;

const toGrant = ({ userId: _u, ...g }: GrantRow): Grant => g;

const toOrder = ({ userId: _u, amountCents, ...o }: OrderRow): Order => ({
  ...o,
  amountUsd: amountCents / 100,
});

const toGeneration = (g: GenerationRow): Generation => ({
  id: g.id,
  type: g.type,
  text: g.text,
  voiceId: g.voiceId ?? undefined,
  style: g.style ?? undefined,
  images: g.images ?? undefined,
  audioUrl: g.audioKey ? `/media/audio/${g.id}` : undefined,
  cost: g.cost,
  createdAt: g.createdAt,
});

export async function loadUserData(db: Db, userId: string): Promise<UserData> {
  const [grantRows, orderRows, genRows, cloneRows, auth, google] = await Promise.all([
    db
      .select()
      .from(creditGrants)
      .where(eq(creditGrants.userId, userId))
      .orderBy(asc(creditGrants.grantedAt)),
    db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)),
    db
      .select()
      .from(generations)
      .where(eq(generations.userId, userId))
      .orderBy(desc(generations.createdAt)),
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
  ]);
  return {
    grants: grantRows.map(toGrant),
    orders: orderRows.map(toOrder),
    generations: genRows.map(toGeneration),
    clones: cloneRows.map(({ providerVoiceId, ...c }) => ({
      ...c,
      live: Boolean(providerVoiceId),
    })),
    security: {
      hasPassword: Boolean(auth?.passwordHash),
      googleLinked: Boolean(google),
      emailVerified: Boolean(auth?.verifiedAt),
    },
  };
}

// ---------------------------------------------------------------- satın alma

/**
 * Demo satın alma: sipariş anında "ödendi" sayılır. Gerçek ödeme sağlayıcısı
 * bağlandığında kredi yalnız sağlayıcının onay bildirimiyle tanımlanmalı.
 */
export async function purchasePackage(
  db: Db,
  userId: string,
  input: { packageId: string; method: PaymentMethod },
  now: Date,
): Promise<Result<{ order: Order }, ActionErrorCode>> {
  const pkg = findPackage(input.packageId);
  if (!pkg) return { ok: false, error: "invalidInput" };
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
    amountCents: Math.round(pkg.priceUsd * 100),
    method: input.method,
    status: "paid",
    createdAt: grant.grantedAt,
    expiresAt: grant.expiresAt,
  };
  await db.transaction(async (tx) => {
    await tx.insert(orders).values(row);
    await tx.insert(creditGrants).values({ ...grant, userId });
  });
  return { ok: true, order: toOrder(row) };
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
        },
      };
    }
    case "image": {
      if (![1, 2, 4].includes(input.count) || text.length > 400) return null;
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
  if (!(await chargeAndRecord(db, userId, plan.kind, plan.cost, row, now))) {
    return { ok: false, error: "insufficient" };
  }
  return { ok: true, generation: toGeneration(row) };
}

/** Krediyi düşer ve üretimi kaydeder; ikisi tek transaction'dadır. Bakiye yetmezse false. */
async function chargeAndRecord(
  db: Db,
  userId: string,
  kind: CreditKind,
  cost: number,
  row: GenerationRow,
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const current = (
      await tx.select().from(creditGrants).where(eq(creditGrants.userId, userId))
    ).map(toGrant);
    const next = spend(current, kind, cost, now);
    if (!next) return false;
    for (const g of next) {
      const before = current.find((c) => c.id === g.id);
      if (before && before.remaining !== g.remaining) {
        await tx
          .update(creditGrants)
          .set({ remaining: g.remaining })
          .where(eq(creditGrants.id, g.id));
      }
    }
    await tx.insert(generations).values(row);
    return true;
  });
}

/** Üretimi siler; ses dosyası varsa depodan da kaldırılır. */
export async function removeGeneration(
  db: Db,
  userId: string,
  id: string,
  storage?: AudioStorage,
): Promise<void> {
  const row = await db
    .select({ audioKey: generations.audioKey })
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.userId, userId)))
    .get();
  if (!row) return;
  await db.delete(generations).where(and(eq(generations.id, id), eq(generations.userId, userId)));
  if (row.audioKey && storage) await storage.remove(row.audioKey);
}

// ---------------------------------------------------------------- gerçek seslendirme (ElevenLabs)

export interface SpeechDeps {
  tts: TtsProvider;
  storage: AudioStorage;
  /** Herkese açık hazır sesler (kullanıcı klonları ayıklanmış). */
  catalog: () => Promise<ProviderVoice[]>;
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
 * Gerçek seslendirme. Kredi yalnız başarıda düşer: bakiye ön kontrolü, sağlayıcı
 * çağrısı, ardından tek transaction'da düşüm ve kayıt. Düşüm eşzamanlı başka bir
 * istek yüzünden başarısız olursa üretilen dosya silinir.
 */
export async function generateSpeech(
  db: Db,
  deps: SpeechDeps,
  userId: string,
  input: { text: string; voiceId: string },
  now: Date,
): Promise<Result<{ generation: Generation }, ActionErrorCode> | RateLimited> {
  const text = input.text.trim();
  if (!text || [...text].length > MAX_TTS_CHARS) return { ok: false, error: "invalidInput" };
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

  const key = `tts:user:${userId}`;
  const stop = await blocked(db, [[key, LIMITS.ttsPerUser]], now);
  if (stop) return stop;
  await recordAttempt(db, key, now);

  let audio: Uint8Array;
  try {
    audio = await deps.tts.synthesize(providerVoiceId, text);
  } catch (err) {
    console.error("[ses] seslendirme başarısız:", err instanceof Error ? err.message : err);
    return { ok: false, error: "providerFailed" };
  }

  const id = randomUUID();
  const audioKey = `${userId}/${id}.mp3`;
  await deps.storage.put(audioKey, audio);
  const row: GenerationRow = {
    id,
    userId,
    type: "tts",
    text,
    voiceId: input.voiceId,
    style: null,
    images: null,
    audioKey,
    cost,
    createdAt: now.toISOString(),
  };
  if (!(await chargeAndRecord(db, userId, "voice", cost, row, now))) {
    await deps.storage.remove(audioKey);
    return { ok: false, error: "insufficient" };
  }
  return { ok: true, generation: toGeneration(row) };
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
  cleanup: { tts: TtsProvider | null; storage: AudioStorage | null } = { tts: null, storage: null },
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
      orders,
      generations,
      voiceClones,
      oauthAccounts,
      emailTokens,
    ]) {
      await tx.delete(table).where(eq(table.userId, userId));
    }
    await tx.delete(users).where(eq(users.id, userId));
  });
  return { ok: true };
}

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

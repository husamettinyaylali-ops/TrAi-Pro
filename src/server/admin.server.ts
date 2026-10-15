import { randomUUID } from "node:crypto";

import { and, count, desc, eq, gt, isNotNull, isNull, ne, or, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type {
  AdminAction,
  AdminIntentRow,
  AdminOverview,
  AdminUserDetail,
  AdminUserRow,
  TopUpIntent,
  TopUpMethod,
} from "@/lib/types";
import { MAX_TOPUP_CENTS } from "@/lib/wallet";

import type { Db } from "./db.server";
import { adminActions, orders, paymentIntents, users, walletEntries } from "./schema.server";
import { TX_HASH_RE } from "./bsc.server";
import {
  completeTopUpIn,
  normEmail,
  toIntent,
  toOrder,
  walletBalance,
  type Result,
} from "./services.server";

/** ADMIN_EMAILS (virgülle ayrılmış) listesinden yönetici e-postaları. */
export function adminEmails(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map(normEmail)
      .filter((e) => e.includes("@")),
  );
}

/**
 * Yönetici: e-postası listede, doğrulanmış ve hesabı silinmemiş kullanıcı.
 * Doğrulama şartı, listedeki adresle kayıt olup e-postayı sahiplenmemiş birinin
 * yetki almasını engeller.
 */
export async function isAdmin(
  db: Db,
  userId: string,
  admins: ReadonlySet<string>,
): Promise<boolean> {
  if (!admins.size) return false;
  const row = await db
    .select({ email: users.email, verified: users.emailVerifiedAt, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return !!row && !row.deletedAt && !!row.verified && admins.has(row.email);
}

const DAY = 24 * 60 * 60_000;

export async function adminOverview(db: Db, now: Date): Promise<AdminOverview> {
  const since = new Date(now.getTime() - DAY).toISOString();
  const [active, deleted, liability, topUps, pending] = await Promise.all([
    db.select({ n: count() }).from(users).where(isNull(users.deletedAt)).get(),
    db.select({ n: count() }).from(users).where(isNotNull(users.deletedAt)).get(),
    db
      .select({ total: sum(walletEntries.amountCents) })
      .from(walletEntries)
      .get(),
    db
      .select({ total: sum(walletEntries.amountCents) })
      .from(walletEntries)
      .innerJoin(paymentIntents, eq(walletEntries.reference, paymentIntents.id))
      .where(
        and(
          eq(walletEntries.kind, "topup"),
          gt(walletEntries.createdAt, since),
          ne(paymentIntents.method, "demo"),
        ),
      )
      .get(),
    db
      .select({ n: count() })
      .from(paymentIntents)
      .where(
        and(eq(paymentIntents.status, "pending"), gt(paymentIntents.expiresAt, now.toISOString())),
      )
      .get(),
  ]);
  return {
    users: active?.n ?? 0,
    deletedUsers: deleted?.n ?? 0,
    liabilityCents: Number(liability?.total ?? 0),
    topUps24hCents: Number(topUps?.total ?? 0),
    pendingIntents: pending?.n ?? 0,
  };
}

// Tablo adları açık yazılır: Drizzle tek tablolu sorguda sütunu niteliksiz ("id")
// yazar, alt sorgu içinde bu wallet_entries.id'ye bağlanırdı.
const balanceOf = sql<number>`coalesce((select sum(w.amount_cents) from wallet_entries w where w.user_id = users.id), 0)`;

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  createdAt: users.createdAt,
  verifiedAt: users.emailVerifiedAt,
  deletedAt: users.deletedAt,
  balance: balanceOf,
};

const toRow = (r: {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  verifiedAt: string | null;
  deletedAt: string | null;
  balance: number;
}): AdminUserRow => ({
  id: r.id,
  name: r.name,
  email: r.email,
  createdAt: r.createdAt,
  verified: !!r.verifiedAt,
  deletedAt: r.deletedAt,
  balanceCents: Number(r.balance),
});

/** LIKE desenindeki joker karakterleri kaçırır. */
const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);
const likePattern = (q: string) => `%${escapeLike(q)}%`;

/**
 * Kullanıcı arama: e-posta ya da ad parçası (ASCII'de büyük/küçük harf
 * duyarsız) veya tam kullanıcı kimliği. Boş aramada en yeni kullanıcılar.
 */
export async function searchUsers(db: Db, query: string, limit = 20): Promise<AdminUserRow[]> {
  const q = query.trim().slice(0, 100);
  const base = db.select(userColumns).from(users);
  const filtered = q
    ? base.where(
        or(
          eq(users.id, q),
          sql`${users.email} like ${likePattern(q)} escape '\\'`,
          sql`${users.name} like ${likePattern(q)} escape '\\'`,
        ),
      )
    : base;
  const rows = await filtered.orderBy(desc(users.createdAt)).limit(limit);
  return rows.map(toRow);
}

export async function recentActions(
  db: Db,
  opts: { targetUserId?: string; limit?: number } = {},
): Promise<AdminAction[]> {
  const admin = alias(users, "admin");
  const target = alias(users, "target");
  const rows = await db
    .select({ a: adminActions, adminEmail: admin.email, targetEmail: target.email })
    .from(adminActions)
    .innerJoin(admin, eq(admin.id, adminActions.adminId))
    .leftJoin(target, eq(target.id, adminActions.targetUserId))
    .where(opts.targetUserId ? eq(adminActions.targetUserId, opts.targetUserId) : undefined)
    .orderBy(desc(adminActions.createdAt))
    .limit(opts.limit ?? 50);
  return rows.map(({ a, adminEmail, targetEmail }) => {
    const details = JSON.parse(a.details) as { amountCents?: number };
    return {
      id: a.id,
      adminEmail,
      action: a.action,
      targetUserId: a.targetUserId,
      targetEmail,
      reason: a.reason,
      amountCents: typeof details.amountCents === "number" ? details.amountCents : null,
      createdAt: a.createdAt,
    };
  });
}

export async function userDetail(db: Db, userId: string): Promise<AdminUserDetail | null> {
  const row = await db.select(userColumns).from(users).where(eq(users.id, userId)).get();
  if (!row) return null;
  const [entries, intents, orderRows, actions] = await Promise.all([
    db
      .select()
      .from(walletEntries)
      .where(eq(walletEntries.userId, userId))
      .orderBy(desc(walletEntries.createdAt))
      .limit(50),
    db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.userId, userId))
      .orderBy(desc(paymentIntents.createdAt))
      .limit(50),
    db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(20),
    recentActions(db, { targetUserId: userId, limit: 20 }),
  ]);
  return {
    user: toRow(row),
    entries: entries.map(({ userId: _u, ...e }) => e),
    intents: intents.map((r) => ({ ...toIntent(r), providerRef: r.providerRef })),
    orders: orderRows.map(toOrder),
    actions,
  };
}

export const REASON_MIN = 5;
export const REASON_MAX = 500;

/**
 * Bakiye düzeltmesi: deftere "adjust" kaydı ve gerekçeli yönetici işlemi tek
 * transaction'da yazılır. Bakiye eksiye düşürülemez; yönetici kendi bakiyesini
 * düzeltemez.
 */
export async function adjustBalance(
  db: Db,
  adminId: string,
  input: { userId: string; amountCents: number; reason: string },
  now: Date,
): Promise<
  Result<{ balanceCents: number }, "notFound" | "invalidInput" | "negativeBalance" | "selfAction">
> {
  const reason = input.reason.trim();
  const amount = input.amountCents;
  if (
    !Number.isInteger(amount) ||
    amount === 0 ||
    Math.abs(amount) > MAX_TOPUP_CENTS ||
    reason.length < REASON_MIN ||
    reason.length > REASON_MAX
  ) {
    return { ok: false, error: "invalidInput" };
  }
  if (input.userId === adminId) return { ok: false, error: "selfAction" };

  return db.transaction(async (tx) => {
    const user = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .get();
    if (!user) return { ok: false, error: "notFound" } as const;
    const balance = await walletBalance(tx, input.userId);
    if (balance + amount < 0) return { ok: false, error: "negativeBalance" } as const;

    const actionId = randomUUID();
    const at = now.toISOString();
    await tx.insert(adminActions).values({
      id: actionId,
      adminId,
      action: "adjustBalance",
      targetUserId: input.userId,
      reason,
      details: JSON.stringify({ amountCents: amount }),
      createdAt: at,
    });
    await tx.insert(walletEntries).values({
      id: randomUUID(),
      userId: input.userId,
      kind: "adjust",
      amountCents: amount,
      reference: actionId,
      createdAt: at,
    });
    return { ok: true, balanceCents: balance + amount } as const;
  });
}

/**
 * Ödeme talebi arama: tutar başı (ör. "10.37"), sağlayıcı işlem kimliği ya da
 * kullanıcı e-postası parçası veya tam talep kimliği. Boş aramada en yeniler.
 */
export async function searchIntents(db: Db, query: string, limit = 50): Promise<AdminIntentRow[]> {
  const q = query.trim().slice(0, 100);
  const base = db
    .select({ i: paymentIntents, userEmail: users.email })
    .from(paymentIntents)
    .innerJoin(users, eq(users.id, paymentIntents.userId));
  const amount = q.replace(",", ".");
  const filtered = q
    ? base.where(
        or(
          eq(paymentIntents.id, q),
          sql`${paymentIntents.payAmount} like ${`${escapeLike(amount)}%`} escape '\\'`,
          // LIKE ASCII'de büyük/küçük harf duyarsızdır: küçük harfli USDT özetleri de bulunur.
          sql`${paymentIntents.providerRef} like ${likePattern(q)} escape '\\'`,
          sql`${users.email} like ${likePattern(q)} escape '\\'`,
        ),
      )
    : base;
  const rows = await filtered.orderBy(desc(paymentIntents.createdAt)).limit(limit);
  return rows.map(({ i, userEmail }) => ({
    ...toIntent(i),
    providerRef: i.providerRef,
    userId: i.userId,
    userEmail,
  }));
}

const BINANCE_REF_RE = /^[A-Za-z0-9_-]{4,64}$/;
const PAYPAL_REF_RE = /^[A-Z0-9]{5,40}$/;

/**
 * Yöneticinin girdiği işlem kimliğini otomatik akışların kullandığı biçime
 * getirir; böylece aynı ödeme hem elle hem otomatik olarak yazılamaz.
 */
export function normalizeProviderRef(method: TopUpMethod, raw: string): string | null {
  const v = raw.trim();
  switch (method) {
    case "usdt_bep20": {
      const hash = v.toLowerCase();
      return TX_HASH_RE.test(hash) ? hash : null;
    }
    case "binance_pay": {
      const id = v.replace(/^binance:/i, "");
      return BINANCE_REF_RE.test(id) ? `binance:${id}` : null;
    }
    case "paypal": {
      const id = v.replace(/^paypal:/i, "").toUpperCase();
      return PAYPAL_REF_RE.test(id) ? `paypal:${id}` : null;
    }
    default:
      return null;
  }
}

/**
 * Ödemesi sağlayıcıda doğrulanmış ama otomatik eşleşmemiş talebi (ör. süresi
 * dolduktan sonra ödenmiş) elle tamamlar. Bakiyeye talebin yazılacak tutarı
 * yazılır; tamamlama ve yönetici kaydı aynı transaction'dadır.
 */
export async function completeIntentManually(
  db: Db,
  adminId: string,
  input: { intentId: string; providerRef: string; reason: string },
  now: Date,
): Promise<
  Result<
    { intent: TopUpIntent },
    "notFound" | "invalidInput" | "selfAction" | "alreadyCompleted" | "duplicateRef"
  >
> {
  const reason = input.reason.trim();
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return { ok: false, error: "invalidInput" };
  }
  const intent = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, input.intentId))
    .get();
  if (!intent) return { ok: false, error: "notFound" };
  if (intent.userId === adminId) return { ok: false, error: "selfAction" };
  if (intent.status === "completed") return { ok: false, error: "alreadyCompleted" };
  const ref = normalizeProviderRef(intent.method, input.providerRef);
  if (!ref) return { ok: false, error: "invalidInput" };

  return db.transaction(async (tx) => {
    const done = await completeTopUpIn(tx, intent.id, ref, now, { allowExpired: true });
    if (!done.ok) {
      const error =
        done.error === "duplicateRef"
          ? "duplicateRef"
          : done.error === "notFound"
            ? "notFound"
            : "alreadyCompleted";
      return { ok: false, error } as const;
    }
    await tx.insert(adminActions).values({
      id: randomUUID(),
      adminId,
      action: "completeIntent",
      targetUserId: intent.userId,
      reason,
      details: JSON.stringify({
        intentId: intent.id,
        providerRef: ref,
        amountCents: done.intent.creditCents,
      }),
      createdAt: now.toISOString(),
    });
    return { ok: true, intent: done.intent } as const;
  });
}

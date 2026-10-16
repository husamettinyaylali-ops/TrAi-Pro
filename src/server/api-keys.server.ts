import { randomBytes, randomUUID } from "node:crypto";

import { and, count, desc, eq, isNull } from "drizzle-orm";

import type { ApiKeyInfo } from "@/lib/types";

import type { Db } from "./db.server";
import { apiKeys, users } from "./schema.server";
import type { Result } from "./services.server";
import { hashToken } from "./session.server";

export const API_KEY_PREFIX = "trai_";
/** Kullanıcı başına etkin anahtar sayısı. */
export const MAX_API_KEYS = 5;
const KEY_RE = /^trai_[A-Za-z0-9_-]{43}$/;
/** Son kullanım zamanı her istekte değil, en çok dakikada bir yazılır. */
const TOUCH_MS = 60_000;

const toInfo = (r: typeof apiKeys.$inferSelect): ApiKeyInfo => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  createdAt: r.createdAt,
  lastUsedAt: r.lastUsedAt,
});

/**
 * Yeni anahtar: `trai_` + 32 rastgele bayt (base64url). Veritabanına yalnız
 * özeti yazılır; düz anahtar çağırana bir kez döner. E-postası doğrulanmamış
 * hesap anahtar açamaz (kredi toplama ve kötüye kullanıma karşı).
 */
export async function createApiKey(
  db: Db,
  userId: string,
  name: string,
  now: Date,
): Promise<Result<{ key: string; apiKey: ApiKeyInfo }, "invalidInput" | "limit" | "unverified">> {
  const clean = name.trim();
  if (!clean || clean.length > 40) return { ok: false, error: "invalidInput" };
  const user = await db
    .select({ verified: users.emailVerifiedAt, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user?.verified || user.deletedAt) return { ok: false, error: "unverified" };

  return db.transaction(async (tx) => {
    const active = await tx
      .select({ n: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .get();
    if ((active?.n ?? 0) >= MAX_API_KEYS) return { ok: false, error: "limit" } as const;
    const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const row = {
      id: randomUUID(),
      userId,
      name: clean,
      prefix: key.slice(0, 13),
      keyHash: hashToken(key),
      createdAt: now.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    await tx.insert(apiKeys).values(row);
    return { ok: true, key, apiKey: toInfo(row) } as const;
  });
}

export async function listApiKeys(db: Db, userId: string): Promise<ApiKeyInfo[]> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map(toInfo);
}

export async function revokeApiKey(
  db: Db,
  userId: string,
  id: string,
  now: Date,
): Promise<Result<object, "notFound">> {
  const res = await db
    .update(apiKeys)
    .set({ revokedAt: now.toISOString() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
  return res.rowsAffected ? { ok: true } : { ok: false, error: "notFound" };
}

/** Bearer anahtarını doğrular: biçim, özet, iptal ve hesap durumu. */
export async function authenticateApiKey(
  db: Db,
  key: string,
  now: Date,
): Promise<{ userId: string; keyId: string } | null> {
  if (!KEY_RE.test(key)) return null;
  const row = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      deletedAt: users.deletedAt,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.keyHash, hashToken(key)))
    .get();
  if (!row || row.revokedAt || row.deletedAt) return null;
  if (!row.lastUsedAt || now.getTime() - Date.parse(row.lastUsedAt) > TOUCH_MS) {
    await db.update(apiKeys).set({ lastUsedAt: now.toISOString() }).where(eq(apiKeys.id, row.id));
  }
  return { userId: row.userId, keyId: row.id };
}

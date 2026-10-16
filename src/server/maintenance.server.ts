import { and, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";

import { clock } from "@/lib/clock";

import { startBackups } from "./backup.server";
import { getDb, type Db } from "./db.server";
import { env, isProduction } from "./env.server";
import {
  adminActions,
  emailTokens,
  orders,
  paymentIntents,
  sessions,
  users,
  walletEntries,
} from "./schema.server";

const DAY = 24 * 60 * 60_000;
/** Silinmiş hesapların anonim mali kayıtlarının saklama süresi (kullanıcı kararı, 2026-10-16). */
export const DEFAULT_RETENTION_YEARS = 10;

/** RETENTION_YEARS: boşsa 10, "off" ya da 0 ise temizleme kapalı (null), aksi halde 1–50 yıl. */
export function retentionYears(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return DEFAULT_RETENTION_YEARS;
  if (raw.trim().toLowerCase() === "off") return null;
  const n = Number(raw);
  if (n === 0) return null;
  return Number.isInteger(n) && n > 0 && n <= 50 ? n : DEFAULT_RETENTION_YEARS;
}

export interface PurgeReport {
  sessions: number;
  emailTokens: number;
  records: number;
  users: number;
}

/**
 * Bakım: süresi dolmuş oturumlar ve bir günden eski süresi geçmiş e-posta
 * token'ları silinir. Saklama süresi verilmişse, hesabı silinmiş kullanıcıların
 * o süreden eski mali kayıtları (sipariş, bakiye defteri, ödeme talebi) ve
 * onlarla ilgili yönetici kayıtları silinir; hiçbir kaydı kalmayan ve süreyi
 * aşmış anonim kullanıcı satırı da kaldırılır. Aktif kullanıcıların geçmişine
 * dokunulmaz.
 */
export async function purgeExpired(db: Db, now: Date, years: number | null): Promise<PurgeReport> {
  const report: PurgeReport = { sessions: 0, emailTokens: 0, records: 0, users: 0 };
  report.sessions = (
    await db.delete(sessions).where(lte(sessions.expiresAt, now.toISOString()))
  ).rowsAffected;
  report.emailTokens = (
    await db
      .delete(emailTokens)
      .where(lt(emailTokens.expiresAt, new Date(now.getTime() - DAY).toISOString()))
  ).rowsAffected;
  if (years === null) return report;

  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  const before = cutoff.toISOString();
  const deleted = db.select({ id: users.id }).from(users).where(isNotNull(users.deletedAt));

  await db.transaction(async (tx) => {
    for (const table of [orders, walletEntries, paymentIntents]) {
      const res = await tx
        .delete(table)
        .where(and(inArray(table.userId, deleted), lt(table.createdAt, before)));
      report.records += res.rowsAffected;
    }
    report.records += (
      await tx
        .delete(adminActions)
        .where(and(inArray(adminActions.targetUserId, deleted), lt(adminActions.createdAt, before)))
    ).rowsAffected;
    report.users = (
      await tx
        .delete(users)
        .where(
          and(
            isNotNull(users.deletedAt),
            lt(users.deletedAt, before),
            sql`not exists (select 1 from orders o where o.user_id = users.id)`,
            sql`not exists (select 1 from wallet_entries w where w.user_id = users.id)`,
            sql`not exists (select 1 from payment_intents p where p.user_id = users.id)`,
            sql`not exists (select 1 from admin_actions a where a.target_user_id = users.id or a.admin_id = users.id)`,
          ),
        )
    ).rowsAffected;
  });
  return report;
}

let started = false;

/**
 * Yayında günlük bakım: veritabanı yedeği (BACKUP_DIR varsa) ve temizleme.
 * Açılıştan birkaç dakika sonra ve sonra her gün çalışır; hata loglanır.
 */
export function startMaintenance(): void {
  if (started || !isProduction()) return;
  started = true;
  startBackups();
  const years = retentionYears(env("RETENTION_YEARS"));
  const run = () =>
    getDb()
      .then((db) => purgeExpired(db, clock(), years))
      .then((r) => {
        if (r.records || r.users) {
          console.info(
            `[bakım] saklama süresi dolan ${r.records} kayıt ve ${r.users} anonim hesap silindi`,
          );
        }
      })
      .catch((err: unknown) =>
        console.error("[bakım] temizleme başarısız:", err instanceof Error ? err.message : err),
      );
  setTimeout(run, 5 * 60_000).unref();
  setInterval(run, DAY).unref();
}

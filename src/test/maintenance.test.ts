// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { adjustBalance } from "@/server/admin.server";
import { openDb, type Db } from "@/server/db.server";
import { purgeExpired, retentionYears } from "@/server/maintenance.server";
import {
  createSession,
  deleteAccount,
  demoTopUp,
  markEmailVerified,
  purchasePackage,
  registerUser,
} from "@/server/services.server";

const t0 = new Date("2026-10-16T09:00:00Z");
const years = (n: number, extraDays = 0) => {
  const d = new Date(t0);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return new Date(d.getTime() + extraDays * 86_400_000);
};
const dir = mkdtempSync(join(tmpdir(), "trai-maint-"));
let db: Db;

beforeEach(async () => {
  db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
});
afterEach(() => db.$client.close());
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

async function customer(email: string) {
  const res = await registerUser(db, { name: "K", email, password: "gizli-sifre-1" }, t0);
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, t0);
  await demoTopUp(db, res.userId, 500, t0);
  const bought = await purchasePackage(db, res.userId, { packageId: "media-2d" }, t0);
  if (!bought.ok) throw new Error(bought.error);
  return res.userId;
}

const count = async (sql: string, args: string[] = []) =>
  Number((await db.$client.execute({ sql, args })).rows[0]!["n"]);

describe("saklama süresi", () => {
  it("varsayılan 10 yıl; off/0 kapalı; geçersiz değer varsayılana döner", () => {
    expect(retentionYears(undefined)).toBe(10);
    expect(retentionYears(" ")).toBe(10);
    expect(retentionYears("5")).toBe(5);
    expect(retentionYears("off")).toBeNull();
    expect(retentionYears("0")).toBeNull();
    expect(retentionYears("abc")).toBe(10);
  });
});

describe("bakım temizliği", () => {
  it("silinmiş hesabın mali kayıtları 10 yıl dolunca silinir; aktif kullanıcıya dokunulmaz", async () => {
    const admin = await customer("admin@example.com");
    const gone = await customer("silinen@example.com");
    const active = await customer("aktif@example.com");
    await adjustBalance(
      db,
      admin,
      { userId: gone, amountCents: 100, reason: "Destek talebi #1" },
      t0,
    );
    await deleteAccount(
      db,
      gone,
      { confirmEmail: "silinen@example.com", password: "gizli-sifre-1" },
      null,
      t0,
    );

    const of = (table: string, id: string) =>
      count(`select count(*) n from ${table} where user_id = ?`, [id]);
    expect(await of("orders", gone)).toBe(1);

    // Süre dolmadan: hiçbir mali kayıt silinmez.
    expect(await purgeExpired(db, years(10, -1), 10)).toMatchObject({ records: 0, users: 0 });
    expect(await of("wallet_entries", gone)).toBe(3);

    // Süre dolunca: silinmiş hesabın kayıtları ve anonim satırı gider.
    const report = await purgeExpired(db, years(10, 1), 10);
    expect(report.users).toBe(1);
    for (const table of ["orders", "wallet_entries", "payment_intents"]) {
      expect(await of(table, gone), table).toBe(0);
    }
    expect(await count("select count(*) n from users where id = ?", [gone])).toBe(0);
    expect(await count("select count(*) n from admin_actions")).toBe(0);

    // Aktif kullanıcıların eski kayıtları ve hesapları kalır.
    expect(await of("orders", active)).toBe(1);
    expect(await of("wallet_entries", admin)).toBe(2);
    expect(await count("select count(*) n from users where deleted_at is null")).toBe(2);
  });

  it("silinmiş yöneticinin kendi işlem kaydı, hedefi aktifken anonim satırı tutar", async () => {
    const admin = await customer("admin@example.com");
    const target = await customer("hedef@example.com");
    await adjustBalance(
      db,
      admin,
      { userId: target, amountCents: 100, reason: "Destek talebi #2" },
      t0,
    );
    await deleteAccount(
      db,
      admin,
      { confirmEmail: "admin@example.com", password: "gizli-sifre-1" },
      null,
      t0,
    );
    await purgeExpired(db, years(11), 10);
    // Hedef aktif olduğu için denetim kaydı kalır; o kayıt yöneticinin anonim satırına bağlı.
    expect(await count("select count(*) n from admin_actions")).toBe(1);
    expect(await count("select count(*) n from users where id = ?", [admin])).toBe(1);
  });

  it("süresi dolmuş oturumlar silinir; temizleme kapalıyken mali kayıtlar kalır", async () => {
    const gone = await customer("silinen@example.com");
    const active = await customer("aktif@example.com");
    await createSession(db, active, t0);
    await deleteAccount(
      db,
      gone,
      { confirmEmail: "silinen@example.com", password: "gizli-sifre-1" },
      null,
      t0,
    );
    const report = await purgeExpired(db, years(20), null);
    expect(report.sessions).toBe(1);
    expect(report.records).toBe(0);
    expect(await count("select count(*) n from orders where user_id = ?", [gone])).toBe(1);
  });
});

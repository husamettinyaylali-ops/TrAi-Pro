// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { backupDatabase } from "@/server/backup.server";
import { createDb, openDb } from "@/server/db.server";
import { registerUser } from "@/server/services.server";

const dir = mkdtempSync(join(tmpdir(), "trai-backup-"));
const url = (path: string) => `file:${path.replace(/\\/g, "/")}`;

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

describe("veritabanı yedeği", () => {
  it("tutarlı kopya alır; aynı günün yedeğinin üzerine yazar, en yeni 3 yedeği tutar", async () => {
    const db = await openDb(url(join(dir, `${randomUUID()}.db`)));
    const backups = join(dir, "backups");
    await registerUser(
      db,
      { name: "Ayşe", email: "ayse@example.com", password: "gizli-sifre-1" },
      new Date("2026-10-16T09:00:00Z"),
    );

    const first = await backupDatabase(db, backups, new Date("2026-10-16T03:00:00Z"), 3);
    expect(first.endsWith("trai-pro-2026-10-16.db")).toBe(true);
    // Aynı gün tekrar: hata vermez, üzerine yazar.
    await backupDatabase(db, backups, new Date("2026-10-16T15:00:00Z"), 3);
    let last = first;
    for (const day of ["17", "18", "19"]) {
      last = await backupDatabase(db, backups, new Date(`2026-10-${day}T03:00:00Z`), 3);
    }
    expect(readdirSync(backups).sort()).toEqual([
      "trai-pro-2026-10-17.db",
      "trai-pro-2026-10-18.db",
      "trai-pro-2026-10-19.db",
    ]);
    db.$client.close();

    const copy = createDb(url(last));
    const rows = await copy.$client.execute("select count(*) n from users");
    expect(Number(rows.rows[0]!["n"])).toBe(1);
    copy.$client.close();
  });
});

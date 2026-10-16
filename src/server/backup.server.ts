import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { clock } from "@/lib/clock";

import { getDb, type Db } from "./db.server";
import { env, isProduction } from "./env.server";

const DAY = 24 * 60 * 60_000;
const NAME_RE = /^trai-pro-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * Veritabanının tutarlı bir kopyasını alır (`VACUUM INTO`; çalışan uygulama
 * yazarken de güvenlidir). Dosya adı günlüktür; aynı gün tekrar alınırsa
 * üzerine yazılır. En yeni `keep` yedek dışındakiler silinir.
 */
export async function backupDatabase(db: Db, dir: string, now: Date, keep = 7): Promise<string> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, `trai-pro-${now.toISOString().slice(0, 10)}.db`);
  await rm(target, { force: true });
  await db.$client.execute({ sql: "VACUUM INTO ?", args: [target] });

  const old = (await readdir(dir))
    .filter((f) => NAME_RE.test(f))
    .sort()
    .reverse()
    .slice(keep);
  await Promise.all(old.map((f) => rm(join(dir, f), { force: true })));
  return target;
}

let started = false;

/**
 * Yayında BACKUP_DIR verilmişse açılıştan bir dakika sonra ve sonra her gün
 * yedek alır. Hata uygulamayı durdurmaz, loglanır.
 */
export function startBackups(): void {
  const dir = env("BACKUP_DIR");
  if (started || !dir || !isProduction()) return;
  started = true;
  const run = () =>
    getDb()
      .then((db) => backupDatabase(db, dir, clock()))
      .then((file) => console.info(`[yedek] veritabanı yedeklendi: ${file}`))
      .catch((err: unknown) =>
        console.error("[yedek] yedek alınamadı:", err instanceof Error ? err.message : err),
      );
  setTimeout(run, 60_000).unref();
  setInterval(run, DAY).unref();
}

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { env } from "./env.server";
import * as schema from "./schema.server";

export const DEFAULT_DATABASE_URL = "file:data/trai-pro.db";
export const MIGRATIONS_FOLDER = "drizzle";

export function createDb(url: string, authToken?: string) {
  const client = createClient(authToken ? { url, authToken } : { url });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

/** Bağlantı açar ve bekleyen migration'ları uygular. */
export async function openDb(url: string, authToken?: string): Promise<Db> {
  if (url.startsWith("file:")) {
    const path = url.startsWith("file://") ? fileURLToPath(url) : url.slice("file:".length);
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = createDb(url, authToken);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

let shared: Promise<Db> | null = null;

/** Süreç boyunca tek bağlantı. DATABASE_URL yoksa yerel SQLite dosyası kullanılır. */
export function getDb(): Promise<Db> {
  shared ??= openDb(env("DATABASE_URL") ?? DEFAULT_DATABASE_URL, env("DATABASE_AUTH_TOKEN")).catch(
    (err: unknown) => {
      shared = null;
      throw err;
    },
  );
  return shared;
}

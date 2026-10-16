import { and, eq } from "drizzle-orm";

import { clock } from "@/lib/clock";

import { fileStorage, type FileStorage } from "./file-storage.server";
import { parseCookies } from "./cookies.server";
import { getDb, type Db } from "./db.server";
import { generations } from "./schema.server";
import { getSessionUser } from "./services.server";
import { SESSION_COOKIE } from "./session.server";

export interface MediaDeps {
  db?: Db;
  storage?: FileStorage;
  now?: Date;
}

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
};

export type KeyOf = (row: {
  audioKey: string | null;
  files: string[] | null;
}) => string | null | undefined;

/**
 * Üretimin dosyasını yalnız sahibine sunar. Başkasının üretimi için de
 * "bulunamadı" döner; kaydın varlığı ele verilmez. `?download=1` ile dosya
 * olarak indirilir.
 */
async function serveOwned(
  request: Request,
  id: string,
  keyOf: KeyOf,
  deps: MediaDeps,
): Promise<Response> {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  const db = deps.db ?? (await getDb());
  const now = deps.now ?? clock();
  const user = token ? await getSessionUser(db, token, now) : null;
  if (!user) return new Response("Oturum gerekli", { status: 401 });
  const download = new URL(request.url).searchParams.has("download");
  return ownedFileResponse(db, deps.storage ?? fileStorage(), user.id, id, keyOf, download);
}

/** Kimliği doğrulanmış kullanıcının üretim dosyası (oturum ya da API anahtarı). */
export async function ownedFileResponse(
  db: Db,
  storage: FileStorage,
  userId: string,
  id: string,
  keyOf: KeyOf,
  download: boolean,
): Promise<Response> {
  const row = await db
    .select({ audioKey: generations.audioKey, files: generations.files })
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.userId, userId)))
    .get();
  const key = row ? keyOf(row) : null;
  if (!key) return new Response("Bulunamadı", { status: 404 });

  const data = await storage.read(key);
  if (!data) return new Response("Bulunamadı", { status: 404 });

  const ext = key.slice(key.lastIndexOf(".") + 1);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "content-length": String(data.byteLength),
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-disposition": download
        ? `attachment; filename="trai-pro-${id.slice(0, 8)}.${ext}"`
        : "inline",
    },
  });
}

/** GET /media/audio/:id — üretilen ses. */
export function serveAudio(request: Request, id: string, deps: MediaDeps = {}) {
  return serveOwned(request, id, (r) => r.audioKey, deps);
}

/** GET /media/file/:id/:index — üretilen görsel ya da video dosyası. */
export function serveFile(request: Request, id: string, index: string, deps: MediaDeps = {}) {
  const i = /^\d{1,2}$/.test(index) ? Number(index) : -1;
  return serveOwned(request, id, (r) => (i >= 0 ? r.files?.[i] : null), deps);
}

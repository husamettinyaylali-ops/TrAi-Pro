import { and, eq } from "drizzle-orm";

import { clock } from "@/lib/clock";

import { audioStorage, type AudioStorage } from "./audio-storage.server";
import { parseCookies } from "./cookies.server";
import { getDb, type Db } from "./db.server";
import { generations } from "./schema.server";
import { getSessionUser } from "./services.server";
import { SESSION_COOKIE } from "./session.server";

export interface MediaDeps {
  db?: Db;
  storage?: AudioStorage;
  now?: Date;
}

/**
 * GET /media/audio/:id — üretilen sesi yalnız sahibine sunar. Başkasının
 * üretimi için de "bulunamadı" döner; kaydın varlığı ele verilmez.
 * `?download=1` ile dosya olarak indirilir.
 */
export async function serveAudio(
  request: Request,
  id: string,
  deps: MediaDeps = {},
): Promise<Response> {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  const db = deps.db ?? (await getDb());
  const now = deps.now ?? clock();
  const user = token ? await getSessionUser(db, token, now) : null;
  if (!user) return new Response("Oturum gerekli", { status: 401 });

  const row = await db
    .select({ audioKey: generations.audioKey })
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.userId, user.id)))
    .get();
  if (!row?.audioKey) return new Response("Bulunamadı", { status: 404 });

  const data = await (deps.storage ?? audioStorage()).read(row.audioKey);
  if (!data) return new Response("Bulunamadı", { status: 404 });

  const download = new URL(request.url).searchParams.has("download");
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "audio/mpeg",
      "content-length": String(data.byteLength),
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-disposition": download
        ? `attachment; filename="trai-pro-${id.slice(0, 8)}.mp3"`
        : "inline",
    },
  });
}

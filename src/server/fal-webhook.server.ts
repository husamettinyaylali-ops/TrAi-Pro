import { clock } from "@/lib/clock";

import { getDb, type Db } from "./db.server";
import { fileStorage } from "./file-storage.server";
import { refreshVideoByRequest, type VideoDeps } from "./services.server";
import { videoProvider } from "./video.server";

const MAX_BODY = 1024 * 1024;
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export interface FalWebhookDeps {
  video: VideoDeps | null;
  db: () => Promise<Db>;
  now: () => Date;
}

function defaultDeps(): FalWebhookDeps {
  const video = videoProvider();
  return {
    video: video ? { video, storage: fileStorage(), webhookUrl: null } : null,
    db: getDb,
    now: clock,
  };
}

const text = (body: string, status: number) => new Response(body, { status });

/**
 * POST /webhooks/fal — fal.ai video işi bitince çağırır. Gövdeye güvenilmez:
 * yalnız hangi işin kontrol edileceğini söyler; sonuç kendi anahtarımızla
 * fal.ai'den okunur (refreshVideoByRequest). Bu yüzden imza doğrulaması
 * gerekmez; sahte bir istek en fazla bir durum sorgusu tetikler.
 */
export async function handleFalWebhook(
  request: Request,
  deps: FalWebhookDeps = defaultDeps(),
): Promise<Response> {
  if (!deps.video) return text("Not found", 404);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return text("Too large", 413);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) return text("Too large", 413);
  let requestId: unknown;
  try {
    requestId = (JSON.parse(raw) as { request_id?: unknown }).request_id;
  } catch {
    return text("Bad request", 400);
  }
  if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) {
    return text("Bad request", 400);
  }
  await refreshVideoByRequest(await deps.db(), deps.video, requestId, deps.now());
  return text("OK", 200);
}

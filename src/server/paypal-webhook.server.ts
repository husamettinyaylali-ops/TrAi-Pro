import { clock } from "@/lib/clock";

import { getDb, type Db } from "./db.server";
import {
  money,
  paypalConfig,
  sharedPaypal,
  type PaypalClient,
  type PaypalConfig,
} from "./paypal.server";
import { creditPaypalCapture } from "./services.server";

const MAX_BODY = 64 * 1024;

interface WebhookEvent {
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    custom_id?: string;
    amount?: { currency_code?: string; value?: string };
  };
}

export interface WebhookDeps {
  config: PaypalConfig | null;
  client: Pick<PaypalClient, "verifyWebhook"> | null;
  db: () => Promise<Db>;
  now: () => Date;
}

function defaultDeps(): WebhookDeps {
  const config = paypalConfig();
  return { config, client: config && sharedPaypal(config), db: getDb, now: clock };
}

const text = (body: string, status: number) => new Response(body, { status });

/**
 * PayPal webhook'u. Yalnız PAYMENT.CAPTURE.COMPLETED işlenir: incelemeye
 * düşüp sonradan tamamlanan ya da tarayıcı kapandığı için uygulamaya dönmeyen
 * tahsilatlar böylece bakiyeye yazılır. Bakiyeye yazma creditPaypalCapture ile
 * yapılır (tekrar gelen olay ikinci kez yazmaz). PAYPAL_WEBHOOK_ID yoksa kapalıdır.
 */
export async function handlePaypalWebhook(
  request: Request,
  deps: WebhookDeps = defaultDeps(),
): Promise<Response> {
  const { config, client } = deps;
  if (!config?.webhookId || !client) return text("Not found", 404);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return text("Too large", 413);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) return text("Too large", 413);

  let event: WebhookEvent;
  try {
    event = JSON.parse(raw) as WebhookEvent;
  } catch {
    return text("Bad request", 400);
  }

  try {
    if (!(await client.verifyWebhook(request.headers, event, config.webhookId))) {
      return text("Invalid signature", 400);
    }
  } catch (err) {
    // PayPal 2xx almazsa olayı yeniden gönderir.
    console.error(
      "[ödeme] PayPal webhook doğrulanamadı:",
      err instanceof Error ? err.message : err,
    );
    return text("Unavailable", 503);
  }

  const r = event.resource;
  if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED" || !r?.id || !r.status || !r.custom_id) {
    return text("OK", 200);
  }
  const res = await creditPaypalCapture(
    await deps.db(),
    r.custom_id,
    { id: r.id, status: r.status, amount: money(r.amount) },
    deps.now(),
  );
  if (!res.ok) console.warn(`[ödeme] PayPal tahsilatı ${r.custom_id} yazılamadı: ${res.error}`);
  return text("OK", 200);
}

import { env } from "./env.server";

export const PAYPAL_API = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

/** PayPal sipariş kimliği; yol parametresine yalnız bu biçim girer. */
export const ORDER_ID_RE = /^[A-Z0-9]{10,40}$/;

export interface PaypalMoney {
  currency: string;
  value: string;
}

export interface PaypalCapture {
  id: string;
  /** COMPLETED, PENDING, DECLINED, FAILED… */
  status: string;
  amount: PaypalMoney | null;
}

export interface PaypalOrder {
  id: string;
  /** CREATED, APPROVED, COMPLETED, VOIDED, PAYER_ACTION_REQUIRED… */
  status: string;
  /** Siparişi oluştururken verdiğimiz bakiye yükleme talebi kimliği. */
  customId: string | null;
  amount: PaypalMoney | null;
  capture: PaypalCapture | null;
}

/** PayPal'a erişim; testlerde sahte uygulama verilir. */
export interface PaypalClient {
  createOrder(input: { reference: string; value: string; description: string }): Promise<string>;
  getOrder(id: string): Promise<PaypalOrder | null>;
  /** Kart/PayPal hesabı reddederse "declined"; sipariş zaten tahsil edildiyse güncel hali. */
  captureOrder(id: string): Promise<PaypalOrder | "declined">;
  /** Webhook isteğinin PayPal'dan geldiğini PayPal'ın doğrulama API'siyle denetler. */
  verifyWebhook(headers: Headers, event: unknown, webhookId: string): Promise<boolean>;
}

interface RawMoney {
  currency_code?: string;
  value?: string;
}

interface RawOrder {
  id?: string;
  status?: string;
  purchase_units?: {
    custom_id?: string;
    amount?: RawMoney;
    payments?: { captures?: { id?: string; status?: string; amount?: RawMoney }[] };
  }[];
}

export const money = (m: RawMoney | undefined): PaypalMoney | null =>
  m?.currency_code && m.value ? { currency: m.currency_code, value: m.value } : null;

/** PayPal yanıtındaki ilk satın alma biriminden ihtiyaç duyulan alanlar. */
export function parseOrder(raw: RawOrder): PaypalOrder {
  const unit = raw.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    id: raw.id ?? "",
    status: raw.status ?? "",
    customId: unit?.custom_id ?? null,
    amount: money(unit?.amount),
    capture:
      capture?.id && capture.status
        ? { id: capture.id, status: capture.status, amount: money(capture.amount) }
        : null,
  };
}

export interface PaypalConfig {
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
  /** Webhook imza doğrulaması için (bkz. PayPal geliştirici paneli). */
  webhookId: string | null;
}

/**
 * PayPal Orders v2 istemcisi. Erişim anahtarı süresi dolana kadar saklanır;
 * PayPal hata gövdeleri loglanmaz, yalnız durum kodu ve sorun adı hataya yazılır.
 */
export function paypalClient(
  cfg: PaypalConfig,
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now,
): PaypalClient {
  const base = cfg.sandbox ? PAYPAL_API.sandbox : PAYPAL_API.live;
  let token: { value: string; until: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.until > nowMs()) return token.value;
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    const res = await fetchImpl(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`PayPal erişim anahtarı alınamadı (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("PayPal erişim anahtarı boş");
    // Süre bitmeden bir dakika önce yenilenir.
    token = {
      value: body.access_token,
      until: nowMs() + Math.max(0, (body.expires_in ?? 0) - 60) * 1000,
    };
    return token.value;
  }

  async function call(path: string, init: { method: string; body?: unknown; requestId?: string }) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await accessToken()}`,
      "content-type": "application/json",
    };
    if (init.requestId) headers["paypal-request-id"] = init.requestId;
    return fetchImpl(`${base}${path}`, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }

  async function issueOf(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { name?: string; details?: { issue?: string }[] };
      return body.details?.[0]?.issue ?? body.name ?? "";
    } catch {
      return "";
    }
  }

  async function getOrder(id: string): Promise<PaypalOrder | null> {
    const res = await call(`/v2/checkout/orders/${id}`, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`PayPal siparişi okunamadı (${res.status} ${await issueOf(res)})`);
    return parseOrder((await res.json()) as RawOrder);
  }

  return {
    async createOrder({ reference, value, description }) {
      const res = await call("/v2/checkout/orders", {
        method: "POST",
        body: {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: reference,
              custom_id: reference,
              description,
              amount: { currency_code: "USD", value },
            },
          ],
          application_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" },
        },
      });
      if (!res.ok)
        throw new Error(`PayPal siparişi oluşturulamadı (${res.status} ${await issueOf(res)})`);
      const body = (await res.json()) as { id?: string };
      if (!body.id || !ORDER_ID_RE.test(body.id))
        throw new Error("PayPal sipariş kimliği geçersiz");
      return body.id;
    },

    getOrder,

    async captureOrder(id) {
      const res = await call(`/v2/checkout/orders/${id}/capture`, {
        method: "POST",
        body: {},
        // Aynı siparişin tahsilatı tekrar gönderilirse PayPal ikinci kez tahsil etmez.
        requestId: `capture-${id}`,
      });
      if (res.ok) return parseOrder((await res.json()) as RawOrder);
      const issue = await issueOf(res);
      if (issue === "INSTRUMENT_DECLINED") return "declined";
      if (issue === "ORDER_ALREADY_CAPTURED") {
        const order = await getOrder(id);
        if (order) return order;
      }
      throw new Error(`PayPal tahsilatı başarısız (${res.status} ${issue})`);
    },

    async verifyWebhook(headers, event, webhookId) {
      const names = [
        "auth-algo",
        "cert-url",
        "transmission-id",
        "transmission-sig",
        "transmission-time",
      ];
      const values = names.map((n) => headers.get(`paypal-${n}`));
      if (values.some((v) => !v)) return false;
      const [authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime] = values;
      const res = await call("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        body: {
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: webhookId,
          webhook_event: event,
        },
      });
      if (!res.ok) throw new Error(`PayPal webhook doğrulanamadı (${res.status})`);
      const body = (await res.json()) as { verification_status?: string };
      return body.verification_status === "SUCCESS";
    },
  };
}

/** PAYPAL_CLIENT_ID ve PAYPAL_CLIENT_SECRET doluysa yöntem açıktır; PAYPAL_ENV=live değilse sandbox. */
export function paypalConfig(): PaypalConfig | null {
  const clientId = env("PAYPAL_CLIENT_ID");
  const clientSecret = env("PAYPAL_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    sandbox: env("PAYPAL_ENV") !== "live",
    webhookId: env("PAYPAL_WEBHOOK_ID") ?? null,
  };
}

let shared: { key: string; client: PaypalClient } | null = null;

/** Erişim anahtarını süreç boyunca paylaşan istemci. */
export function sharedPaypal(cfg: PaypalConfig): PaypalClient {
  const key = `${cfg.sandbox}|${cfg.clientId}`;
  if (shared?.key !== key) shared = { key, client: paypalClient(cfg) };
  return shared.client;
}

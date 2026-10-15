// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDb, type Db } from "@/server/db.server";
import {
  paypalClient,
  type PaypalClient,
  type PaypalConfig,
  type PaypalOrder,
} from "@/server/paypal.server";
import { handlePaypalWebhook } from "@/server/paypal-webhook.server";
import {
  capturePaypalTopUp,
  createTopUp,
  markEmailVerified,
  registerUser,
  startPaypalOrder,
  walletBalance,
} from "@/server/services.server";

const now = new Date("2026-10-15T09:00:00Z");
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const CFG: PaypalConfig = {
  clientId: "client",
  clientSecret: "secret",
  sandbox: true,
  webhookId: "WH-1",
};
const SANDBOX = "https://api-m.sandbox.paypal.com";
const ORDER = "5O190127TN364715T";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const rawOrder = (
  status: string,
  captureStatus?: string,
  value = "10.00",
  customId = "intent-1",
) => ({
  id: ORDER,
  status,
  purchase_units: [
    {
      custom_id: customId,
      amount: { currency_code: "USD", value },
      ...(captureStatus
        ? {
            payments: {
              captures: [
                { id: "CAP-1", status: captureStatus, amount: { currency_code: "USD", value } },
              ],
            },
          }
        : {}),
    },
  ],
});

describe("PayPal istemcisi", () => {
  function fakeFetch(routes: Record<string, () => Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const key = `${init.method} ${url.replace(SANDBOX, "")}`;
      const route = routes[key];
      if (!route) throw new Error(`beklenmeyen istek: ${key}`);
      return route();
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }
  const token = () => json({ access_token: "TOKEN", expires_in: 3600 });

  it("erişim anahtarını alır, süresi bitene kadar yeniden kullanır", async () => {
    let t = 0;
    const { impl, calls } = fakeFetch({
      "POST /v1/oauth2/token": token,
      [`GET /v2/checkout/orders/${ORDER}`]: () => json(rawOrder("APPROVED")),
    });
    const client = paypalClient(CFG, impl, () => t);
    await client.getOrder(ORDER);
    await client.getOrder(ORDER);
    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
    const auth = (calls[0]!.init.headers as Record<string, string>)["authorization"];
    expect(auth).toBe(`Basic ${Buffer.from("client:secret").toString("base64")}`);

    t = 3_600_000;
    await client.getOrder(ORDER);
    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(2);
  });

  it("sipariş talep kimliği ve USD tutarla açılır", async () => {
    const { impl, calls } = fakeFetch({
      "POST /v1/oauth2/token": token,
      "POST /v2/checkout/orders": () => json({ id: ORDER, status: "CREATED" }, 201),
    });
    const id = await paypalClient(CFG, impl).createOrder({
      reference: "intent-1",
      value: "10.00",
      description: "TrAi Pro bakiye yükleme",
    });
    expect(id).toBe(ORDER);
    const body = JSON.parse(String(calls[1]!.init.body));
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0]).toMatchObject({
      custom_id: "intent-1",
      amount: { currency_code: "USD", value: "10.00" },
    });
    expect((calls[1]!.init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer TOKEN",
    );
  });

  it("tahsilat: tamamlanan sipariş okunur; red ve zaten tahsil edilmiş durumları ayrılır", async () => {
    const capture = `POST /v2/checkout/orders/${ORDER}/capture`;
    const ok = fakeFetch({
      "POST /v1/oauth2/token": token,
      [capture]: () => json(rawOrder("COMPLETED", "COMPLETED"), 201),
    });
    expect(await paypalClient(CFG, ok.impl).captureOrder(ORDER)).toMatchObject({
      status: "COMPLETED",
      customId: "intent-1",
      capture: { id: "CAP-1", status: "COMPLETED", amount: { currency: "USD", value: "10.00" } },
    });
    expect((ok.calls[1]!.init.headers as Record<string, string>)["paypal-request-id"]).toBe(
      `capture-${ORDER}`,
    );

    const declined = fakeFetch({
      "POST /v1/oauth2/token": token,
      [capture]: () =>
        json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] }, 422),
    });
    expect(await paypalClient(CFG, declined.impl).captureOrder(ORDER)).toBe("declined");

    const already = fakeFetch({
      "POST /v1/oauth2/token": token,
      [capture]: () =>
        json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] }, 422),
      [`GET /v2/checkout/orders/${ORDER}`]: () => json(rawOrder("COMPLETED", "COMPLETED")),
    });
    expect(await paypalClient(CFG, already.impl).captureOrder(ORDER)).toMatchObject({
      status: "COMPLETED",
    });
  });

  it("bulunamayan sipariş null; webhook doğrulaması başlıkları gönderir", async () => {
    const { impl, calls } = fakeFetch({
      "POST /v1/oauth2/token": token,
      [`GET /v2/checkout/orders/${ORDER}`]: () => json({ name: "RESOURCE_NOT_FOUND" }, 404),
      "POST /v1/notifications/verify-webhook-signature": () =>
        json({ verification_status: "SUCCESS" }),
    });
    const client = paypalClient(CFG, impl);
    expect(await client.getOrder(ORDER)).toBeNull();

    const headers = new Headers({
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
      "paypal-transmission-id": "tid",
      "paypal-transmission-sig": "sig",
      "paypal-transmission-time": "2026-10-15T09:00:00Z",
    });
    expect(await client.verifyWebhook(headers, { id: "WH-EVENT" }, "WH-1")).toBe(true);
    const body = JSON.parse(String(calls.at(-1)!.init.body));
    expect(body).toMatchObject({ webhook_id: "WH-1", transmission_id: "tid" });
    expect(await client.verifyWebhook(new Headers(), {}, "WH-1")).toBe(false);
  });
});

describe("PayPal ile bakiye yükleme", () => {
  const dir = mkdtempSync(join(tmpdir(), "trai-paypal-"));
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

  async function newUser(email: string) {
    const res = await registerUser(db, { name: "K", email, password: "gizli-sifre-1" }, now);
    if (!res.ok) throw new Error(res.error);
    await markEmailVerified(db, res.userId, now);
    return res.userId;
  }

  async function paypalIntent(userId: string, cents = 1_000, at = now) {
    const res = await createTopUp(db, userId, { method: "paypal", amountCents: cents }, at);
    if (!res.ok) throw new Error(res.error);
    return res.intent;
  }

  /** Sipariş durumunu tutan sahte PayPal. */
  function fakePaypal(order: Partial<PaypalOrder> & { customId: string }, value = "10.00") {
    let state: PaypalOrder = {
      id: ORDER,
      status: "APPROVED",
      amount: { currency: "USD", value },
      capture: null,
      ...order,
    };
    const client = {
      createOrder: vi.fn(async () => ORDER),
      getOrder: vi.fn(async () => state),
      captureOrder: vi.fn(async (): Promise<PaypalOrder | "declined"> => {
        state = {
          ...state,
          status: "COMPLETED",
          capture: { id: "CAP-1", status: "COMPLETED", amount: { currency: "USD", value } },
        };
        return state;
      }),
      verifyWebhook: vi.fn(async () => true),
    } satisfies PaypalClient;
    return client;
  }

  it("sipariş yalnız kullanıcının geçerli PayPal talebi için açılır", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const intent = await paypalIntent(a);
    const paypal = fakePaypal({ customId: intent.id });

    expect(await startPaypalOrder(db, a, intent.id, paypal, now)).toEqual({
      ok: true,
      orderId: ORDER,
    });
    expect(paypal.createOrder).toHaveBeenCalledWith({
      reference: intent.id,
      value: "10.00",
      description: "TrAi Pro bakiye yükleme",
    });
    expect(await startPaypalOrder(db, b, intent.id, paypal, now)).toEqual({
      ok: false,
      error: "noPending",
    });
    expect(await startPaypalOrder(db, a, intent.id, paypal, later(61))).toEqual({
      ok: false,
      error: "noPending",
    });
  });

  it("onaylanan sipariş tahsil edilir ve bakiyeye yazılır; tekrar çağrı ikinci kez yazmaz", async () => {
    const id = await newUser("a@example.com");
    const intent = await paypalIntent(id);
    const paypal = fakePaypal({ customId: intent.id });

    const res = await capturePaypalTopUp(db, id, ORDER, paypal, later(2));
    expect(res.ok && res.intent).toMatchObject({ status: "completed", creditCents: 1_000 });
    expect(await walletBalance(db, id)).toBe(1_000);

    expect((await capturePaypalTopUp(db, id, ORDER, paypal, later(3))).ok).toBe(true);
    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(await walletBalance(db, id)).toBe(1_000);
  });

  it("başkasının siparişi, farklı tutar ya da süresi dolan talep tahsil edilmez", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const intent = await paypalIntent(a);

    const other = fakePaypal({ customId: intent.id });
    expect(await capturePaypalTopUp(db, b, ORDER, other, later(1))).toEqual({
      ok: false,
      error: "notFound",
    });

    const wrongAmount = fakePaypal({ customId: intent.id }, "1.00");
    expect(await capturePaypalTopUp(db, a, ORDER, wrongAmount, later(1))).toEqual({
      ok: false,
      error: "amountMismatch",
    });

    const late = fakePaypal({ customId: intent.id });
    expect(await capturePaypalTopUp(db, a, ORDER, late, later(61))).toEqual({
      ok: false,
      error: "noPending",
    });

    for (const p of [other, wrongAmount, late]) expect(p.captureOrder).not.toHaveBeenCalled();
    expect(await walletBalance(db, a)).toBe(0);
    expect(await capturePaypalTopUp(db, a, "../x", other, later(1))).toEqual({
      ok: false,
      error: "invalidInput",
    });
  });

  it("kart reddi declined, incelemedeki tahsilat unconfirmed döner; bakiye yazılmaz", async () => {
    const id = await newUser("a@example.com");
    const intent = await paypalIntent(id);

    const declined = fakePaypal({ customId: intent.id });
    declined.captureOrder.mockResolvedValueOnce("declined");
    expect(await capturePaypalTopUp(db, id, ORDER, declined, later(1))).toEqual({
      ok: false,
      error: "declined",
    });

    const pending = fakePaypal({
      customId: intent.id,
      status: "COMPLETED",
      capture: { id: "CAP-2", status: "PENDING", amount: { currency: "USD", value: "10.00" } },
    });
    expect(await capturePaypalTopUp(db, id, ORDER, pending, later(1))).toEqual({
      ok: false,
      error: "unconfirmed",
    });
    expect(await walletBalance(db, id)).toBe(0);
  });

  it("tahsil edilen ödeme, talep bu arada geçersiz kalsa da bakiyeye yazılır", async () => {
    const id = await newUser("a@example.com");
    const intent = await paypalIntent(id);
    // Kullanıcı başka sekmede yeni tutar istedi: eski talep "expired" oldu.
    await paypalIntent(id, 2_000, later(1));
    const paid = fakePaypal({
      customId: intent.id,
      status: "COMPLETED",
      capture: { id: "CAP-3", status: "COMPLETED", amount: { currency: "USD", value: "10.00" } },
    });
    expect((await capturePaypalTopUp(db, id, ORDER, paid, later(2))).ok).toBe(true);
    expect(await walletBalance(db, id)).toBe(1_000);
  });

  it("PayPal'a ulaşılamazsa providerFailed", async () => {
    const id = await newUser("a@example.com");
    const intent = await paypalIntent(id);
    const down = fakePaypal({ customId: intent.id });
    down.getOrder.mockRejectedValueOnce(new Error("ağ"));
    down.createOrder.mockRejectedValueOnce(new Error("ağ"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await capturePaypalTopUp(db, id, ORDER, down, later(1))).toEqual({
      ok: false,
      error: "providerFailed",
    });
    expect(await startPaypalOrder(db, id, intent.id, down, later(1))).toEqual({
      ok: false,
      error: "providerFailed",
    });
    spy.mockRestore();
  });

  describe("webhook", () => {
    const event = (customId: string, status = "COMPLETED", value = "10.00") => ({
      id: "WH-EVENT",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAP-9",
        status,
        custom_id: customId,
        amount: { currency_code: "USD", value },
      },
    });
    const post = (body: unknown) =>
      new Request("http://localhost/webhooks/paypal", {
        method: "POST",
        body: JSON.stringify(body),
      });
    const deps = (
      client: Pick<PaypalClient, "verifyWebhook">,
      config: PaypalConfig | null = CFG,
    ) => ({
      config,
      client,
      db: async () => db,
      now: () => later(30),
    });

    it("doğrulanmış tamamlanma olayı bakiyeye yazar; tekrar gelirse ikinci kez yazmaz", async () => {
      const id = await newUser("a@example.com");
      const intent = await paypalIntent(id);
      const client = { verifyWebhook: vi.fn(async () => true) };

      expect((await handlePaypalWebhook(post(event(intent.id)), deps(client))).status).toBe(200);
      expect((await handlePaypalWebhook(post(event(intent.id)), deps(client))).status).toBe(200);
      expect(await walletBalance(db, id)).toBe(1_000);
    });

    it("imza tutmazsa, webhook kimliği yoksa ya da tutar farklıysa yazılmaz", async () => {
      const id = await newUser("a@example.com");
      const intent = await paypalIntent(id);
      const bad = { verifyWebhook: vi.fn(async () => false) };
      expect((await handlePaypalWebhook(post(event(intent.id)), deps(bad))).status).toBe(400);

      const good = { verifyWebhook: vi.fn(async () => true) };
      const off = { ...CFG, webhookId: null };
      expect((await handlePaypalWebhook(post(event(intent.id)), deps(good, off))).status).toBe(404);

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(
        (await handlePaypalWebhook(post(event(intent.id, "COMPLETED", "99.00")), deps(good)))
          .status,
      ).toBe(200);
      spy.mockRestore();
      warn.mockRestore();
      expect(await walletBalance(db, id)).toBe(0);
    });

    it("doğrulama servisi yanıt vermezse 503 (PayPal yeniden gönderir)", async () => {
      const down = { verifyWebhook: vi.fn(async () => Promise.reject(new Error("ağ"))) };
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await handlePaypalWebhook(post(event("x")), deps(down))).status).toBe(503);
      spy.mockRestore();
    });
  });
});

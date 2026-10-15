// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  binancePayClient,
  cachedFetcher,
  incomingUsdt,
  signQuery,
  type BinanceIncome,
  type IncomingFetcher,
} from "@/server/binance.server";
import { openDb, type Db } from "@/server/db.server";
import {
  claimBinanceTopUp,
  createTopUp,
  markEmailVerified,
  registerUser,
  walletBalance,
} from "@/server/services.server";

const now = new Date("2026-10-15T09:00:00Z");
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const CFG = {
  binanceId: "123456789",
  apiKey: "test-key",
  apiSecret: "test-secret",
  baseUrl: "https://binance.test",
};

const c2c = (id: string, amount: string, at: Date, currency = "USDT") => ({
  orderType: "C2C",
  transactionId: id,
  transactionTime: at.getTime(),
  amount,
  currency,
});

describe("Binance Pay geçmişi", () => {
  it("imza, Binance belgelerindeki örnekle aynı", () => {
    expect(
      signQuery(
        "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559",
        "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j",
      ),
    ).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });

  it("yalnız hesaba gelen C2C USDT ödemeleri alınır", () => {
    expect(
      incomingUsdt([
        c2c("a", "10.37000000", now),
        c2c("b", "-5.00000000", now),
        c2c("c", "10.37000000", now, "USDC"),
        { ...c2c("d", "10.37000000", now), orderType: "PAY_REFUND" },
        { orderType: "C2C", amount: "10.37" },
      ]).map((i) => i.transactionId),
    ).toEqual(["a"]);
  });

  it("imzalı istek atar, anahtarı başlıkta gönderir ve listeyi süzer", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "000000",
            message: "success",
            success: true,
            data: [c2c("M_1", "10.37000000", now), c2c("M_2", "-1", now)],
          }),
        ),
    );
    const list = await binancePayClient(CFG, fetchImpl as unknown as typeof fetch)(later(-65), now);
    expect(list).toEqual([
      { transactionId: "M_1", time: now.getTime(), amount: "10.37000000", currency: "USDT" },
    ]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://binance.test/sapi/v1/pay/transactions");
    expect(u.searchParams.get("startTime")).toBe(String(later(-65).getTime()));
    expect(u.searchParams.get("timestamp")).toBe(String(now.getTime()));
    const signature = u.searchParams.get("signature");
    u.searchParams.delete("signature");
    expect(signature).toBe(signQuery(u.searchParams.toString(), CFG.apiSecret));
    expect(init.headers).toEqual({ "X-MBX-APIKEY": "test-key" });
  });

  it("HTTP ya da Binance hatasında hata fırlatır", async () => {
    const failing = (body: unknown, status = 200) =>
      binancePayClient(
        CFG,
        (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch,
      );
    await expect(failing({ code: -2015, msg: "Invalid API-key" }, 401)(now, now)).rejects.toThrow(
      "401",
    );
    await expect(failing({ code: "-1022", message: "Signature" })(now, now)).rejects.toThrow(
      "-1022",
    );
  });

  it("önbellek: süre içinde ve aynı ya da daha dar aralıkta yeniden sorgulamaz; hata saklanmaz", async () => {
    const inner = vi.fn<IncomingFetcher>(async () => []);
    const cached = cachedFetcher(inner, 20_000);
    await cached(later(-65), now);
    await cached(later(-60), new Date(now.getTime() + 19_000));
    expect(inner).toHaveBeenCalledTimes(1);
    await cached(later(-70), now);
    expect(inner).toHaveBeenCalledTimes(2);
    await cached(later(-65), new Date(now.getTime() + 21_000));
    expect(inner).toHaveBeenCalledTimes(3);

    const flaky = vi
      .fn<IncomingFetcher>()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValue([]);
    const c2 = cachedFetcher(flaky, 20_000);
    await expect(c2(now, now)).rejects.toThrow("x");
    await expect(c2(now, now)).resolves.toEqual([]);
  });
});

describe("Binance Pay ile bakiye yükleme", () => {
  const dir = mkdtempSync(join(tmpdir(), "trai-binance-"));
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

  /** uniqueCryptoAmount'ın 2 ondalıkta 1 + floor(r × 99) ekini istenen değere getiren r. */
  const extra = (n: number) => (n - 0.5) / 99;

  async function intent(userId: string, cents: number, r: number, at = now) {
    const res = await createTopUp(
      db,
      userId,
      { method: "binance_pay", amountCents: cents },
      at,
      () => r,
    );
    if (!res.ok) throw new Error(res.error);
    return res.intent;
  }

  const feed =
    (...list: BinanceIncome[]): IncomingFetcher =>
    async () =>
      list;
  const income = (id: string, amount: string, at: Date): BinanceIncome => ({
    transactionId: id,
    time: at.getTime(),
    amount,
    currency: "USDT",
  });

  it("benzersiz tutar eşleşirse ödenen tutar bakiyeye yazılır; aynı ödeme ikinci kez kullanılamaz", async () => {
    const id = await newUser("a@example.com");
    const it1 = await intent(id, 1_000, extra(37));
    expect(it1.payAmount).toBe("10.37");
    const incoming = feed(income("M_1", "10.37000000", later(2)));

    const res = await claimBinanceTopUp(db, id, incoming, later(3));
    expect(res.ok && res.intent).toMatchObject({ status: "completed", creditCents: 1_037 });
    expect(await walletBalance(db, id)).toBe(1_037);

    await intent(id, 1_000, extra(37), later(4));
    expect(await claimBinanceTopUp(db, id, incoming, later(5))).toEqual({
      ok: false,
      error: "duplicateRef",
    });
    expect(await walletBalance(db, id)).toBe(1_037);
  });

  it("başka kullanıcının tutarındaki ödeme bu kullanıcıya yazılmaz", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    await intent(a, 1_000, extra(37));
    await intent(b, 1_000, extra(50));
    const incoming = feed(income("M_1", "10.37", later(1)));

    expect(await claimBinanceTopUp(db, b, incoming, later(2))).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await walletBalance(db, b)).toBe(0);
    expect((await claimBinanceTopUp(db, a, incoming, later(2))).ok).toBe(true);
  });

  it("talepten önce yapılmış ödeme, farklı tutar ve bekleyen talep yokluğu", async () => {
    const id = await newUser("a@example.com");
    expect(await claimBinanceTopUp(db, id, feed(), now)).toEqual({ ok: false, error: "noPending" });

    await intent(id, 1_000, extra(37));
    const early = feed(income("M_0", "10.37", later(-6)), income("M_2", "10.36", later(1)));
    expect(await claimBinanceTopUp(db, id, early, later(2))).toEqual({
      ok: false,
      error: "notFound",
    });
    // 3 ondalıklı tutar 2 ondalığa indirgenemez, eşleşmez.
    expect(
      await claimBinanceTopUp(db, id, feed(income("M_3", "10.371", later(1))), later(2)),
    ).toEqual({ ok: false, error: "notFound" });
    expect(await walletBalance(db, id)).toBe(0);
  });

  it("Binance'e ulaşılamazsa providerFailed; kredi yazılmaz", async () => {
    const id = await newUser("a@example.com");
    await intent(id, 1_000, extra(37));
    const down: IncomingFetcher = async () => {
      throw new Error("ağ hatası");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await claimBinanceTopUp(db, id, down, later(1))).toEqual({
      ok: false,
      error: "providerFailed",
    });
    spy.mockRestore();
    expect(await walletBalance(db, id)).toBe(0);
  });

  it("sorgu tüm kullanıcılar için aynı sabit pencereyle yapılır (önbellek paylaşılır)", async () => {
    const id = await newUser("a@example.com");
    await intent(id, 1_000, extra(37));
    const spy = vi.fn<IncomingFetcher>(async () => []);
    await claimBinanceTopUp(db, id, spy, later(10));
    expect(spy).toHaveBeenCalledWith(later(10 - 65), later(10));
  });
});

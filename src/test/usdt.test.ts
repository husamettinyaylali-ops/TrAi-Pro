// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  TRANSFER_TOPIC,
  USDT_BEP20_CONTRACT,
  checkUsdtTransfer,
  rpcClient,
  type BscClient,
} from "@/server/bsc.server";
import { openDb, type Db } from "@/server/db.server";
import {
  claimUsdtTopUp,
  createTopUp,
  markEmailVerified,
  registerUser,
  walletBalance,
} from "@/server/services.server";

const now = new Date("2026-10-15T09:00:00Z");
const nowSec = Math.floor(now.getTime() / 1000);
const RECEIVER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const SENDER = "0x3333333333333333333333333333333333333333";
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const pad = (addr: string) => `0x${"0".repeat(24)}${addr.slice(2)}`;
const wei = (amount: string) => {
  const [w, f = ""] = amount.split(".");
  return `0x${(BigInt(w!) * 10n ** 18n + BigInt(f.padEnd(18, "0"))).toString(16)}`;
};

function transferLog(amount: string, to = RECEIVER, contract = USDT_BEP20_CONTRACT) {
  return { address: contract, topics: [TRANSFER_TOPIC, pad(SENDER), pad(to)], data: wei(amount) };
}

/** Sahte zincir: işlem makbuzları, son blok ve blok zamanları. */
function fakeChain(
  receipts: Record<
    string,
    { status?: string; block?: number; logs: ReturnType<typeof transferLog>[] }
  >,
  opts: { head?: number; time?: number } = {},
): BscClient {
  return {
    async receipt(h) {
      const r = receipts[h];
      return r
        ? {
            status: r.status ?? "0x1",
            blockNumber: `0x${(r.block ?? 100).toString(16)}`,
            logs: r.logs,
          }
        : null;
    },
    async blockNumber() {
      return opts.head ?? 200;
    },
    async blockTime() {
      return opts.time ?? nowSec + 60;
    },
  };
}

describe("USDT transfer doğrulaması", () => {
  it("alıcıya yapılan USDT transferi tutarıyla doğrulanır", async () => {
    const chain = fakeChain({ [hash(1)]: { logs: [transferLog("10.0347")] } });
    expect(await checkUsdtTransfer(chain, hash(1), RECEIVER, 12)).toEqual({
      ok: true,
      amount: "10.0347",
      blockTime: nowSec + 60,
    });
  });

  it("başka sözleşme ya da başka alıcı transfer sayılmaz", async () => {
    const chain = fakeChain({
      [hash(1)]: { logs: [transferLog("10.0347", RECEIVER, OTHER)] },
      [hash(2)]: { logs: [transferLog("10.0347", OTHER)] },
    });
    expect(await checkUsdtTransfer(chain, hash(1), RECEIVER, 12)).toEqual({
      ok: false,
      error: "noTransfer",
    });
    expect(await checkUsdtTransfer(chain, hash(2), RECEIVER, 12)).toEqual({
      ok: false,
      error: "noTransfer",
    });
  });

  it("bulunamayan, başarısız ve yeterince onaylanmamış işlem reddedilir", async () => {
    const chain = fakeChain(
      {
        [hash(1)]: { status: "0x0", logs: [transferLog("10.0347")] },
        [hash(2)]: { block: 195, logs: [transferLog("10.0347")] },
      },
      { head: 200 },
    );
    expect(await checkUsdtTransfer(chain, hash(9), RECEIVER, 12)).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await checkUsdtTransfer(chain, hash(1), RECEIVER, 12)).toEqual({
      ok: false,
      error: "failed",
    });
    expect(await checkUsdtTransfer(chain, hash(2), RECEIVER, 12)).toEqual({
      ok: false,
      error: "unconfirmed",
    });
  });

  it("4 ondalıktan hassas tutar eşleşmeye uygun değildir", async () => {
    const log = {
      ...transferLog("10.0347"),
      data: `0x${10_034_700_000_000_000_001n.toString(16)}`,
    };
    const chain = fakeChain({ [hash(1)]: { logs: [log] } });
    expect(await checkUsdtTransfer(chain, hash(1), RECEIVER, 12)).toEqual({
      ok: false,
      error: "oddAmount",
    });
  });

  it("JSON-RPC istemcisi doğru yöntemleri çağırır, hata yanıtını istisnaya çevirir", async () => {
    const calls: string[] = [];
    const f = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { method: string };
      calls.push(body.method);
      if (body.method === "eth_blockNumber")
        return new Response(JSON.stringify({ result: "0x10" }));
      return new Response(JSON.stringify({ error: { message: "limit" } }));
    }) as typeof fetch;
    const client = rpcClient("https://rpc.example", f);
    expect(await client.blockNumber()).toBe(16);
    await expect(client.receipt(hash(1))).rejects.toThrow("eth_getTransactionReceipt: limit");
    expect(calls).toEqual(["eth_blockNumber", "eth_getTransactionReceipt"]);
  });
});

describe("USDT ödemesiyle bakiye yükleme", () => {
  const dir = mkdtempSync(join(tmpdir(), "trai-usdt-"));
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

  async function intent(userId: string, cents: number, r: number) {
    const res = await createTopUp(
      db,
      userId,
      { method: "usdt_bep20", amountCents: cents },
      now,
      () => r,
    );
    if (!res.ok) throw new Error(res.error);
    return res.intent;
  }

  /** uniqueCryptoAmount'ın 1 + floor(r × 999) ekini istenen değere getiren r. */
  const extra = (n: number) => (n - 0.5) / 999;

  const checker = (chain: BscClient) => (h: string) => checkUsdtTransfer(chain, h, RECEIVER, 12);

  it("benzersiz tutar eşleşirse bakiye yüklenir; aynı işlem ikinci kez kullanılamaz", async () => {
    const id = await newUser("a@example.com");
    const it1 = await intent(id, 1_000, extra(347));
    expect(it1.payAmount).toBe("10.0347");
    const chain = fakeChain({ [hash(1)]: { logs: [transferLog("10.0347")] } });

    const res = await claimUsdtTopUp(
      db,
      id,
      ` ${hash(1).toUpperCase().replace("0X", "0x")} `,
      checker(chain),
      now,
    );
    expect(res.ok && res.intent.status).toBe("completed");
    expect(await walletBalance(db, id)).toBe(1_000);

    await intent(id, 1_000, extra(347));
    expect(await claimUsdtTopUp(db, id, hash(1), checker(chain), now)).toEqual({
      ok: false,
      error: "duplicateRef",
    });
    expect(await walletBalance(db, id)).toBe(1_000);
  });

  it("başkasının işlemini sahiplenmeye çalışan kullanıcı reddedilir", async () => {
    const victim = await newUser("kurban@example.com");
    const attacker = await newUser("saldirgan@example.com");
    await intent(victim, 1_000, extra(347));
    await intent(attacker, 1_000, 0.5);
    const chain = fakeChain({ [hash(1)]: { logs: [transferLog("10.0347")] } });

    expect(await claimUsdtTopUp(db, attacker, hash(1), checker(chain), now)).toEqual({
      ok: false,
      error: "amountMismatch",
    });
    expect(await walletBalance(db, attacker)).toBe(0);
    expect((await claimUsdtTopUp(db, victim, hash(1), checker(chain), now)).ok).toBe(true);
    expect(await walletBalance(db, victim)).toBe(1_000);
  });

  it("bekleyen talep yoksa, tutar tutmazsa ya da işlem talepten önceyse yüklenmez", async () => {
    const id = await newUser("a@example.com");
    const chain = fakeChain({ [hash(1)]: { logs: [transferLog("10.0000")] } });
    expect(await claimUsdtTopUp(db, id, hash(1), checker(chain), now)).toEqual({
      ok: false,
      error: "noPending",
    });

    await intent(id, 1_000, extra(347));
    expect(await claimUsdtTopUp(db, id, hash(1), checker(chain), now)).toEqual({
      ok: false,
      error: "amountMismatch",
    });

    const old = fakeChain(
      { [hash(2)]: { logs: [transferLog("10.0347")] } },
      { time: nowSec - 3600 },
    );
    expect(await claimUsdtTopUp(db, id, hash(2), checker(old), now)).toEqual({
      ok: false,
      error: "tooOld",
    });
    expect(await walletBalance(db, id)).toBe(0);
  });

  it("geçersiz işlem kimliği ve zincire ulaşılamaması", async () => {
    const id = await newUser("a@example.com");
    await intent(id, 1_000, extra(347));
    expect(await claimUsdtTopUp(db, id, "0x123", checker(fakeChain({})), now)).toEqual({
      ok: false,
      error: "invalidInput",
    });
    const down = async () => {
      throw new Error("RPC kapalı");
    };
    expect(await claimUsdtTopUp(db, id, hash(1), down, now)).toEqual({
      ok: false,
      error: "providerFailed",
    });
  });

  it("saatte en fazla 20 doğrulama denemesi", async () => {
    const id = await newUser("a@example.com");
    await intent(id, 1_000, extra(347));
    const chain = fakeChain({});
    for (let i = 0; i < 20; i++) await claimUsdtTopUp(db, id, hash(i + 1), checker(chain), now);
    const res = await claimUsdtTopUp(db, id, hash(99), checker(chain), now);
    expect(res.ok === false && res.error).toBe("tooManyAttempts");
  });
});

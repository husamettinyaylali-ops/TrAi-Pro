// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { balance } from "@/lib/credits";
import { openDb, type Db } from "@/server/db.server";
import {
  completeTopUp,
  createTopUp,
  demoTopUp,
  loadUserData,
  markEmailVerified,
  purchasePackage,
  registerUser,
  walletBalance,
} from "@/server/services.server";

const now = new Date("2026-10-15T09:00:00Z");
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const dir = mkdtempSync(join(tmpdir(), "trai-wallet-"));
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

async function newUser(email = "ayse@example.com") {
  const res = await registerUser(db, { name: "Ayşe", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, now);
  return res.userId;
}

describe("bakiye yükleme talebi", () => {
  it("en az $5, en çok $1000, tam sent", async () => {
    const id = await newUser();
    for (const amountCents of [499, 100_001, 550.5]) {
      expect(await createTopUp(db, id, { method: "usdt_bep20", amountCents }, now)).toEqual({
        ok: false,
        error: "invalidInput",
      });
    }
    expect((await createTopUp(db, id, { method: "usdt_bep20", amountCents: 500 }, now)).ok).toBe(
      true,
    );
  });

  it("kripto talebe benzersiz 4 ondalıklı tutar, PayPal'a USD tutar atanır", async () => {
    const id = await newUser();
    const usdt = await createTopUp(
      db,
      id,
      { method: "usdt_bep20", amountCents: 1_000 },
      now,
      () => 0.5,
    );
    expect(usdt.ok && usdt.intent).toMatchObject({
      payAmount: "10.0500",
      payCurrency: "USDT",
      status: "pending",
    });
    const paypal = await createTopUp(db, id, { method: "paypal", amountCents: 1_000 }, now);
    expect(paypal.ok && paypal.intent).toMatchObject({
      payAmount: "10.00",
      payCurrency: "USD",
      creditCents: 1_000,
    });
  });

  it("Binance Pay talebine 2 ondalıklı benzersiz tutar atanır; ödenen tutar bakiyeye yazılır", async () => {
    const id = await newUser();
    const t = await createTopUp(
      db,
      id,
      { method: "binance_pay", amountCents: 1_000 },
      now,
      () => 0.5,
    );
    if (!t.ok) throw new Error(t.error);
    expect(t.intent).toMatchObject({ payAmount: "10.50", payCurrency: "USDT", creditCents: 1_050 });
    expect((await completeTopUp(db, t.intent.id, "binance:1", now)).ok).toBe(true);
    expect(await walletBalance(db, id)).toBe(1_050);
  });

  it("aynı yöntemde bekleyen iki talep aynı tutarı alamaz", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const first = await createTopUp(
      db,
      a,
      { method: "usdt_bep20", amountCents: 1_000 },
      now,
      () => 0.5,
    );
    const seq = [0.5, 0.25];
    let i = 0;
    const second = await createTopUp(
      db,
      b,
      { method: "usdt_bep20", amountCents: 1_000 },
      now,
      () => seq[i++]!,
    );
    expect(first.ok && first.intent.payAmount).toBe("10.0500");
    expect(second.ok && second.intent.payAmount).toBe("10.0250");
  });

  it("bırakılan ya da süresi az önce dolan tutar başkasına hemen verilmez", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const topUpAt = (user: string, at: Date, ...seq: number[]) => {
      let i = 0;
      return createTopUp(
        db,
        user,
        { method: "binance_pay", amountCents: 1_000 },
        at,
        () => seq[i++]!,
      );
    };
    expect(await topUpAt(a, now, 0.5)).toMatchObject({ intent: { payAmount: "10.50" } });
    // a yeni tutar istedi; eski 10.50'ye ödeme hâlâ gelebilir.
    await createTopUp(db, a, { method: "binance_pay", amountCents: 2_000 }, now, () => 0.5);
    expect(await topUpAt(b, now, 0.5, 0.25)).toMatchObject({ intent: { payAmount: "10.25" } });
    // Süre dolalı 4 dakika: hâlâ ayrılmış; 6 dakika: yeniden kullanılabilir.
    expect(await topUpAt(b, later(64), 0.5, 0.75)).toMatchObject({
      intent: { payAmount: "10.75" },
    });
    expect(await topUpAt(b, later(66), 0.5)).toMatchObject({ intent: { payAmount: "10.50" } });
  });

  it("kullanıcı saatte en fazla 20 talep açar (benzersiz tutar yuvaları doldurulamaz)", async () => {
    const id = await newUser();
    for (let i = 0; i < 20; i++) {
      expect(
        (await createTopUp(db, id, { method: "binance_pay", amountCents: 1_000 }, now)).ok,
      ).toBe(true);
    }
    expect(
      await createTopUp(db, id, { method: "binance_pay", amountCents: 1_000 }, now),
    ).toMatchObject({ ok: false, error: "tooManyAttempts" });
    expect(
      (await createTopUp(db, id, { method: "binance_pay", amountCents: 1_000 }, later(61))).ok,
    ).toBe(true);
  });

  it("yeni talep aynı yöntemdeki eski bekleyen talebi geçersiz kılar; süre 1 saat", async () => {
    const id = await newUser();
    const old = await createTopUp(db, id, { method: "usdt_bep20", amountCents: 1_000 }, now);
    await createTopUp(db, id, { method: "usdt_bep20", amountCents: 2_000 }, now);
    if (!old.ok) throw new Error(old.error);
    expect(await completeTopUp(db, old.intent.id, "0xabc", now)).toEqual({
      ok: false,
      error: "notPending",
    });

    const data = await loadUserData(db, id, now);
    expect(data.wallet.pending).toHaveLength(1);
    expect((await loadUserData(db, id, later(61))).wallet.pending).toHaveLength(0);
  });
});

describe("talebin tamamlanması", () => {
  it("ödenen tutarı (sente aşağı) bakiyeye yazar; aynı işlemle tekrar gelirse ikinci kez yazmaz", async () => {
    const id = await newUser();
    const t = await createTopUp(
      db,
      id,
      { method: "usdt_bep20", amountCents: 1_000 },
      now,
      () => 0.5,
    );
    if (!t.ok) throw new Error(t.error);
    expect(t.intent).toMatchObject({ payAmount: "10.0500", creditCents: 1_005 });
    expect((await completeTopUp(db, t.intent.id, "0xtx1", now)).ok).toBe(true);
    expect((await completeTopUp(db, t.intent.id, "0xtx1", now)).ok).toBe(true);
    expect(await walletBalance(db, id)).toBe(1_005);
  });

  it("aynı işlem kimliği başka talebe yazılamaz", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const ta = await createTopUp(db, a, { method: "usdt_bep20", amountCents: 1_000 }, now);
    const tb = await createTopUp(db, b, { method: "usdt_bep20", amountCents: 1_000 }, now);
    if (!ta.ok || !tb.ok) throw new Error("talep");
    await completeTopUp(db, ta.intent.id, "0xtx1", now);
    expect(await completeTopUp(db, tb.intent.id, "0xtx1", now)).toEqual({
      ok: false,
      error: "duplicateRef",
    });
    expect(await walletBalance(db, b)).toBe(0);
  });

  it("süresi dolmuş talep tamamlanamaz", async () => {
    const id = await newUser();
    const t = await createTopUp(db, id, { method: "usdt_bep20", amountCents: 1_000 }, now);
    if (!t.ok) throw new Error(t.error);
    await createTopUp(db, id, { method: "binance_pay", amountCents: 500 }, later(61));
    expect(await completeTopUp(db, t.intent.id, "0xtx1", later(61))).toEqual({
      ok: false,
      error: "notPending",
    });
  });
});

describe("bakiyeden paket alımı", () => {
  it("bakiye yetmezse alınmaz, kredi ve sipariş oluşmaz", async () => {
    const id = await newUser();
    await demoTopUp(db, id, 500, now);
    expect(await purchasePackage(db, id, { packageId: "voice-1m" }, now)).toEqual({
      ok: false,
      error: "insufficientBalance",
    });
    const data = await loadUserData(db, id, now);
    expect(data.orders).toHaveLength(0);
    expect(data.wallet.balanceCents).toBe(500);
  });

  it("alımda bakiye düşer, defterde eksi kayıt, sipariş ve kredi oluşur", async () => {
    const id = await newUser();
    await demoTopUp(db, id, 2_500, now);
    const res = await purchasePackage(db, id, { packageId: "voice-1m" }, now);
    if (!res.ok) throw new Error(res.error);
    expect(res.order).toMatchObject({ method: "balance", amountUsd: 22 });

    const data = await loadUserData(db, id, now);
    expect(data.wallet.balanceCents).toBe(300);
    expect(data.wallet.entries.map((e) => e.amountCents).sort((x, y) => x - y)).toEqual([
      -2_200, 2_500,
    ]);
    expect(data.wallet.entries.find((e) => e.kind === "purchase")?.reference).toBe(res.order.id);
    expect(balance(data.grants, "voice", now)).toBe(1_005_000);
  });
});

// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  adjustBalance,
  adminEmails,
  completeIntentManually,
  normalizeProviderRef,
  searchIntents,
  adminOverview,
  isAdmin,
  recentActions,
  searchUsers,
  userDetail,
} from "@/server/admin.server";
import { openDb, type Db } from "@/server/db.server";
import {
  claimUsdtTopUp,
  completeTopUp,
  createTopUp,
  deleteAccount,
  demoTopUp,
  markEmailVerified,
  registerUser,
  walletBalance,
} from "@/server/services.server";

const now = new Date("2026-10-16T09:00:00Z");
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const dir = mkdtempSync(join(tmpdir(), "trai-admin-"));
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

async function newUser(email: string, { verified = true, name = "Ayşe" } = {}) {
  const res = await registerUser(db, { name, email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  if (verified) await markEmailVerified(db, res.userId, now);
  return res.userId;
}

describe("yönetici yetkisi", () => {
  it("liste boşlukları ve büyük harfi yok sayar, geçersiz girdileri atar", () => {
    expect([...adminEmails(" Yonetici@Example.com , ,x")]).toEqual(["yonetici@example.com"]);
    expect(adminEmails(undefined).size).toBe(0);
  });

  it("yalnız listede olan, e-postası doğrulanmış ve silinmemiş kullanıcı yöneticidir", async () => {
    const admins = adminEmails("admin@example.com,bekleyen@example.com");
    const admin = await newUser("admin@example.com");
    const unverified = await newUser("bekleyen@example.com", { verified: false });
    const other = await newUser("diger@example.com");

    expect(await isAdmin(db, admin, admins)).toBe(true);
    expect(await isAdmin(db, unverified, admins)).toBe(false);
    expect(await isAdmin(db, other, admins)).toBe(false);
    expect(await isAdmin(db, admin, new Set())).toBe(false);

    await deleteAccount(
      db,
      admin,
      { confirmEmail: "admin@example.com", password: "gizli-sifre-1" },
      null,
      now,
    );
    expect(await isAdmin(db, admin, admins)).toBe(false);
  });
});

describe("kullanıcı arama ve ayrıntı", () => {
  it("e-posta ya da ad parçası ve tam kimlikle bulur; bakiye hesaplanır", async () => {
    const a = await newUser("ayse@example.com", { name: "Ayşe Yılmaz" });
    const b = await newUser("mehmet@ornek.com", { name: "Mehmet Demir" });
    await demoTopUp(db, b, 1_250, now);

    expect((await searchUsers(db, "ORNEK")).map((u) => u.id)).toEqual([b]);
    expect((await searchUsers(db, "Yılmaz")).map((u) => u.id)).toEqual([a]);
    expect(await searchUsers(db, a)).toMatchObject([{ id: a, verified: true, balanceCents: 0 }]);
    expect(await searchUsers(db, "mehmet")).toMatchObject([{ balanceCents: 1_250 }]);
    // Joker karakterler düz metin sayılır.
    expect(await searchUsers(db, "%")).toEqual([]);
    expect(await searchUsers(db, "")).toHaveLength(2);
  });

  it("ayrıntı: defter, talepler (sağlayıcı referansıyla) ve siparişler", async () => {
    const id = await newUser("ayse@example.com");
    const t = await createTopUp(db, id, { method: "usdt_bep20", amountCents: 1_000 }, now, () => 0);
    if (!t.ok) throw new Error(t.error);
    await completeTopUp(db, t.intent.id, "0xabc", now);

    const detail = await userDetail(db, id);
    expect(detail?.user).toMatchObject({ email: "ayse@example.com", balanceCents: 1_000 });
    expect(detail?.entries).toHaveLength(1);
    expect(detail?.intents[0]).toMatchObject({ status: "completed", providerRef: "0xabc" });
    expect(await userDetail(db, "yok")).toBeNull();
  });
});

describe("bakiye düzeltme", () => {
  it("deftere düzeltme kaydı ve gerekçeli yönetici işlemi yazar", async () => {
    const admin = await newUser("admin@example.com");
    const id = await newUser("ayse@example.com");

    expect(
      await adjustBalance(
        db,
        admin,
        { userId: id, amountCents: 1_037, reason: "  Binance ödemesi yanlış tutarla geldi  " },
        now,
      ),
    ).toEqual({ ok: true, balanceCents: 1_037 });
    expect(await walletBalance(db, id)).toBe(1_037);

    const actions = await recentActions(db);
    expect(actions).toMatchObject([
      {
        adminEmail: "admin@example.com",
        action: "adjustBalance",
        targetEmail: "ayse@example.com",
        reason: "Binance ödemesi yanlış tutarla geldi",
        amountCents: 1_037,
      },
    ]);
    const detail = await userDetail(db, id);
    expect(detail?.entries[0]).toMatchObject({ kind: "adjust", reference: actions[0]!.id });
    expect(detail?.actions).toHaveLength(1);
  });

  it("bakiye eksiye düşmez; geçersiz tutar, kısa gerekçe ve kendi hesabı reddedilir", async () => {
    const admin = await newUser("admin@example.com");
    const id = await newUser("ayse@example.com");
    await demoTopUp(db, id, 500, now);
    const adjust = (userId: string, amountCents: number, reason = "Destek talebi #12") =>
      adjustBalance(db, admin, { userId, amountCents, reason }, later(1));

    expect(await adjust(id, -501)).toEqual({ ok: false, error: "negativeBalance" });
    expect(await adjust(id, -500)).toEqual({ ok: true, balanceCents: 0 });
    for (const amount of [0, 1.5, 100_001]) {
      expect(await adjust(id, amount)).toEqual({ ok: false, error: "invalidInput" });
    }
    expect(await adjust(id, 100, "kısa")).toEqual({ ok: false, error: "invalidInput" });
    expect(await adjust(admin, 100)).toEqual({ ok: false, error: "selfAction" });
    expect(await adjust("yok", 100)).toEqual({ ok: false, error: "notFound" });
    expect(await recentActions(db)).toHaveLength(1);
  });
});

describe("özet", () => {
  it("aktif/silinmiş kullanıcılar, toplam bakiye, son 24 saatin gerçek yüklemeleri", async () => {
    const admin = await newUser("admin@example.com");
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    await demoTopUp(db, a, 700, now);
    const t = await createTopUp(db, b, { method: "paypal", amountCents: 2_000 }, now);
    if (!t.ok) throw new Error(t.error);
    await completeTopUp(db, t.intent.id, "paypal:CAP-1", now);
    await createTopUp(db, a, { method: "usdt_bep20", amountCents: 1_000 }, now);
    await adjustBalance(db, admin, { userId: a, amountCents: -200, reason: "Hatalı yükleme" }, now);

    expect(await adminOverview(db, later(10))).toEqual({
      users: 3,
      deletedUsers: 0,
      liabilityCents: 2_500,
      topUps24hCents: 2_000,
      pendingIntents: 1,
    });
    expect((await adminOverview(db, later(25 * 60))).topUps24hCents).toBe(0);
  });
});

describe("ödeme talepleri", () => {
  const HASH = `0x${"ab".repeat(32)}`;

  it("tutar başı, işlem kimliği, e-posta ve talep kimliğiyle bulunur", async () => {
    const a = await newUser("ayse@example.com");
    const b = await newUser("mehmet@example.com");
    const ta = await createTopUp(
      db,
      a,
      { method: "binance_pay", amountCents: 1_000 },
      now,
      () => 0.36,
    );
    const tb = await createTopUp(db, b, { method: "usdt_bep20", amountCents: 2_000 }, now, () => 0);
    if (!ta.ok || !tb.ok) throw new Error("talep");
    expect(ta.intent.payAmount).toBe("10.36");
    await completeTopUp(db, tb.intent.id, HASH, now);

    expect((await searchIntents(db, "10,36")).map((i) => i.id)).toEqual([ta.intent.id]);
    expect(await searchIntents(db, HASH.toUpperCase().replace("0X", "0x"))).toMatchObject([
      { id: tb.intent.id, userEmail: "mehmet@example.com", providerRef: HASH },
    ]);
    expect((await searchIntents(db, "ayse@")).map((i) => i.id)).toEqual([ta.intent.id]);
    expect((await searchIntents(db, tb.intent.id)).map((i) => i.userId)).toEqual([b]);
    expect(await searchIntents(db, "")).toHaveLength(2);
  });

  it("işlem kimliği otomatik akışın biçimine getirilir", () => {
    expect(normalizeProviderRef("usdt_bep20", ` ${HASH.toUpperCase().replace("0X", "0x")} `)).toBe(
      HASH,
    );
    expect(normalizeProviderRef("usdt_bep20", "0x12")).toBeNull();
    expect(normalizeProviderRef("binance_pay", "M_P_71505104267788288")).toBe(
      "binance:M_P_71505104267788288",
    );
    expect(normalizeProviderRef("binance_pay", "binance:M_P_1234")).toBe("binance:M_P_1234");
    expect(normalizeProviderRef("paypal", "paypal:3c679366hh908993f")).toBe(
      "paypal:3C679366HH908993F",
    );
    expect(normalizeProviderRef("paypal", "x y")).toBeNull();
    expect(normalizeProviderRef("demo", "anything")).toBeNull();
  });

  it("süresi dolan talep elle tamamlanır, kayda geçer; aynı işlem otomatik akışta tekrar kullanılamaz", async () => {
    const admin = await newUser("admin@example.com");
    const id = await newUser("ayse@example.com");
    const t = await createTopUp(db, id, { method: "usdt_bep20", amountCents: 1_000 }, now, () => 0);
    if (!t.ok) throw new Error(t.error);

    const res = await completeIntentManually(
      db,
      admin,
      {
        intentId: t.intent.id,
        providerRef: HASH.toUpperCase().replace("0X", "0x"),
        reason: "Süre dolduktan sonra ödenmiş, BscScan'de doğrulandı",
      },
      later(90),
    );
    expect(res.ok && res.intent).toMatchObject({ status: "completed", creditCents: 1_000 });
    expect(await walletBalance(db, id)).toBe(1_000);
    expect(await recentActions(db)).toMatchObject([
      { action: "completeIntent", targetEmail: "ayse@example.com", amountCents: 1_000 },
    ]);

    // Kullanıcı aynı işlemi kendisi doğrulamaya çalışırsa ikinci kez yazılmaz.
    await createTopUp(db, id, { method: "usdt_bep20", amountCents: 1_000 }, later(91), () => 0);
    const check = async () => ({
      ok: true as const,
      amount: "10.0001",
      blockTime: later(91).getTime() / 1000,
    });
    expect(await claimUsdtTopUp(db, id, HASH, check, later(92))).toEqual({
      ok: false,
      error: "duplicateRef",
    });
    expect(
      await completeIntentManually(
        db,
        admin,
        { intentId: t.intent.id, providerRef: HASH, reason: "tekrar deneme" },
        later(93),
      ),
    ).toEqual({
      ok: false,
      error: "alreadyCompleted",
    });
    expect(await walletBalance(db, id)).toBe(1_000);
  });

  it("geçersiz kimlik, kısa gerekçe, kendi talebi ve kullanılmış kimlik reddedilir", async () => {
    const admin = await newUser("admin@example.com");
    const id = await newUser("ayse@example.com");
    const other = await newUser("mehmet@example.com");
    const t = await createTopUp(db, id, { method: "binance_pay", amountCents: 500 }, now);
    const own = await createTopUp(db, admin, { method: "binance_pay", amountCents: 500 }, now);
    const used = await createTopUp(db, other, { method: "binance_pay", amountCents: 500 }, now);
    if (!t.ok || !own.ok || !used.ok) throw new Error("talep");
    await completeTopUp(db, used.intent.id, "binance:M_P_1", now);
    const complete = (intentId: string, providerRef: string, reason = "Destek talebi #7") =>
      completeIntentManually(db, admin, { intentId, providerRef, reason }, later(1));

    expect(await complete(t.intent.id, "x y")).toEqual({ ok: false, error: "invalidInput" });
    expect(await complete(t.intent.id, "M_2", "kısa")).toEqual({
      ok: false,
      error: "invalidInput",
    });
    expect(await complete(own.intent.id, "M_3")).toEqual({ ok: false, error: "selfAction" });
    expect(await complete(t.intent.id, "M_P_1")).toEqual({ ok: false, error: "duplicateRef" });
    expect(await complete("yok", "M_4")).toEqual({ ok: false, error: "notFound" });
    expect(await walletBalance(db, id)).toBe(0);
    expect(await recentActions(db)).toHaveLength(0);
  });
});

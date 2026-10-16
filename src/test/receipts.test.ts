// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb, type Db } from "@/server/db.server";
import { memoryMailer } from "@/server/email.server";
import { handlePaypalWebhook } from "@/server/paypal-webhook.server";
import {
  completeTopUp,
  createTopUp,
  deleteAccount,
  demoTopUp,
  markEmailVerified,
  purchasePackage,
  registerUser,
  sendPurchaseReceipt,
  sendTopUpReceipt,
} from "@/server/services.server";

const now = new Date("2026-10-16T09:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-receipt-"));
let db: Db;
const appUrl = "https://trai.example";

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

async function newUser(email = "ayse@example.com", name = "Ayşe") {
  const res = await registerUser(db, { name, email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, now);
  return res.userId;
}

async function paidIntent(
  userId: string,
  {
    method = "usdt_bep20" as const,
    lang,
  }: { method?: "usdt_bep20" | "paypal"; lang?: "tr" | "en" } = {},
) {
  const t = await createTopUp(db, userId, { method, amountCents: 1_000, lang }, now, () => 0.5);
  if (!t.ok) throw new Error(t.error);
  const done = await completeTopUp(
    db,
    t.intent.id,
    method === "paypal" ? "paypal:CAP-1" : "0xabc",
    now,
  );
  if (!done.ok) throw new Error(done.error);
  return t.intent.id;
}

describe("bakiye yükleme makbuzu", () => {
  it("talebin dilinde, yazılan tutar ve güncel bakiyeyle bir kez gider", async () => {
    const id = await newUser("john@example.com", "John");
    const intentId = await paidIntent(id, { lang: "en" });
    const mailer = memoryMailer();

    expect(await sendTopUpReceipt(db, { mailer, appUrl }, intentId, now)).toBe(true);
    expect(await sendTopUpReceipt(db, { mailer, appUrl }, intentId, now)).toBe(false);
    expect(mailer.sent).toHaveLength(1);
    const [mail] = mailer.sent;
    expect(mail).toMatchObject({
      to: "john@example.com",
      subject: "TrAi Pro: $10.05 added to your balance",
    });
    expect(mail!.text).toContain("Your USDT (BEP20) payment was verified");
    expect(mail!.text).toContain("Current balance: $10.05");
    expect(mail!.text).toContain(`Transaction number: ${intentId.slice(0, 8).toUpperCase()}`);
    expect(mail!.text).toContain("https://trai.example/payment-history");
  });

  it("dil yoksa Türkçe; ad HTML'de kaçışlanır", async () => {
    const id = await newUser("ayse@example.com", "<b>Ayşe</b>");
    const intentId = await paidIntent(id, { method: "paypal" });
    const mailer = memoryMailer();
    await sendTopUpReceipt(db, { mailer, appUrl }, intentId, now);
    expect(mailer.sent[0]!.subject).toBe("TrAi Pro: bakiyene $10,00 yüklendi");
    expect(mailer.sent[0]!.text).toContain("PayPal / Kart ile yaptığın ödeme doğrulandı");
    expect(mailer.sent[0]!.html).toContain("&lt;b&gt;Ayşe&lt;/b&gt;");
    expect(mailer.sent[0]!.html).not.toContain("<b>Ayşe</b>");
  });

  it("bekleyen talebe, demo yüklemeye ve silinmiş hesaba gönderilmez", async () => {
    const id = await newUser();
    const mailer = memoryMailer();
    const pending = await createTopUp(db, id, { method: "usdt_bep20", amountCents: 1_000 }, now);
    if (!pending.ok) throw new Error(pending.error);
    expect(await sendTopUpReceipt(db, { mailer, appUrl }, pending.intent.id, now)).toBe(false);

    const demo = await demoTopUp(db, id, 500, now);
    if (!demo.ok) throw new Error(demo.error);
    expect(await sendTopUpReceipt(db, { mailer, appUrl }, demo.intent.id, now)).toBe(false);

    const other = await newUser("b@example.com");
    const paid = await paidIntent(other);
    await deleteAccount(
      db,
      other,
      { confirmEmail: "b@example.com", password: "gizli-sifre-1" },
      null,
      now,
    );
    expect(await sendTopUpReceipt(db, { mailer, appUrl }, paid, now)).toBe(false);
    expect(mailer.sent).toHaveLength(0);
  });

  it("PayPal webhook'u tekrar gelse de tek makbuz gider", async () => {
    const id = await newUser();
    const t = await createTopUp(db, id, { method: "paypal", amountCents: 1_000, lang: "tr" }, now);
    if (!t.ok) throw new Error(t.error);
    const mailer = memoryMailer();
    const event = {
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAP-7",
        status: "COMPLETED",
        custom_id: t.intent.id,
        amount: { currency_code: "USD", value: "10.00" },
      },
    };
    const deps = {
      config: { clientId: "c", clientSecret: "s", sandbox: true, webhookId: "WH" },
      client: { verifyWebhook: async () => true },
      db: async () => db,
      now: () => now,
      receipts: () => ({ mailer, appUrl }),
    };
    const post = () =>
      new Request("https://trai.example/webhooks/paypal", {
        method: "POST",
        body: JSON.stringify(event),
      });
    expect((await handlePaypalWebhook(post(), deps)).status).toBe(200);
    expect((await handlePaypalWebhook(post(), deps)).status).toBe(200);
    expect(mailer.sent).toHaveLength(1);
  });
});

describe("paket alım makbuzu", () => {
  it("paket, kredi, son kullanma, ödenen tutar ve kalan bakiye", async () => {
    const id = await newUser();
    await demoTopUp(db, id, 1_000, now);
    const bought = await purchasePackage(db, id, { packageId: "media-6d" }, now);
    if (!bought.ok) throw new Error(bought.error);
    const mailer = memoryMailer();
    expect(await sendPurchaseReceipt(db, { mailer, appUrl, lang: "tr" }, id, bought.order)).toBe(
      true,
    );
    const mail = mailer.sent[0]!;
    expect(mail.subject).toBe("TrAi Pro: Video & Görsel AI · 6 gün paketin hazır");
    expect(mail.text).toContain("300 kredi hesabına eklendi");
    expect(mail.text).toContain("Ödenen: $8,00 (bakiyeden) · Kalan bakiye: $2,00");
    expect(mail.text).toContain("https://trai.example/labs");
  });
});

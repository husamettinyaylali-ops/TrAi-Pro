// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SetupId, SetupItem } from "@/lib/types";
import { maskMiddle, setupStatus, testIntegration } from "@/server/setup-check.server";

const KEYS = [
  "PUBLIC_URL",
  "DOMAIN",
  "ADMIN_EMAILS",
  "DEMO_PAYMENTS",
  "SMTP_HOST",
  "SMTP_PORT",
  "EMAIL_FROM",
  "SMTP_USER",
  "SMTP_PASS",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_MODEL",
  "FAL_KEY",
  "FAL_IMAGE_MODEL",
  "FAL_VIDEO_MODEL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "USDT_BEP20_ADDRESS",
  "BSC_RPC_URL",
  "BINANCE_PAY_ID",
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_ENV",
  "PAYPAL_WEBHOOK_ID",
  "BACKUP_DIR",
  "RETENTION_YEARS",
];
const saved = new Map<string, string | undefined>();
const origin = "https://studio.example";
const now = new Date("2026-10-16T09:00:00Z");
// Deneme değerleri; gerçek bir hesaba ait değildir.
const TEST_ADDRESS = "0x1111111111111111111111111111111111111111";
const SECRETS = { el: "el-secret-value", fal: "fal-secret-value", pp: "pp-secret-value" };

// Boş dize "tanımlı ama boş" sayılır: kullanıcının .env dosyası testi etkilemez.
beforeEach(() => {
  for (const k of KEYS) {
    saved.set(k, process.env[k]);
    process.env[k] = "";
  }
});
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const byId = (items: SetupItem[], id: SetupId) => items.find((i) => i.id === id)!;

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit | undefined }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("kurulum durumu", () => {
  it("hiçbir şey yapılandırılmamışken: ses ve görsel eksik, ödemeler kullanılmıyor ama uyarılı", () => {
    const items = setupStatus(origin, false);
    expect(byId(items, "tts")).toMatchObject({ state: "missing", missing: ["ELEVENLABS_API_KEY"] });
    expect(byId(items, "fal")).toMatchObject({ state: "missing", missing: ["FAL_KEY"] });
    expect(byId(items, "email")).toMatchObject({
      state: "optional",
      missing: ["SMTP_HOST", "EMAIL_FROM"],
    });
    expect(byId(items, "google").info).toContainEqual({
      key: "callback",
      value: "https://studio.example/auth/google/callback",
    });
    for (const id of ["usdt", "binance", "paypal"] as const) {
      expect(byId(items, id)).toMatchObject({ state: "optional", warnings: ["noPaymentMethod"] });
    }
    expect(byId(items, "site")).toMatchObject({ state: "ready" });
  });

  it("yayında: PUBLIC_URL ve SMTP zorunlu; demo bakiye ve yedek yokluğu uyarılır", () => {
    process.env["DEMO_PAYMENTS"] = "on";
    const items = setupStatus(origin, true);
    expect(byId(items, "site")).toMatchObject({
      state: "missing",
      missing: ["PUBLIC_URL"],
      warnings: ["demoPaymentsOn"],
    });
    expect(byId(items, "email").state).toBe("missing");
    expect(byId(items, "backup")).toMatchObject({ state: "warning", warnings: ["backupMissing"] });
  });

  it("yapılandırılmış servisler hazır; gizli değerler hiç dönmez, adres kısaltılır", () => {
    Object.assign(process.env, {
      PUBLIC_URL: "https://trai.example",
      ELEVENLABS_API_KEY: SECRETS.el,
      FAL_KEY: SECRETS.fal,
      SMTP_HOST: "smtp.example",
      EMAIL_FROM: "TrAi <no-reply@trai.example>",
      SMTP_PASS: "smtp-secret-value",
      USDT_BEP20_ADDRESS: TEST_ADDRESS,
      PAYPAL_CLIENT_ID: "pp-id",
      PAYPAL_CLIENT_SECRET: SECRETS.pp,
      BACKUP_DIR: "/data/backups",
    });
    const items = setupStatus(origin, true);
    for (const id of ["site", "tts", "fal", "email", "usdt", "backup"] as const) {
      expect(byId(items, id).state, id).toBe("ready");
    }
    expect(byId(items, "usdt").info).toContainEqual({ key: "address", value: "0x1111…1111" });
    // Yayında sandbox ve webhook kimliği eksikliği uyarılır.
    expect(byId(items, "paypal")).toMatchObject({
      state: "warning",
      warnings: ["paypalSandbox", "paypalWebhookMissing"],
    });
    expect(byId(items, "google").info[0]!.value).toBe("https://trai.example/auth/google/callback");
    const dump = JSON.stringify(items);
    for (const secret of [...Object.values(SECRETS), "smtp-secret-value", TEST_ADDRESS]) {
      expect(dump).not.toContain(secret);
    }
    expect(byId(items, "usdt").warnings).toEqual([]);
  });

  it("geçersiz USDT adresi ve eksik Binance anahtarı açıkça söylenir", () => {
    process.env["USDT_BEP20_ADDRESS"] = "0x123";
    process.env["BINANCE_PAY_ID"] = "123456789";
    const items = setupStatus(origin, false);
    expect(byId(items, "usdt").state).toBe("missing");
    expect(byId(items, "usdt").warnings).toContain("invalidAddress");
    expect(byId(items, "binance")).toMatchObject({
      state: "missing",
      missing: ["BINANCE_API_KEY", "BINANCE_API_SECRET"],
    });
    expect(maskMiddle("abcdef")).toBe("abcdef");
  });
});

describe("bağlantı testleri", () => {
  const deps = (impl: typeof fetch) => ({ adminEmail: "admin@example.com", now, fetchImpl: impl });

  it("anahtar yoksa dış servise gidilmez", async () => {
    const { impl, calls } = fakeFetch(() => json({}));
    for (const id of ["tts", "fal", "google", "usdt", "binance", "paypal"] as const) {
      expect(await testIntegration(id, deps(impl)), id).toEqual({
        ok: false,
        code: "notConfigured",
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("ElevenLabs: ses listesi sayılır; 401 anahtar reddi", async () => {
    process.env["ELEVENLABS_API_KEY"] = SECRETS.el;
    const ok = fakeFetch(() =>
      json({
        voices: [
          { voice_id: "a", name: "A" },
          { voice_id: "b", name: "B" },
        ],
      }),
    );
    expect(await testIntegration("tts", deps(ok.impl))).toEqual({
      ok: true,
      code: "voices",
      value: "2",
    });
    const bad = fakeFetch(() => new Response("", { status: 401 }));
    expect(await testIntegration("tts", deps(bad.impl))).toEqual({
      ok: false,
      code: "keyRejected",
    });
  });

  it("fal.ai: var olmayan işin durumu; 404 kabul, 401 ret; ücretli çağrı yapılmaz", async () => {
    process.env["FAL_KEY"] = SECRETS.fal;
    const ok = fakeFetch(() => new Response("", { status: 404 }));
    expect(await testIntegration("fal", deps(ok.impl))).toEqual({ ok: true, code: "keyAccepted" });
    expect(ok.calls[0]!.url).toMatch(/^https:\/\/queue\.fal\.run\/.+\/requests\/.+\/status$/);
    expect(ok.calls[0]!.init?.method ?? "GET").toBe("GET");
    expect(new Headers(ok.calls[0]!.init?.headers).get("authorization")).toBe(`Key ${SECRETS.fal}`);
    const bad = fakeFetch(() => new Response("", { status: 401 }));
    expect(await testIntegration("fal", deps(bad.impl))).toEqual({
      ok: false,
      code: "keyRejected",
    });
  });

  it("Google: invalid_client ret, invalid_grant kabul", async () => {
    process.env["GOOGLE_CLIENT_ID"] = "id.apps.googleusercontent.com";
    process.env["GOOGLE_CLIENT_SECRET"] = "g-secret";
    const bad = fakeFetch(() => json({ error: "invalid_client" }, 401));
    expect(await testIntegration("google", deps(bad.impl))).toEqual({
      ok: false,
      code: "keyRejected",
    });
    const ok = fakeFetch(() => json({ error: "invalid_grant" }, 400));
    expect(await testIntegration("google", deps(ok.impl))).toEqual({
      ok: true,
      code: "keyAccepted",
    });
  });

  it("USDT: son blok okunur; ağ hatası ayrı söylenir", async () => {
    process.env["USDT_BEP20_ADDRESS"] = TEST_ADDRESS;
    const ok = fakeFetch(() => json({ jsonrpc: "2.0", id: 1, result: "0x2a" }));
    expect(await testIntegration("usdt", deps(ok.impl))).toEqual({
      ok: true,
      code: "blockNumber",
      value: "42",
    });
    const down = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await testIntegration("usdt", deps(down.impl))).toEqual({ ok: false, code: "network" });
  });

  it("Binance: kısa geçmiş okunur; imza hatası anahtar reddi", async () => {
    Object.assign(process.env, {
      BINANCE_PAY_ID: "123456789",
      BINANCE_API_KEY: "bk",
      BINANCE_API_SECRET: "bs",
    });
    const ok = fakeFetch(() => json({ code: "000000", data: [] }));
    expect(await testIntegration("binance", deps(ok.impl))).toEqual({
      ok: true,
      code: "historyOk",
      value: "0",
    });
    const bad = fakeFetch(() => json({ code: -1022, msg: "Signature invalid" }, 401));
    expect(await testIntegration("binance", deps(bad.impl))).toEqual({
      ok: false,
      code: "keyRejected",
    });
  });

  it("PayPal: erişim anahtarı alınır; 401 anahtar reddi", async () => {
    process.env["PAYPAL_CLIENT_ID"] = "pp-id";
    process.env["PAYPAL_CLIENT_SECRET"] = SECRETS.pp;
    const ok = fakeFetch(() => json({ access_token: "t", expires_in: 3600 }));
    expect(await testIntegration("paypal", deps(ok.impl))).toEqual({
      ok: true,
      code: "tokenOk",
      value: "sandbox",
    });
    expect(ok.calls[0]!.url).toContain("sandbox.paypal.com/v1/oauth2/token");
    const bad = fakeFetch(() => new Response("", { status: 401 }));
    expect(await testIntegration("paypal", deps(bad.impl))).toEqual({
      ok: false,
      code: "keyRejected",
    });
  });
});

describe("video oluşturucu (ffmpeg)", () => {
  it("bulunursa sürümüyle hazır; libass yoksa uyarılı; yoksa yayında uyarı, geliştirmede kullanılmıyor", () => {
    expect(
      byId(setupStatus(origin, true, { version: "6.1", subtitles: true }), "ffmpeg"),
    ).toMatchObject({
      state: "ready",
      warnings: [],
      info: [{ key: "ffmpegVersion", value: "6.1" }],
    });
    expect(
      byId(setupStatus(origin, true, { version: "6.1", subtitles: false }), "ffmpeg"),
    ).toMatchObject({
      state: "warning",
      warnings: ["ffmpegNoSubtitles"],
    });
    expect(byId(setupStatus(origin, true, null), "ffmpeg")).toMatchObject({
      state: "warning",
      warnings: ["ffmpegMissing"],
    });
    expect(byId(setupStatus(origin, false), "ffmpeg")).toMatchObject({
      state: "optional",
      warnings: [],
    });
  });
});

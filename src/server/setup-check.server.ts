import type {
  SetupId,
  SetupInfo,
  SetupItem,
  SetupState,
  SetupTestResult,
  SetupWarning,
} from "@/lib/types";

import { binanceConfig, binancePayClient } from "./binance.server";
import { rpcClient, usdtConfig } from "./bsc.server";
import { getMailer, smtpSettings } from "./email.server";
import { env, isProduction } from "./env.server";
import { GOOGLE_TOKEN_URL, googleConfig } from "./google.server";
import { CALLBACK_PATH } from "./google-flow.server";
import { DEFAULT_IMAGE_MODEL } from "./image.server";
import { retentionYears } from "./maintenance.server";
import { PAYPAL_API, paypalConfig } from "./paypal.server";
import { DEFAULT_TTS_MODEL, TtsError, elevenLabsProvider } from "./tts.server";
import { DEFAULT_VIDEO_MODEL } from "./video.server";

/** Bağlantı testinin bekleme sınırı. */
const TEST_TIMEOUT_MS = 10_000;
const FAL_PROBE =
  "https://queue.fal.run/fal-ai/flux/requests/00000000-0000-4000-8000-000000000000/status";

/** Adresi yalnız başı ve sonu görünecek şekilde kısaltır (yanlış alıcıyı fark etmeye yeter). */
export const maskMiddle = (v: string, head = 6, tail = 4) =>
  v.length <= head + tail + 1 ? v : `${v.slice(0, head)}…${v.slice(-tail)}`;

const maskEmail = (email: string) => {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 2)}…@${domain}`;
};

const absent = (...names: string[]) => names.filter((n) => !env(n));

function item(
  id: SetupId,
  state: SetupState,
  extra: Partial<Pick<SetupItem, "missing" | "warnings" | "info" | "testable">> = {},
): SetupItem {
  return { id, state, missing: [], warnings: [], info: [], testable: false, ...extra };
}

/** Uyarı varsa "hazır" durum "dikkat" olur. */
const withWarnings = (state: SetupState, warnings: SetupWarning[]): SetupState =>
  state === "ready" && warnings.length ? "warning" : state;

/**
 * Hangi servislerin yapılandırıldığı. Yalnız eksik anahtarların adları ve
 * gizli olmayan bilgiler (gönderen adresi, model, kısaltılmış alıcı adresi)
 * döner; API anahtarlarının ve şifrelerin değeri hiçbir zaman dönmez.
 * `origin` PUBLIC_URL yoksa Google yönlendirme adresini göstermek içindir.
 */
export function setupStatus(origin: string, production = isProduction()): SetupItem[] {
  const items: SetupItem[] = [];
  const publicUrl = env("PUBLIC_URL");
  const base = (publicUrl ?? origin).replace(/\/+$/, "");

  // Site: yayında e-posta bağlantıları, Google ve webhook adresleri PUBLIC_URL'den kurulur.
  {
    const warnings: SetupWarning[] = [];
    if (production && env("DEMO_PAYMENTS") === "on") warnings.push("demoPaymentsOn");
    const info: SetupInfo[] = [];
    if (publicUrl) info.push({ key: "publicUrl", value: publicUrl });
    if (env("DOMAIN")) info.push({ key: "domain", value: env("DOMAIN")! });
    const admins = (env("ADMIN_EMAILS") ?? "").split(",").filter((e) => e.trim()).length;
    info.push({ key: "admins", value: String(admins) });
    const missing = production ? absent("PUBLIC_URL") : [];
    items.push(
      item("site", missing.length ? "missing" : withWarnings("ready", warnings), {
        missing,
        warnings,
        info,
      }),
    );
  }

  // E-posta: yayında zorunlu (doğrulama, şifre sıfırlama, makbuz).
  {
    const s = smtpSettings();
    items.push(
      s
        ? item("email", "ready", {
            info: [
              { key: "from", value: s.from },
              { key: "smtpHost", value: `${s.host}:${s.port}` },
            ],
            testable: true,
          })
        : item("email", production ? "missing" : "optional", {
            missing: absent("SMTP_HOST", "EMAIL_FROM"),
            testable: !production,
          }),
    );
  }

  // Ses (ElevenLabs) ve görsel/video (fal.ai): anahtar yoksa stüdyo demo kipte çalışır.
  items.push(
    env("ELEVENLABS_API_KEY")
      ? item("tts", "ready", {
          info: [{ key: "model", value: env("ELEVENLABS_MODEL") ?? DEFAULT_TTS_MODEL }],
          testable: true,
        })
      : item("tts", "missing", { missing: ["ELEVENLABS_API_KEY"] }),
  );
  items.push(
    env("FAL_KEY")
      ? item("fal", "ready", {
          info: [
            { key: "imageModel", value: env("FAL_IMAGE_MODEL") ?? DEFAULT_IMAGE_MODEL },
            { key: "videoModel", value: env("FAL_VIDEO_MODEL") ?? DEFAULT_VIDEO_MODEL },
          ],
          testable: true,
        })
      : item("fal", "missing", { missing: ["FAL_KEY"] }),
  );

  // Google girişi isteğe bağlı; açıksa yönlendirme adresi Google Console'a eklenmeli.
  {
    const callback = { key: "callback" as const, value: `${base}${CALLBACK_PATH}` };
    const missing = absent("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
    items.push(
      googleConfig()
        ? item("google", "ready", { info: [callback], testable: true })
        : item("google", missing.length === 2 ? "optional" : "missing", {
            missing,
            info: [callback],
          }),
    );
  }

  // Ödeme yöntemleri: her biri isteğe bağlı, ama en az biri gerekli.
  {
    const raw = env("USDT_BEP20_ADDRESS");
    const cfg = usdtConfig();
    items.push(
      cfg
        ? item("usdt", "ready", {
            info: [
              { key: "address", value: maskMiddle(cfg.address) },
              { key: "rpc", value: new URL(cfg.rpcUrl).host },
            ],
            testable: true,
          })
        : raw
          ? item("usdt", "missing", { warnings: ["invalidAddress"] })
          : item("usdt", "optional", { missing: ["USDT_BEP20_ADDRESS"] }),
    );
  }
  {
    const names = ["BINANCE_PAY_ID", "BINANCE_API_KEY", "BINANCE_API_SECRET"];
    const missing = absent(...names);
    const cfg = binanceConfig();
    items.push(
      cfg
        ? item("binance", "ready", {
            info: [{ key: "binanceId", value: maskMiddle(cfg.binanceId, 2, 3) }],
            testable: true,
          })
        : missing.length === names.length
          ? item("binance", "optional", { missing })
          : item("binance", "missing", {
              missing,
              // Üçü de girilmiş ama kabul edilmemişse kimlik biçimi hatalıdır.
              warnings: missing.length === 0 ? ["invalidBinanceId"] : [],
            }),
    );
  }
  {
    const cfg = paypalConfig();
    const missing = absent("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET");
    if (cfg) {
      const warnings: SetupWarning[] = [];
      if (production && cfg.sandbox) warnings.push("paypalSandbox");
      if (production && !cfg.webhookId) warnings.push("paypalWebhookMissing");
      items.push(
        item("paypal", withWarnings("ready", warnings), {
          warnings,
          info: [
            { key: "mode", value: cfg.sandbox ? "sandbox" : "live" },
            { key: "webhook", value: `${base}/webhooks/paypal` },
          ],
          testable: true,
        }),
      );
    } else {
      items.push(item("paypal", missing.length === 2 ? "optional" : "missing", { missing }));
    }
  }
  const payments = items.filter((i) => ["usdt", "binance", "paypal"].includes(i.id));
  if (!payments.some((i) => i.state === "ready" || i.state === "warning")) {
    for (const p of payments) p.warnings.push("noPaymentMethod");
  }

  // Yedek: yayında BACKUP_DIR yoksa günlük veritabanı yedeği alınmaz.
  {
    const dir = env("BACKUP_DIR");
    const years = retentionYears(env("RETENTION_YEARS"));
    const retention = { key: "retention" as const, value: years === null ? "off" : String(years) };
    items.push(
      dir
        ? item("backup", "ready", { info: [{ key: "backupDir", value: dir }, retention] })
        : item("backup", production ? "warning" : "optional", {
            missing: ["BACKUP_DIR"],
            warnings: production ? ["backupMissing"] : [],
            info: [retention],
          }),
    );
  }
  return items;
}

export interface SetupTestDeps {
  /** Test e-postasının gideceği adres (testi yapan yönetici). */
  adminEmail: string;
  now: Date;
  fetchImpl?: typeof fetch;
}

const timeout = () => AbortSignal.timeout(TEST_TIMEOUT_MS);
const result = (ok: boolean, code: SetupTestResult["code"], value?: string): SetupTestResult => ({
  ok,
  code,
  ...(value === undefined ? {} : { value }),
});
const failure = (err: unknown): SetupTestResult =>
  err instanceof TypeError || (err instanceof Error && err.name === "TimeoutError")
    ? result(false, "network")
    : result(false, "httpError", err instanceof Error ? err.message.slice(0, 120) : undefined);

/**
 * Servise gerçekten bağlanmayı dener; ücret doğuran bir işlem yapılmaz
 * (ses listesi, geçersiz kodla token isteği, son blok, kısa geçmiş). Yanıt
 * gövdeleri döndürülmez; yalnız sonuç kodu ve sayı ya da durum kodu.
 */
export async function testIntegration(id: SetupId, deps: SetupTestDeps): Promise<SetupTestResult> {
  const raw = deps.fetchImpl ?? fetch;
  // Her istek en fazla TEST_TIMEOUT_MS bekler.
  const fetchImpl: typeof fetch = (u, init) => raw(u, { ...init, signal: timeout() });
  try {
    switch (id) {
      case "tts": {
        const apiKey = env("ELEVENLABS_API_KEY");
        if (!apiKey) return result(false, "notConfigured");
        const provider = elevenLabsProvider({ apiKey, model: env("ELEVENLABS_MODEL"), fetchImpl });
        try {
          const voices = await provider.listVoices();
          return result(true, "voices", String(voices.length));
        } catch (err) {
          if (err instanceof TtsError && (err.status === 401 || err.status === 403)) {
            return result(false, "keyRejected");
          }
          throw err;
        }
      }
      case "fal": {
        const key = env("FAL_KEY");
        if (!key) return result(false, "notConfigured");
        // Var olmayan bir işin durumu: anahtar geçersizse 401/403, geçerliyse "bulunamadı".
        const res = await fetchImpl(FAL_PROBE, {
          headers: { authorization: `Key ${key}` },
        });
        if (res.status === 401 || res.status === 403) return result(false, "keyRejected");
        if (res.status >= 500) return result(false, "httpError", String(res.status));
        return result(true, "keyAccepted");
      }
      case "email": {
        const smtp = smtpSettings();
        if (!smtp && isProduction()) return result(false, "notConfigured");
        await getMailer().send({
          to: deps.adminEmail,
          subject: "TrAi Pro: e-posta testi",
          text: "Bu e-posta, yönetim panelindeki kurulum kontrolünden gönderildi. E-posta ayarlarınız çalışıyor.",
          html: "<p>Bu e-posta, yönetim panelindeki kurulum kontrolünden gönderildi. E-posta ayarlarınız çalışıyor.</p>",
        });
        return smtp ? result(true, "sent", maskEmail(deps.adminEmail)) : result(true, "outbox");
      }
      case "google": {
        const cfg = googleConfig();
        if (!cfg) return result(false, "notConfigured");
        // Geçersiz kodla token isteği: kimlik yanlışsa invalid_client, doğruysa invalid_grant.
        const res = await fetchImpl(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: "setup-check",
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            redirect_uri: "https://example.invalid/callback",
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "invalid_client" || body.error === "unauthorized_client") {
          return result(false, "keyRejected");
        }
        if (body.error === "invalid_grant" || body.error === "redirect_uri_mismatch") {
          return result(true, "keyAccepted");
        }
        return result(false, "httpError", body.error ?? String(res.status));
      }
      case "usdt": {
        const cfg = usdtConfig();
        if (!cfg) return result(false, "notConfigured");
        const block = await rpcClient(cfg.rpcUrl, fetchImpl).blockNumber();
        return result(true, "blockNumber", String(block));
      }
      case "binance": {
        const cfg = binanceConfig();
        if (!cfg) return result(false, "notConfigured");
        try {
          const list = await binancePayClient(cfg, fetchImpl)(
            new Date(deps.now.getTime() - 60 * 60_000),
            deps.now,
          );
          return result(true, "historyOk", String(list.length));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          // -2014/-2015: anahtar biçimi ya da izni; -1022: imza (gizli anahtar) hatalı.
          if (/\((401|403)\)|-201[45]|-1022/.test(msg)) return result(false, "keyRejected");
          throw err;
        }
      }
      case "paypal": {
        const cfg = paypalConfig();
        if (!cfg) return result(false, "notConfigured");
        const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
        const res = await fetchImpl(
          `${cfg.sandbox ? PAYPAL_API.sandbox : PAYPAL_API.live}/v1/oauth2/token`,
          {
            method: "POST",
            headers: {
              authorization: `Basic ${basic}`,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
          },
        );
        if (res.status === 401 || res.status === 403) return result(false, "keyRejected");
        if (!res.ok) return result(false, "httpError", String(res.status));
        return result(true, "tokenOk", cfg.sandbox ? "sandbox" : "live");
      }
      default:
        return result(false, "notConfigured");
    }
  } catch (err) {
    return failure(err);
  }
}

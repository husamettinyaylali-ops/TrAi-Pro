import { createHmac } from "node:crypto";

import { env } from "./env.server";

export const DEFAULT_BINANCE_API = "https://api.binance.com";
/** Binance kimliği (Pay ID) yalnız rakamdır. */
const BINANCE_ID_RE = /^\d{5,15}$/;
/** Geçmiş sorgusunun ağırlığı yüksek (3000); aynı liste kullanıcılar arasında kısa süre paylaşılır. */
export const INCOMING_CACHE_MS = 20_000;
const PAGE_LIMIT = 100;

/** Binance Pay ile hesabımıza gelen bir ödeme. */
export interface BinanceIncome {
  transactionId: string;
  /** İşlem zamanı (ms). */
  time: number;
  /** Binance'in verdiği biçimde tutar, ör. "10.37000000". */
  amount: string;
  currency: string;
}

/** Binance Pay geçmişine erişim; testlerde sahte uygulama verilir. */
export type IncomingFetcher = (since: Date, now: Date) => Promise<BinanceIncome[]>;

interface RawTransaction {
  orderType?: string;
  transactionId?: string;
  transactionTime?: number;
  amount?: string;
  currency?: string;
}

/** Binance SAPI imzası: sorgu metninin gizli anahtarla HMAC SHA256 özeti (hex). */
export function signQuery(query: string, secret: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

/**
 * Yalnız başka bir kullanıcıdan Binance kimliğimize gönderilen (C2C) ve
 * hesabımıza giren (pozitif tutarlı) USDT ödemeleri. İade, ödül ve giden
 * ödemeler eşleşmeye girmez.
 */
export function incomingUsdt(rows: RawTransaction[]): BinanceIncome[] {
  return rows.flatMap((r) =>
    r.orderType === "C2C" &&
    r.currency === "USDT" &&
    typeof r.transactionId === "string" &&
    typeof r.transactionTime === "number" &&
    typeof r.amount === "string" &&
    Number(r.amount) > 0
      ? [
          {
            transactionId: r.transactionId,
            time: r.transactionTime,
            amount: r.amount,
            currency: r.currency,
          },
        ]
      : [],
  );
}

export interface BinanceConfig {
  binanceId: string;
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
}

/**
 * Binance Pay geçmişini (`GET /sapi/v1/pay/transactions`) imzalı istekle okur.
 * API anahtarına yalnız okuma izni yeterlidir.
 */
export function binancePayClient(
  cfg: BinanceConfig,
  fetchImpl: typeof fetch = fetch,
): IncomingFetcher {
  return async (since, now) => {
    const query = new URLSearchParams({
      startTime: String(since.getTime()),
      limit: String(PAGE_LIMIT),
      recvWindow: "10000",
      timestamp: String(now.getTime()),
    }).toString();
    const url = `${cfg.baseUrl}/sapi/v1/pay/transactions?${query}&signature=${signQuery(query, cfg.apiSecret)}`;
    const res = await fetchImpl(url, { headers: { "X-MBX-APIKEY": cfg.apiKey } });
    if (!res.ok) throw new Error(`Binance Pay geçmişi alınamadı (${res.status})`);
    const body = (await res.json()) as { code?: string; message?: string; data?: unknown };
    if (body.code !== "000000" || !Array.isArray(body.data)) {
      throw new Error(`Binance Pay geçmişi: ${body.code ?? "?"} ${body.message ?? ""}`.trim());
    }
    if (body.data.length >= PAGE_LIMIT) {
      console.warn(
        "[ödeme] Binance Pay geçmişi sayfa sınırına ulaştı; eski ödemeler listede olmayabilir.",
      );
    }
    return incomingUsdt(body.data as RawTransaction[]);
  };
}

/**
 * Listeyi kısa süre önbelleğe alır: aynı ya da daha dar bir zaman aralığı için
 * gelen istekler yeni sorgu yapmaz. Hata önbelleğe alınmaz.
 */
export function cachedFetcher(
  fetcher: IncomingFetcher,
  ttlMs = INCOMING_CACHE_MS,
): IncomingFetcher {
  let cache: { since: number; at: number; list: Promise<BinanceIncome[]> } | null = null;
  return (since, now) => {
    if (cache && cache.since <= since.getTime() && now.getTime() - cache.at < ttlMs)
      return cache.list;
    const entry = { since: since.getTime(), at: now.getTime(), list: fetcher(since, now) };
    cache = entry;
    entry.list.catch(() => {
      if (cache === entry) cache = null;
    });
    return entry.list;
  };
}

/** Binance kimliği ve API anahtarları tam değilse yöntem kapalıdır. */
export function binanceConfig(): BinanceConfig | null {
  const binanceId = env("BINANCE_PAY_ID");
  const apiKey = env("BINANCE_API_KEY");
  const apiSecret = env("BINANCE_API_SECRET");
  if (!binanceId || !BINANCE_ID_RE.test(binanceId) || !apiKey || !apiSecret) return null;
  return { binanceId, apiKey, apiSecret, baseUrl: env("BINANCE_API_URL") ?? DEFAULT_BINANCE_API };
}

let shared: { key: string; fetcher: IncomingFetcher } | null = null;

/** Sunucu genelinde paylaşılan, önbellekli geçmiş okuyucu. */
export function sharedIncoming(cfg: BinanceConfig): IncomingFetcher {
  const key = `${cfg.baseUrl}|${cfg.apiKey}`;
  if (shared?.key !== key) shared = { key, fetcher: cachedFetcher(binancePayClient(cfg)) };
  return shared.fetcher;
}

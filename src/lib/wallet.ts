/** En az ve en çok bakiye yükleme (sent). genaipro.io'daki gibi en az $5. */
export const MIN_TOPUP_CENTS = 500;
export const MAX_TOPUP_CENTS = 100_000;
/** Bakiye yükleme talebinin geçerlilik süresi. */
export const TOPUP_TTL_MS = 60 * 60_000;

/** Benzersiz tutarın ondalık sayısı: USDT (BEP20) 4, Binance Pay 2 (uygulamada güvenle girilebilen). */
export type AmountDecimals = 2 | 4;

/** Ondalık sayısına göre tam sayı birimi metne çevirir (4: 1 birim = 0,0001). */
export function formatUnits(units: number, decimals: AmountDecimals = 4): string {
  const scale = 10 ** decimals;
  const whole = Math.floor(units / scale);
  const frac = String(units % scale).padStart(decimals, "0");
  return `${whole}.${frac}`;
}

/**
 * Paylaşılan tek alıcıda ödemeyi kullanıcıya bağlamak için benzersiz tutar:
 * USD tutarına 4 ondalıkta 0,0001–0,0999, 2 ondalıkta 0,01–0,99 arası ek. Aynı
 * yöntemde bekleyen başka bir talep aynı tutarı kullanıyorsa yeni ek denenir;
 * bulunamazsa null. Eklenen kısım bakiyeye de yazılır (bkz. centsFromAmount).
 */
export function uniqueCryptoAmount(
  cents: number,
  taken: ReadonlySet<string>,
  rand: () => number = Math.random,
  decimals: AmountDecimals = 4,
): string | null {
  const perCent = 10 ** (decimals - 2);
  const span = decimals === 4 ? 999 : 99;
  for (let i = 0; i < 200; i++) {
    const extra = 1 + Math.floor(rand() * span);
    const amount = formatUnits(cents * perCent + extra, decimals);
    if (!taken.has(amount)) return amount;
  }
  return null;
}

/** "10.0347" gibi 4 ondalıklı tutarı, 18 ondalıklı token biriminden (wei) üretilen değerle karşılaştırmak için. */
export function unitsFromWei(wei: bigint): string | null {
  const unit = 10n ** 14n;
  if (wei % unit !== 0n) return null;
  return formatUnits(Number(wei / unit));
}

/**
 * Ondalık tutar metnini (ör. Binance'in "10.37000000"u) istenen ondalığa
 * kayıpsız indirger; o ondalıkta ifade edilemiyorsa (ör. 10.371) null.
 */
export function normalizeAmount(raw: string, decimals: AmountDecimals): string | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  if (!m) return null;
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > decimals) return null;
  return `${BigInt(m[1]!)}.${frac.padEnd(decimals, "0")}`;
}

/** Ödenen tutarın bakiyeye yazılacak karşılığı: sente aşağı yuvarlanır (10.0347 → 1003). */
export function centsFromAmount(amount: string): number {
  const [whole = "0", frac = ""] = amount.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
}

export function balanceCents(entries: { amountCents: number }[]): number {
  return entries.reduce((s, e) => s + e.amountCents, 0);
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

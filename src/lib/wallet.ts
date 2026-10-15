/** En az ve en çok bakiye yükleme (sent). genaipro.io'daki gibi en az $5. */
export const MIN_TOPUP_CENTS = 500;
export const MAX_TOPUP_CENTS = 100_000;
/** Bakiye yükleme talebinin geçerlilik süresi. */
export const TOPUP_TTL_MS = 60 * 60_000;

/** Kripto tutarları 4 ondalıkla ifade edilir: 1 birim = 0,0001 USDT. */
const UNITS_PER_CENT = 100;

export function formatUnits(units: number): string {
  const whole = Math.floor(units / 10_000);
  const frac = String(units % 10_000).padStart(4, "0");
  return `${whole}.${frac}`;
}

/**
 * Paylaşılan tek cüzdan adresinde ödemeyi kullanıcıya bağlamak için benzersiz
 * tutar: USD tutarına 0,0001–0,0999 arası ek. Aynı yöntemde bekleyen başka bir
 * talep aynı tutarı kullanıyorsa yeni ek denenir; bulunamazsa null.
 */
export function uniqueCryptoAmount(
  cents: number,
  taken: ReadonlySet<string>,
  rand: () => number = Math.random,
): string | null {
  for (let i = 0; i < 100; i++) {
    const extra = 1 + Math.floor(rand() * 999);
    const amount = formatUnits(cents * UNITS_PER_CENT + extra);
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

export function balanceCents(entries: { amountCents: number }[]): number {
  return entries.reduce((s, e) => s + e.amountCents, 0);
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

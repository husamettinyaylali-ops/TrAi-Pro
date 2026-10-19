export type CreditKind = "voice" | "media";

export interface Grant {
  id: string;
  kind: CreditKind;
  packageId: string;
  credits: number;
  remaining: number;
  grantedAt: string;
  expiresAt: string;
}

const DAY = 86_400_000;

/** Tek seslendirmede en uzun metin (karakter). */
export const MAX_TTS_CHARS = 50_000;
/**
 * Tek istekte seslendirilen en uzun metin. Daha uzunu cümle sınırlarından
 * parçalara bölünür, arka planda seslendirilip tek dosyada birleştirilir.
 */
export const TTS_CHUNK_CHARS = 5_000;
export const MAX_CLONES = 5;
/** Sesten yazıya: en uzun kayıt (saniye) ve yüklenebilecek en büyük dosya. */
export const STT_MAX_SECONDS = 60 * 60;
export const STT_MIN_SECONDS = 1;
export const STT_MAX_UPLOAD_BYTES = 125 * 1024 * 1024;
/** Yazıya dökme dilleri (ISO 639-1); boş seçim dili otomatik algılatır. */
export const STT_LANGUAGES = [
  "tr",
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "ru",
  "ar",
  "az",
  "ja",
] as const;
export const MEDIA_COST = { image: 1, video: 15 } as const;
/** Tek istekte üretilebilecek görsel sayıları. */
export const IMAGE_COUNTS = [1, 2, 4] as const;
export type MediaType = keyof typeof MEDIA_COST;

export function createGrant(
  input: { id: string; kind: CreditKind; packageId: string; credits: number; days: number },
  now: Date,
): Grant {
  return {
    id: input.id,
    kind: input.kind,
    packageId: input.packageId,
    credits: input.credits,
    remaining: input.credits,
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.days * DAY).toISOString(),
  };
}

export function isActive(g: Grant, now: Date): boolean {
  return g.remaining > 0 && Date.parse(g.expiresAt) > now.getTime();
}

export function balance(grants: Grant[], kind: CreditKind, now: Date): number {
  return grants
    .filter((g) => g.kind === kind && isActive(g, now))
    .reduce((s, g) => s + g.remaining, 0);
}

/** En yakın son kullanma tarihi; aktif kredi yoksa null. */
export function nextExpiry(grants: Grant[], kind: CreditKind, now: Date): string | null {
  const active = grants.filter((g) => g.kind === kind && isActive(g, now));
  if (!active.length) return null;
  return active.reduce(
    (a, g) => (Date.parse(g.expiresAt) < Date.parse(a) ? g.expiresAt : a),
    active[0]!.expiresAt,
  );
}

/** Krediyi süresi en erken dolan paketten başlayarak düşer; bakiye yetmezse null döner. */
export function spend(
  grants: Grant[],
  kind: CreditKind,
  amount: number,
  now: Date,
): Grant[] | null {
  if (amount <= 0) return grants;
  if (balance(grants, kind, now) < amount) return null;
  const order = grants
    .filter((g) => g.kind === kind && isActive(g, now))
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
    .map((g) => g.id);
  let left = amount;
  const taken = new Map<string, number>();
  for (const id of order) {
    if (left === 0) break;
    const g = grants.find((x) => x.id === id)!;
    const take = Math.min(g.remaining, left);
    taken.set(id, take);
    left -= take;
  }
  return grants.map((g) =>
    taken.has(g.id) ? { ...g, remaining: g.remaining - taken.get(g.id)! } : g,
  );
}

/** Metinden ses: boşluklar dahil, baştaki ve sondaki boşluk hariç her karakter 1 kredi. */
export function ttsCost(text: string): number {
  return [...text.trim()].length;
}

/**
 * Sesten yazıya: kaydın her başlayan saniyesi 1 Ses AI kredisi (dakikası 60).
 * Süre sunucuda, dönüştürülen sesten ölçülür.
 */
export function sttCost(seconds: number): number {
  return Math.max(1, Math.ceil(seconds - 1e-6));
}

/**
 * Ses efekti (Ses AI kredisi): süresi seçilen efektte başlayan her saniye 40
 * kredi; süreyi model seçerse 200 kredi. Fiyat yer tutucudur.
 */
export const SFX_CREDITS_PER_SECOND = 40;
export const SFX_AUTO_CREDITS = 200;
export function sfxCost(duration: number | null): number {
  if (duration === null) return SFX_AUTO_CREDITS;
  return Math.max(1, Math.ceil(duration - 1e-6)) * SFX_CREDITS_PER_SECOND;
}

export function mediaCost(type: MediaType, count: number): number {
  return MEDIA_COST[type] * Math.max(0, Math.floor(count));
}

/** 1 USD karşılığı kredi, en yakın tam sayıya yuvarlanır. */
export function creditsPerDollar(credits: number, priceUsd: number): number {
  return Math.round(credits / priceUsd);
}

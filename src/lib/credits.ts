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

export const MAX_TTS_CHARS = 5_000;
export const MAX_CLONES = 5;
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

export function mediaCost(type: MediaType, count: number): number {
  return MEDIA_COST[type] * Math.max(0, Math.floor(count));
}

/** 1 USD karşılığı kredi, en yakın tam sayıya yuvarlanır. */
export function creditsPerDollar(credits: number, priceUsd: number): number {
  return Math.round(credits / priceUsd);
}

export const MINUTE = 60_000;

export interface Limit {
  max: number;
  windowMs: number;
}

/** Kaba kuvvet ve deneme kredisi toplamaya karşı sınırlar. */
export const LIMITS = {
  /** Aynı e-postaya 15 dakikada en fazla 5 başarısız şifre denemesi. */
  signInPerEmail: { max: 5, windowMs: 15 * MINUTE },
  /** Aynı IP'den 15 dakikada en fazla 20 başarısız şifre denemesi. */
  signInPerIp: { max: 20, windowMs: 15 * MINUTE },
  /** Aynı IP'den saatte en fazla 5 kayıt denemesi. */
  signUpPerIp: { max: 5, windowMs: 60 * MINUTE },
} as const satisfies Record<string, Limit>;

export type LimitCheck = { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Pencere içindeki deneme sayısı sınırın altındaysa izin verir. Doluysa, bir
 * deneme hakkı açılması için gereken en eski kaydın pencereden çıkmasına kalan süreyi döner.
 */
export function checkLimit(attempts: string[], limit: Limit, now: Date): LimitCheck {
  const since = now.getTime() - limit.windowMs;
  const recent = attempts
    .map((a) => Date.parse(a))
    .filter((t) => t > since)
    .sort((a, b) => a - b);
  if (recent.length < limit.max) return { allowed: true };
  const mustExpire = recent[recent.length - limit.max]!;
  return { allowed: false, retryAfterMs: mustExpire + limit.windowMs - now.getTime() };
}

/** Kullanıcıya gösterilecek bekleme süresi; en az 1 dakika, yukarı yuvarlanır. */
export const retryMinutes = (ms: number) => Math.max(1, Math.ceil(ms / MINUTE));

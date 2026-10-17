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
  /** Aynı e-postaya saatte en fazla 3 şifre sıfırlama e-postası. */
  resetPerEmail: { max: 3, windowMs: 60 * MINUTE },
  /** Aynı IP'den saatte en fazla 10 şifre sıfırlama isteği. */
  resetPerIp: { max: 10, windowMs: 60 * MINUTE },
  /** Aynı kullanıcıya saatte en fazla 3 doğrulama e-postası. */
  verifyResendPerUser: { max: 3, windowMs: 60 * MINUTE },
  /** Aynı kullanıcı dakikada en fazla 20 seslendirme (ücretli servise yığılmayı önler). */
  ttsPerUser: { max: 20, windowMs: MINUTE },
  /** Aynı kullanıcı 10 dakikada en fazla 30 görsel üretim isteği (ücretli servise yığılmayı önler). */
  imagePerUser: { max: 30, windowMs: 10 * MINUTE },
  /** Aynı kullanıcı saatte en fazla 10 video isteği. */
  videoPerUser: { max: 10, windowMs: 60 * MINUTE },
  /** Bir API anahtarıyla dakikada en fazla 120 istek (üretim sınırları ayrıca geçerlidir). */
  apiPerKey: { max: 120, windowMs: MINUTE },
  /** Aynı kullanıcı saatte en fazla 5 ses klonlama denemesi. */
  clonePerUser: { max: 5, windowMs: 60 * MINUTE },
  /**
   * Aynı kullanıcı saatte en fazla 20 bakiye yükleme talebi: kripto yöntemlerinde her tutar
   * için sınırlı benzersiz kuruş var; talep yağdırarak doldurulmasın.
   */
  topUpPerUser: { max: 20, windowMs: 60 * MINUTE },
  /** Aynı kullanıcı saatte en fazla 20 ödeme doğrulama denemesi (zincir/servis sorgusu). */
  claimPerUser: { max: 20, windowMs: 60 * MINUTE },
  /**
   * Binance Pay kontrolü: panel açıkken 30 sn'de bir otomatik denenir; 1 saatlik
   * talep süresini karşılar. Geçmiş listesi kullanıcılar arasında önbellekten paylaşılır.
   */
  binanceCheckPerUser: { max: 150, windowMs: 60 * MINUTE },
  /** Aynı kullanıcı saatte en fazla 20 PayPal siparişi açar. */
  paypalOrderPerUser: { max: 20, windowMs: 60 * MINUTE },
  /** Kurulum kontrolündeki bağlantı testleri dış servislere gider; yönetici başına 10 dakikada 30. */
  setupTestPerAdmin: { max: 30, windowMs: 10 * MINUTE },
  /** Proje ZIP'i tüm dosyaları okur; kullanıcı başına saatte 20 arşiv. */
  projectZipPerUser: { max: 20, windowMs: 60 * MINUTE },
  /** Düzenleyici (kırpma, birleştirme, görsel kaydı) dosya okuyup yazar; kullanıcı başına saatte 60. */
  editPerUser: { max: 60, windowMs: 60 * MINUTE },
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

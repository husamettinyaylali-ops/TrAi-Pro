/**
 * Ses efekti seçenekleri: süre (saniye; null = süreyi model seçer) ve döngü
 * (kesintisiz tekrar edecek biçimde). Kayıtta `style` sütununda kısa metin
 * olarak durur: "auto", "5", "auto+loop", "2.5+loop".
 */
export interface EffectOptions {
  duration: number | null;
  loop: boolean;
}

/** Sağlayıcının kabul ettiği süre aralığı (saniye). */
export const SFX_MIN_SECONDS = 0.5;
export const SFX_MAX_SECONDS = 30;
/** Yazma kutusundaki süre seçenekleri; null otomatik. */
export const SFX_DURATIONS = [null, 2, 5, 10, 15, 30] as const;
/** Efekt açıklamasının en uzun hali (karakter). */
export const SFX_PROMPT_MAX = 400;

/** Süre geçerli mi: otomatik (null) ya da aralıkta sonlu sayı. */
export const validDuration = (d: number | null) =>
  d === null || (Number.isFinite(d) && d >= SFX_MIN_SECONDS && d <= SFX_MAX_SECONDS);

/** Süre ondalık bire yuvarlanır (sağlayıcıya ve ücrete aynı değer gider). */
export const roundDuration = (d: number | null) => (d === null ? null : Math.round(d * 10) / 10);

export function encodeEffect(o: EffectOptions): string {
  return `${o.duration ?? "auto"}${o.loop ? "+loop" : ""}`;
}

/** Kayıttaki seçenekler; bozuk ya da boşsa otomatik süre, döngüsüz. */
export function decodeEffect(raw: string | null | undefined): EffectOptions {
  const [d = "auto", flag] = (raw ?? "").split("+");
  const n = Number(d);
  return {
    duration: d !== "auto" && validDuration(n) ? n : null,
    loop: flag === "loop",
  };
}

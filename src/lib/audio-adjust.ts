/**
 * Üretim sonrası ücretsiz ses ayarı (yeniden seslendirmeden): hız (perde
 * korunur), ses düzeyi (dB) ve başta/sonda yumuşak geçiş. Sonuç yeni bir
 * sürümdür; altyazı zamanları hıza göre uyarlanır.
 */
export interface AudioAdjust {
  speed: number;
  gainDb: number;
  fade: boolean;
}

export const ADJUST_SPEED_RANGE = [0.75, 1.5] as const;
export const ADJUST_SPEED_STEP = 0.05;
export const ADJUST_GAIN_RANGE = [-6, 6] as const;
/** Yumuşak geçişin süresi (saniye). */
export const ADJUST_FADE_SECONDS = 0.3;

export const NO_ADJUST: AudioAdjust = { speed: 1, gainDb: 0, fade: false };

/** Geçerli mi: hız aralıkta ve 0,05 adımında, ses düzeyi aralıkta tam sayı. */
export function validAdjust(a: AudioAdjust): boolean {
  const [smin, smax] = ADJUST_SPEED_RANGE;
  const [gmin, gmax] = ADJUST_GAIN_RANGE;
  const steps = a.speed / ADJUST_SPEED_STEP;
  return (
    Number.isFinite(a.speed) &&
    a.speed >= smin &&
    a.speed <= smax &&
    Math.abs(steps - Math.round(steps)) < 1e-6 &&
    Number.isInteger(a.gainDb) &&
    a.gainDb >= gmin &&
    a.gainDb <= gmax &&
    typeof a.fade === "boolean"
  );
}

/** Hiçbir şey değişmiyorsa kaydetmeye gerek yok. */
export const isNoAdjust = (a: AudioAdjust) => a.speed === 1 && a.gainDb === 0 && !a.fade;

/** dB → doğrusal kazanç (tarayıcı önizlemesi için). */
export const gainFromDb = (db: number) => 10 ** (db / 20);

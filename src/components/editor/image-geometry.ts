/** Görsel düzenleyicinin hesapları (tuvalden bağımsız, test edilebilir). */

export type Rotation = 0 | 90 | 180 | 270;

/** Kırpma oranları; null özgün oran. */
export const RATIOS = [null, 1, 16 / 9, 9 / 16, 4 / 5] as const;
export type Ratio = (typeof RATIOS)[number];

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
/** Kaydedilen görselin en uzun kenarı. */
export const MAX_OUTPUT_SIDE = 4096;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Döndürülmüş görselin boyutu. */
export function rotatedSize(w: number, h: number, rotation: Rotation): { w: number; h: number } {
  return rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };
}

/** Oranın sığdığı en büyük alan, yakınlaştırmaya göre küçülmüş (döndürülmüş görsel pikselinde). */
export function cropSize(W: number, H: number, ratio: Ratio, zoom: number) {
  let w = W;
  let h = H;
  if (ratio) {
    if (W / H > ratio) w = H * ratio;
    else h = W / ratio;
  }
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  return { w: w / z, h: h / z };
}

/**
 * Kırpma alanı: merkezi (cx, cy; 0–1) verilen, görselin dışına taşmayan
 * dikdörtgen (piksel, tam sayı).
 */
export function cropRect(
  W: number,
  H: number,
  ratio: Ratio,
  zoom: number,
  cx: number,
  cy: number,
): Rect {
  const { w, h } = cropSize(W, H, ratio, zoom);
  const x = clamp(cx * W - w / 2, 0, W - w);
  const y = clamp(cy * H - h / 2, 0, H - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Merkezin geçerli aralığı: kırpma alanı görselin içinde kalır. */
export function clampCenter(
  W: number,
  H: number,
  ratio: Ratio,
  zoom: number,
  cx: number,
  cy: number,
): { cx: number; cy: number } {
  const { w, h } = cropSize(W, H, ratio, zoom);
  return {
    cx: clamp(cx, w / 2 / W, 1 - w / 2 / W),
    cy: clamp(cy, h / 2 / H, 1 - h / 2 / H),
  };
}

/** Çıktı boyutu: kırpılan alan, en uzun kenarı en çok `max` olacak şekilde. */
export function outputSize(w: number, h: number, max = MAX_OUTPUT_SIDE) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Metni verilen genişliğe sığan satırlara böler; satır sonları korunur. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

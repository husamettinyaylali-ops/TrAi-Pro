import { TTS_CHUNK_CHARS } from "./credits";

const len = (s: string) => [...s].length;

/**
 * Sırayla satır, cümle ve kelime sonlarından bölünür; ayırıcı önceki parçada
 * kalır. Rakamdan sonraki nokta ("3. bölüm") cümle sonu sayılmaz.
 */
const SPLITTERS = [/(?<=\n)/u, /(?<=(?:[!?…]|(?<!\d)\.)["'”’»)\]]*\s)/u, /(?<=\s)/u];

/** Birleşince metnin aynısını veren, her biri en çok `max` karakterlik birimler. */
function units(text: string, max: number, level = 0): string[] {
  if (len(text) <= max) return [text];
  const splitter = SPLITTERS[level];
  if (!splitter) {
    // Boşluksuz çok uzun dizi: karakterden bölünür.
    const chars = [...text];
    return Array.from({ length: Math.ceil(chars.length / max) }, (_, i) =>
      chars.slice(i * max, (i + 1) * max).join(""),
    );
  }
  return text.split(splitter).flatMap((part) => units(part, max, level + 1));
}

/**
 * Seslendirme metnini istek başına sınırı aşmayan parçalara böler: önce satır,
 * sonra cümle, en son kelime sınırından. Sınırı aşmayan metin tek parçadır.
 */
export function splitForSpeech(text: string, max = TTS_CHUNK_CHARS): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (len(clean) <= max) return [clean];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    const c = current.trim();
    if (c) chunks.push(c);
    current = "";
  };
  for (const unit of units(clean, max)) {
    if (current && len(current) + len(unit) > max) flush();
    current += unit;
  }
  flush();
  return chunks;
}

/**
 * MP3 (MPEG Layer III) çerçeve okuyucu: uzun seslendirmenin parçalarını tek
 * dosyada birleştirmek için. Baştaki ID3v2 etiketi, Xing/Info/VBRI başlık
 * çerçevesi (parçanın kendi süresini taşır, birleşik dosyada yanlış süre
 * gösterir) ve sondaki ID3v1 ya da yarım çerçeve atılır.
 */

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
/** Sürüm bitlerine göre örnekleme hızları: 3 MPEG-1, 2 MPEG-2, 0 MPEG-2.5. */
const SAMPLE_RATES: Partial<Record<number, number[]>> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

interface Frame {
  length: number;
  samples: number;
  sampleRate: number;
  /** Başlıktan sonraki yan bilgi uzunluğu; Xing/Info etiketi bundan sonra gelir. */
  sideInfo: number;
}

function frameAt(b: Uint8Array, i: number): Frame | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1]! >> 3) & 3;
  const layer = (b[i + 1]! >> 1) & 3;
  const bitrateIndex = b[i + 2]! >> 4;
  const rateIndex = (b[i + 2]! >> 2) & 3;
  const rates = SAMPLE_RATES[version];
  // Yalnız Layer III; serbest ve geçersiz bit hızı kabul edilmez.
  if (!rates || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
    return null;
  }
  const v1 = version === 3;
  const mono = b[i + 3]! >> 6 === 3;
  const bitrate = (v1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex]! * 1000;
  const sampleRate = rates[rateIndex]!;
  const samples = v1 ? 1152 : 576;
  const padding = (b[i + 2]! >> 1) & 1;
  return {
    length: Math.floor(((samples / 8) * bitrate) / sampleRate) + padding,
    samples,
    sampleRate,
    sideInfo: v1 ? (mono ? 17 : 32) : mono ? 9 : 17,
  };
}

function id3Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size =
    ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
  return 10 + size + (b[5]! & 0x10 ? 10 : 0);
}

const tagAt = (b: Uint8Array, i: number, tag: string) =>
  [...tag].every((c, k) => b[i + k] === c.charCodeAt(0));

export interface Mp3Audio {
  /** Yalnız ses çerçeveleri. */
  data: Uint8Array;
  seconds: number;
}

interface Scan {
  /** Ses çerçevelerinin dosyadaki konumu, uzunluğu ve başlangıç zamanı (sn). */
  frames: { at: number; length: number; time: number }[];
  seconds: number;
  sampleRate: number;
  /** İlk ses çerçevesinin başlığı (sessiz çerçeve üretmek için). */
  header: Uint8Array;
}

function scanMp3(bytes: Uint8Array): Scan | null {
  let i = id3Size(bytes);
  const first = frameAt(bytes, i);
  if (!first) return null;
  const tag = i + 4 + first.sideInfo;
  if (tagAt(bytes, tag, "Xing") || tagAt(bytes, tag, "Info") || tagAt(bytes, i + 36, "VBRI")) {
    i += first.length;
  }
  const frames: Scan["frames"] = [];
  let seconds = 0;
  for (let f = frameAt(bytes, i); f && i + f.length <= bytes.length; f = frameAt(bytes, i)) {
    frames.push({ at: i, length: f.length, time: seconds });
    seconds += f.samples / f.sampleRate;
    i += f.length;
  }
  if (!frames.length) return null;
  const at = frames[0]!.at;
  return {
    frames,
    seconds,
    sampleRate: frameAt(bytes, at)!.sampleRate,
    header: bytes.slice(at, at + 4),
  };
}

/** Ses çerçevelerini ve süresini döner; MP3 okunamazsa null. */
export function readMp3(bytes: Uint8Array): Mp3Audio | null {
  const scan = scanMp3(bytes);
  if (!scan) return null;
  const last = scan.frames.at(-1)!;
  return { data: bytes.subarray(scan.frames[0]!.at, last.at + last.length), seconds: scan.seconds };
}

/** Kesimden sonra ses dosyasının biçimi; birleştirilecek dosyalar aynı örnekleme hızında olmalı. */
export const mp3SampleRate = (bytes: Uint8Array) => scanMp3(bytes)?.sampleRate ?? null;

/**
 * [from, to) aralığına (sn) değen çerçeveler, yeniden kodlamadan (kayıpsız).
 * Kesim çerçeve sınırına (MP3'te ~26 ms) yuvarlanır; `offset` kesimin
 * gerçek başlangıcı, `total` dosyanın tüm süresidir. Aralıkta çerçeve yoksa
 * ya da dosya okunamazsa null.
 */
export function sliceMp3(
  bytes: Uint8Array,
  from: number,
  to: number,
): (Mp3Audio & { offset: number; total: number }) | null {
  const scan = scanMp3(bytes);
  if (!scan) return null;
  // Çerçeve zamanları toplanarak bulunur; tam sınırdaki kayan nokta farkı çerçeve eklemesin.
  const eps = 1e-6;
  const picked = scan.frames.filter(
    (f, k) => f.time < to - eps && (scan.frames[k + 1]?.time ?? scan.seconds) > from + eps,
  );
  if (!picked.length) return null;
  const first = picked[0]!;
  const last = picked.at(-1)!;
  const end = scan.frames[scan.frames.indexOf(last) + 1]?.time ?? scan.seconds;
  return {
    data: bytes.subarray(first.at, last.at + last.length),
    seconds: end - first.time,
    offset: first.time,
    total: scan.seconds,
  };
}

/**
 * Verilen dosyanın biçiminde (aynı başlık, dolgusuz) sessiz çerçeveler: yan
 * bilgi ve ses verisi sıfır olan Layer III çerçevesi sessizlik olarak çözülür.
 * Süre çerçeve sınırına yuvarlanır.
 */
export function silenceLike(bytes: Uint8Array, seconds: number): Mp3Audio | null {
  const scan = scanMp3(bytes);
  if (!scan) return null;
  const header = scan.header.slice();
  // CRC yok (sıfır CRC geçersiz olurdu) ve dolgu yok: her çerçeve aynı uzunlukta.
  header[1] = header[1]! | 0x01;
  header[2] = header[2]! & ~0x02;
  const frame = frameAt(header, 0)!;
  const count = Math.max(0, Math.round((seconds * frame.sampleRate) / frame.samples));
  const one = new Uint8Array(frame.length);
  one.set(header);
  return {
    data: concatBytes(Array.from({ length: count }, () => one)),
    seconds: (count * frame.samples) / frame.sampleRate,
  };
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

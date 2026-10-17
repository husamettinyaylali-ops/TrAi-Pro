import { STT_MAX_SECONDS, STT_MAX_UPLOAD_BYTES, STT_MIN_SECONDS } from "./credits";

/**
 * Sesten yazıya yüklemesi tarayıcıda hazırlanır: dosyanın sesi çözülüp süresi
 * ölçülür (ücret gönderilmeden önce görünür). Küçük dosya olduğu gibi gider;
 * büyük dosyanın (çoğu zaman video) yalnız sesi 16 kHz mono WAV olarak gider,
 * yükleme onlarca kat küçülür. Sunucu her durumda dosyayı kendisi dönüştürüp
 * süreyi yeniden ölçer.
 */

/** Bu boyuta kadar dosya olduğu gibi yüklenir (ses kalitesi korunur). */
export const DIRECT_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Tarayıcının belleğe okuyabileceği en büyük kaynak dosya. */
export const MAX_SOURCE_BYTES = 1024 * 1024 * 1024;
/** Konuşma tanıma için yeterli örnekleme hızı. */
export const UPLOAD_SAMPLE_RATE = 16_000;

export type PrepareError = "tooLarge" | "unreadable" | "tooShort" | "tooLong";

export class PrepareFailure extends Error {
  constructor(readonly code: PrepareError) {
    super(code);
    this.name = "PrepareFailure";
  }
}

export interface PreparedUpload {
  /** Sunucuya gidecek dosya: özgün dosya ya da çıkarılan ses (WAV). */
  upload: Blob;
  seconds: number;
}

/** Kanalların ortalaması (mono), 16 bit PCM WAV. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const length = channels[0]?.length ?? 0;
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, length * 2, true);
  const n = channels.length || 1;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i] ?? 0;
    const v = Math.max(-1, Math.min(1, sum / n));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

/** Ses çözücü: tarayıcıda OfflineAudioContext; testlerde sahtesi verilir. */
export type AudioDecoder = (
  data: ArrayBuffer,
  sampleRate: number,
) => Promise<{ duration: number; channels: Float32Array[] }>;

const browserDecoder: AudioDecoder = async (data, sampleRate) => {
  // Çözülen ses bağlamın örnekleme hızına dönüştürülür.
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const audio = await ctx.decodeAudioData(data);
  return {
    duration: audio.duration,
    channels: Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)),
  };
};

/** Yüklemeyi hazırlar; dosya çok büyük, okunamaz, çok kısa ya da uzunsa PrepareFailure. */
export async function prepareUpload(
  file: Blob,
  decode: AudioDecoder = browserDecoder,
): Promise<PreparedUpload> {
  if (file.size > MAX_SOURCE_BYTES) throw new PrepareFailure("tooLarge");
  let decoded: Awaited<ReturnType<AudioDecoder>>;
  try {
    decoded = await decode(await file.arrayBuffer(), UPLOAD_SAMPLE_RATE);
  } catch {
    throw new PrepareFailure("unreadable");
  }
  const seconds = decoded.duration;
  if (!Number.isFinite(seconds) || seconds < STT_MIN_SECONDS) throw new PrepareFailure("tooShort");
  if (seconds > STT_MAX_SECONDS) throw new PrepareFailure("tooLong");
  if (file.size <= DIRECT_UPLOAD_BYTES) return { upload: file, seconds };
  const wav = encodeWav(decoded.channels, UPLOAD_SAMPLE_RATE);
  if (wav.size > STT_MAX_UPLOAD_BYTES) throw new PrepareFailure("tooLong");
  return { upload: wav, seconds };
}

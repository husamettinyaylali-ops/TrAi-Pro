/** Ses zarfının çözünürlüğü: saniyede 100 pencere (10 ms). */
export const ENVELOPE_HZ = 100;

/** Bu boyutun üstündeki ses tarayıcıda çözülmez (bellek); dalga çizilmez, kırpma yine çalışır. */
export const MAX_ANALYZE_BYTES = 24 * 1024 * 1024;

/** Her 10 ms pencerede kanallardaki en büyük mutlak genlik (0–1). */
export function envelope(
  channels: Float32Array[],
  sampleRate: number,
  hz = ENVELOPE_HZ,
): Float32Array {
  const win = Math.max(1, Math.round(sampleRate / hz));
  const len = channels[0]?.length ?? 0;
  const out = new Float32Array(Math.ceil(len / win));
  for (let w = 0; w < out.length; w++) {
    const end = Math.min(len, (w + 1) * win);
    let peak = 0;
    for (const ch of channels) {
      for (let i = w * win; i < end; i++) {
        const v = Math.abs(ch[i]!);
        if (v > peak) peak = v;
      }
    }
    out[w] = peak;
  }
  return out;
}

/** Çizim için `bars` sütuna indirgenmiş tepeler; en yükseği 1 olacak şekilde ölçeklenir. */
export function bucketPeaks(env: Float32Array, bars: number): number[] {
  const out: number[] = [];
  let max = 0;
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((b * env.length) / bars);
    const to = Math.max(from + 1, Math.floor(((b + 1) * env.length) / bars));
    let peak = 0;
    for (let i = from; i < to && i < env.length; i++) peak = Math.max(peak, env[i]!);
    out.push(peak);
    max = Math.max(max, peak);
  }
  return max > 0 ? out.map((v) => v / max) : out;
}

/**
 * Baştaki ve sondaki sessizliğin sınırları (ms). Eşik en yüksek tepenin
 * %4'ü (en az 0,01); konuşma kesilmesin diye başta 120 ms, sonda 200 ms pay
 * bırakılır. Hiç ses yoksa null.
 */
export function silenceBounds(
  env: Float32Array,
  hz = ENVELOPE_HZ,
): { start: number; end: number } | null {
  let max = 0;
  for (const v of env) max = Math.max(max, v);
  const threshold = Math.max(0.01, max * 0.04);
  const first = env.findIndex((v) => v > threshold);
  if (first < 0) return null;
  let last = env.length - 1;
  while (last > first && env[last]! <= threshold) last--;
  const ms = 1000 / hz;
  return {
    start: Math.max(0, Math.round(first * ms - 120)),
    end: Math.min(Math.round(env.length * ms), Math.round((last + 1) * ms + 200)),
  };
}

/** Sesi düşük örnekleme hızında (8 kHz) çözüp zarfını çıkarır; desteklenmez ya da çok büyükse null. */
export async function analyzeAudio(
  url: string,
  signal?: AbortSignal,
): Promise<Float32Array | null> {
  if (typeof OfflineAudioContext === "undefined") return null;
  const res = await fetch(url, { signal: signal ?? null });
  if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_ANALYZE_BYTES) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_ANALYZE_BYTES) return null;
  const audio = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(buf);
  return envelope(
    Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)),
    audio.sampleRate,
  );
}

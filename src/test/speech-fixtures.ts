import type { SpeechAlignment } from "@/server/captions.server";

/** MPEG-1 Layer III, 128 kbps, 44,1 kHz, ortak stereo: dolgusuz çerçeve 417 bayt, 1152 örnek. */
export const FRAME_BYTES = 417;
export const FRAME_SECONDS = 1152 / 44_100;

const header = [0xff, 0xfb, 0x90, 0x44];

/** Test için MP3: `frames` ses çerçevesi; istenirse önde ID3v2 etiketi ve Xing/Info çerçevesi. */
export function mp3Frames(
  frames: number,
  opts: { id3?: boolean; info?: boolean } = {},
): Uint8Array {
  const frame = (fill: number) => {
    const f = new Uint8Array(FRAME_BYTES).fill(fill);
    f.set(header);
    return f;
  };
  const parts: Uint8Array[] = [];
  if (opts.id3) parts.push(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]));
  if (opts.info) {
    const info = frame(0);
    // MPEG-1 stereo: yan bilgi 32 bayt; etiket başlıktan sonra.
    info.set([0x49, 0x6e, 0x66, 0x6f], 4 + 32);
    parts.push(info);
  }
  for (let i = 0; i < frames; i++) parts.push(frame(i % 200));
  // Sonda yarım çerçeve ve ID3v1 benzeri artık.
  parts.push(new Uint8Array([0x54, 0x41, 0x47, 1, 2, 3]));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Her karakter `perChar` saniye süren sahte zamanlama. */
export function fakeAlignment(text: string, perChar = 0.05): SpeechAlignment {
  const characters = [...text];
  return {
    characters,
    starts: characters.map((_, i) => Number((i * perChar).toFixed(3))),
    ends: characters.map((_, i) => Number(((i + 1) * perChar).toFixed(3))),
  };
}

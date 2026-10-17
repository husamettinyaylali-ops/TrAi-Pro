// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  DIRECT_UPLOAD_BYTES,
  MAX_SOURCE_BYTES,
  PrepareFailure,
  UPLOAD_SAMPLE_RATE,
  encodeWav,
  prepareUpload,
  type AudioDecoder,
} from "@/lib/audio-upload";

/** Boyutu taklit edilen dosya: içerik okunmaz, yalnız `size` ve `arrayBuffer` kullanılır. */
const fakeFile = (size: number) =>
  ({ size, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as Blob;

const decoder =
  (seconds: number, channels = 2): AudioDecoder =>
  async (_data, rate) => ({
    duration: seconds,
    channels: Array.from({ length: channels }, (_, c) =>
      new Float32Array(Math.round(seconds * rate)).fill(c === 0 ? 0.5 : -0.25),
    ),
  });

describe("yükleme hazırlığı", () => {
  it("WAV: 16 bit mono PCM başlığı; kanallar ortalanır, taşma kırpılır", async () => {
    const wav = encodeWav(
      [new Float32Array([0.5, 1, -1, 2]), new Float32Array([-0.5, 1, -1, 2])],
      16_000,
    );
    const v = new DataView(await wav.arrayBuffer());
    const text = (at: number) => String.fromCharCode(...new Uint8Array(v.buffer.slice(at, at + 4)));
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(v.getUint32(4, true)).toBe(36 + 8);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(28, true)).toBe(32_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([
      0, 32767, -32768, 32767,
    ]);
    expect(wav.type).toBe("audio/wav");
  });

  it("küçük dosya olduğu gibi, büyük dosyanın yalnız sesi (16 kHz mono WAV) gider", async () => {
    const small = fakeFile(1024);
    expect(await prepareUpload(small, decoder(12.5))).toEqual({ upload: small, seconds: 12.5 });

    const big = await prepareUpload(fakeFile(DIRECT_UPLOAD_BYTES + 1), decoder(2));
    expect(big.seconds).toBe(2);
    expect(big.upload.type).toBe("audio/wav");
    expect(big.upload.size).toBe(44 + 2 * UPLOAD_SAMPLE_RATE * 2);
  });

  it("çok büyük, okunamayan, çok kısa ya da uzun kayıt nedeniyle reddedilir", async () => {
    const code = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: unknown) => (e instanceof PrepareFailure ? e.code : String(e)),
      );
    expect(await code(prepareUpload(fakeFile(MAX_SOURCE_BYTES + 1), decoder(5)))).toBe("tooLarge");
    const broken: AudioDecoder = async () => {
      throw new Error("EncodingError");
    };
    expect(await code(prepareUpload(fakeFile(10), broken))).toBe("unreadable");
    expect(await code(prepareUpload(fakeFile(10), decoder(0.4)))).toBe("tooShort");
    expect(await code(prepareUpload(fakeFile(10), decoder(3601, 0)))).toBe("tooLong");
  });
});

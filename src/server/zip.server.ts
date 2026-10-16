import { crc32 } from "node:zlib";

/** Arşive girecek dosya; içerik sırası gelince okunur (bellekte tek dosya durur). */
export interface ZipEntry {
  name: string;
  data: () => Promise<Uint8Array | null>;
}

/** ZIP64 kullanılmaz; arşiv bu boyutu aşacaksa kalan dosyalar atlanır. */
export const MAX_ZIP_BYTES = 0xffff_ffff - 64 * 1024 * 1024;

const UTF8_NAMES = 0x0800;

const istanbul = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

/** MS-DOS tarih/saat alanları, İstanbul saatiyle (ZIP biçimi saniyeyi 2'ye böler). */
export function dosTime(d: Date): { time: number; date: number } {
  const p = Object.fromEntries(
    istanbul.formatToParts(d).map((x) => [x.type, Number(x.value)] as const),
  ) as Record<string, number>;
  return {
    time: (p["hour"]! << 11) | (p["minute"]! << 5) | Math.floor(p["second"]! / 2),
    date: ((p["year"]! - 1980) << 9) | (p["month"]! << 5) | p["day"]!,
  };
}

function header(size: number, fill: (v: DataView) => void): Uint8Array {
  const buf = new Uint8Array(size);
  fill(new DataView(buf.buffer));
  return buf;
}

/**
 * Sıkıştırmasız (stored) ZIP akışı. Medya dosyaları (mp3, jpg, mp4) zaten
 * sıkıştırılmış olduğu için deflate kazandırmaz. `onSkip` boyut sınırı ya da
 * okunamayan dosya için çağrılır; `trailer` atlananlar belli olduktan sonra
 * en sona eklenecek dosyayı (ör. içerik listesi) üretir.
 */
export function zipStream(
  entries: ZipEntry[],
  now: Date,
  trailer?: (skipped: string[]) => ZipEntry,
): ReadableStream<Uint8Array> {
  const { time, date } = dosTime(now);
  const encoder = new TextEncoder();
  const central: Uint8Array[] = [];
  const skipped: string[] = [];
  let offset = 0;
  let index = 0;
  let trailerDone = !trailer;

  const addEntry = (name: string, data: Uint8Array): Uint8Array[] => {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data) >>> 0;
    const local = header(30, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true); // gereken sürüm
      v.setUint16(6, UTF8_NAMES, true);
      v.setUint16(8, 0, true); // stored
      v.setUint16(10, time, true);
      v.setUint16(12, date, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, data.byteLength, true);
      v.setUint32(22, data.byteLength, true);
      v.setUint16(26, nameBytes.byteLength, true);
      v.setUint16(28, 0, true);
    });
    central.push(
      header(46, (v) => {
        v.setUint32(0, 0x02014b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 20, true);
        v.setUint16(8, UTF8_NAMES, true);
        v.setUint16(10, 0, true);
        v.setUint16(12, time, true);
        v.setUint16(14, date, true);
        v.setUint32(16, crc, true);
        v.setUint32(20, data.byteLength, true);
        v.setUint32(24, data.byteLength, true);
        v.setUint16(28, nameBytes.byteLength, true);
        v.setUint32(42, offset, true);
      }),
      nameBytes,
    );
    offset += local.byteLength + nameBytes.byteLength + data.byteLength;
    return [local, nameBytes, data];
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Sıradaki okunabilen dosyayı yaz; yoksa içerik listesini, sonra dizini.
      while (index < entries.length) {
        const entry = entries[index++]!;
        const data = await entry.data().catch(() => null);
        if (!data || offset + data.byteLength + 1024 > MAX_ZIP_BYTES) {
          skipped.push(entry.name);
          continue;
        }
        for (const part of addEntry(entry.name, data)) controller.enqueue(part);
        return;
      }
      if (!trailerDone) {
        trailerDone = true;
        const last = trailer!(skipped);
        const data = await last.data();
        if (data) for (const part of addEntry(last.name, data)) controller.enqueue(part);
        return;
      }
      const dirSize = central.reduce((n, b) => n + b.byteLength, 0);
      const count = central.length / 2;
      for (const part of central) controller.enqueue(part);
      controller.enqueue(
        header(22, (v) => {
          v.setUint32(0, 0x06054b50, true);
          v.setUint16(8, count, true);
          v.setUint16(10, count, true);
          v.setUint32(12, dirSize, true);
          v.setUint32(16, offset, true);
        }),
      );
      controller.close();
    },
  });
}

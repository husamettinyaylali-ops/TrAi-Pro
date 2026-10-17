// @vitest-environment node
import { describe, expect, it } from "vitest";

import { splitForSpeech } from "@/lib/speech-text";
import {
  CAPTION_LINE,
  buildCues,
  encodeCues,
  parseCues,
  toSrt,
  toVtt,
} from "@/server/captions.server";
import { concatBytes, readMp3 } from "@/server/mp3.server";

import { FRAME_BYTES, FRAME_SECONDS, fakeAlignment, mp3Frames } from "./speech-fixtures";

const len = (s: string) => [...s].length;
const words = (s: string) => s.split(/\s+/).filter(Boolean);

describe("uzun metni bölme", () => {
  it("sınırı aşmayan metin tek parça, baş ve sondaki boşluk atılır; boş metin parçasız", () => {
    expect(splitForSpeech("  Merhaba dünya.  ", 50)).toEqual(["Merhaba dünya."]);
    expect(splitForSpeech("   ", 50)).toEqual([]);
  });

  it("cümle sınırından böler; parçalar sınırı aşmaz, kelime kaybolmaz", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Bu ${i + 1}. deneme cümlesidir.`).join(" ");
    const chunks = splitForSpeech(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(len(c)).toBeLessThanOrEqual(60);
      expect(c).toMatch(/cümlesidir\.$/);
    }
    expect(words(chunks.join(" "))).toEqual(words(text));
  });

  it("önce satır sonundan böler", () => {
    const text = "Birinci paragraf burada bitiyor.\nİkinci paragraf da burada bitiyor.";
    expect(splitForSpeech(text, 40)).toEqual([
      "Birinci paragraf burada bitiyor.",
      "İkinci paragraf da burada bitiyor.",
    ]);
  });

  it("noktasız uzun cümle kelimeden, boşluksuz dizi karakterden bölünür; çok baytlı karakter bölünmez", () => {
    const sentence = Array.from({ length: 30 }, () => "kelime").join(" ");
    for (const c of splitForSpeech(sentence, 40)) expect(len(c)).toBeLessThanOrEqual(40);
    expect(words(splitForSpeech(sentence, 40).join(" "))).toEqual(words(sentence));

    const blob = "😀".repeat(25);
    const parts = splitForSpeech(blob, 10);
    expect(parts.map(len)).toEqual([10, 10, 5]);
    expect(parts.join("")).toBe(blob);
  });
});

describe("MP3 okuyucu", () => {
  it("ses çerçevelerini sayar; ID3, Info çerçevesi ve sondaki artık atılır", () => {
    const plain = readMp3(mp3Frames(10));
    expect(plain?.data.byteLength).toBe(10 * FRAME_BYTES);
    expect(plain?.seconds).toBeCloseTo(10 * FRAME_SECONDS, 6);

    const tagged = readMp3(mp3Frames(10, { id3: true, info: true }));
    expect(tagged?.data.byteLength).toBe(10 * FRAME_BYTES);
    expect([...tagged!.data.subarray(0, 4)]).toEqual([0xff, 0xfb, 0x90, 0x44]);
  });

  it("MP3 olmayan veri null; birleştirme baytları sırayla ekler", () => {
    expect(readMp3(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(readMp3(new Uint8Array([0x49, 0x44, 0x33, 1]))).toBeNull();
    expect([...concatBytes([new Uint8Array([1, 2]), new Uint8Array([3])])]).toEqual([1, 2, 3]);
  });
});

describe("altyazı", () => {
  it("cümle sonunda yeni altyazı; zamanlar kelimelerin başı ve sonu", () => {
    const text = "Merhaba arkadaşlar, hoş geldiniz. Bugün yapay zekayı konuşacağız.";
    const cues = buildCues([{ alignment: fakeAlignment(text, 0.05), offset: 0 }]);
    expect(cues.map((c) => c.text)).toEqual([
      "Merhaba arkadaşlar, hoş geldiniz.",
      "Bugün yapay zekayı konuşacağız.",
    ]);
    expect(cues[0]).toMatchObject({ start: 0, end: 1650 });
    expect(cues[1]!.start).toBe(1700);
  });

  it("satır sonu yeni altyazı başlatır; uzun altyazı iki satıra, en çok 84 karaktere bölünür", () => {
    const long = Array.from({ length: 40 }, (_, i) => `söz${i}`).join(" ");
    const cues = buildCues([{ alignment: fakeAlignment(`Başlık\n${long}`, 0.01), offset: 0 }]);
    expect(cues[0]!.text).toBe("Başlık");
    for (const c of cues.slice(1)) {
      const lines = c.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(len(c.text)).toBeLessThanOrEqual(CAPTION_LINE * 2 + 1);
      if (len(c.text) > CAPTION_LINE) expect(lines).toHaveLength(2);
    }
    expect(cues.slice(1).flatMap((c) => c.text.split(/\s+/))).toEqual(long.split(" "));
  });

  it("bir altyazı 6 saniyeyi aşmaz; kısa altyazı en az 1 sn kalır ama sonrakine taşmaz", () => {
    const slow = buildCues([
      { alignment: fakeAlignment("bir iki üç dört beş altı yedi", 0.5), offset: 0 },
    ]);
    for (const c of slow) expect(c.end - c.start).toBeLessThanOrEqual(6_000);
    expect(slow.length).toBeGreaterThan(1);

    const quick = buildCues([
      { alignment: fakeAlignment("Evet, kesinlikle doğru bir karar.", 0.01), offset: 0 },
      { alignment: fakeAlignment("Sonra.", 0.01), offset: 0.5 },
    ]);
    expect(quick[0]!.end).toBe(500);
    expect(quick[1]).toMatchObject({ start: 500, end: 1500 });
  });

  it("ikinci parçanın zamanları birleşik dosyadaki başlangıcı kadar kayar", () => {
    const cues = buildCues([
      { alignment: fakeAlignment("Birinci parça burada bitiyor.", 0.05), offset: 0 },
      { alignment: fakeAlignment("İkinci parça burada başlıyor.", 0.05), offset: 10 },
    ]);
    expect(cues.map((c) => c.start)).toEqual([0, 10_000]);
  });

  it("SRT ve WebVTT biçimi; VTT'de özel karakterler kaçırılır", () => {
    const cues = [
      { start: 0, end: 1500, text: "Merhaba" },
      { start: 3_661_001, end: 3_662_500, text: "A <b> & B\nikinci satır" },
    ];
    expect(toSrt(cues)).toBe(
      "1\r\n00:00:00,000 --> 00:00:01,500\r\nMerhaba\r\n\r\n" +
        "2\r\n01:01:01,001 --> 01:01:02,500\r\nA <b> & B\r\nikinci satır\r\n",
    );
    expect(toVtt(cues)).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nMerhaba\n\n" +
        "01:01:01.001 --> 01:01:02.500\nA &lt;b&gt; &amp; B\nikinci satır\n",
    );
  });

  it("depodaki altyazı geri okunur; bozuk dosya null", () => {
    const cues = [{ start: 0, end: 1000, text: "Merhaba" }];
    expect(parseCues(encodeCues(cues))).toEqual(cues);
    expect(parseCues(new TextEncoder().encode("{bozuk"))).toBeNull();
    expect(parseCues(new TextEncoder().encode('{"cues":[{"start":"0"}]}'))).toBeNull();
  });
});

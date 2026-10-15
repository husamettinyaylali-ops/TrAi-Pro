import { describe, expect, it } from "vitest";

import {
  balanceCents,
  centsFromAmount,
  formatCents,
  formatUnits,
  normalizeAmount,
  uniqueCryptoAmount,
  unitsFromWei,
} from "@/lib/wallet";

describe("benzersiz kripto tutarı", () => {
  it("USD tutarına 0,0001–0,0999 arası ek yapılır", () => {
    expect(uniqueCryptoAmount(1_000, new Set(), () => 0)).toBe("10.0001");
    expect(uniqueCryptoAmount(1_000, new Set(), () => 0.9999)).toBe("10.0999");
    expect(uniqueCryptoAmount(550, new Set(), () => 0.5)).toBe("5.5500");
  });

  it("bekleyen talepteki tutar tekrar verilmez", () => {
    const seq = [0, 0, 0.5];
    let i = 0;
    const rand = () => seq[i++ % seq.length]!;
    expect(uniqueCryptoAmount(1_000, new Set(["10.0001"]), rand)).toBe("10.0500");
  });

  it("tüm ekler doluysa null", () => {
    const taken = new Set(Array.from({ length: 999 }, (_, k) => formatUnits(100_000 + k + 1)));
    expect(uniqueCryptoAmount(1_000, taken)).toBeNull();
  });
});

describe("birim dönüşümleri", () => {
  it("4 ondalık biçim", () => {
    expect(formatUnits(100_347)).toBe("10.0347");
    expect(formatUnits(5)).toBe("0.0005");
  });

  it("18 ondalıklı token tutarı 4 ondalığa çevrilir; daha hassas değer eşleşmez", () => {
    expect(unitsFromWei(10_034_700_000_000_000_000n)).toBe("10.0347");
    expect(unitsFromWei(10_034_700_000_000_000_001n)).toBeNull();
  });

  it("bakiye toplamı ve sent biçimi", () => {
    expect(
      balanceCents([{ amountCents: 1_000 }, { amountCents: -800 }, { amountCents: 500 }]),
    ).toBe(700);
    expect(formatCents(2_200)).toBe("22.00");
  });
});

describe("Binance Pay tutarları ve bakiyeye yazılan karşılık", () => {
  it("2 ondalıkta 0,01–0,99 arası ek", () => {
    expect(uniqueCryptoAmount(1_000, new Set(), () => 0, 2)).toBe("10.01");
    expect(uniqueCryptoAmount(1_000, new Set(), () => 0.9999, 2)).toBe("10.99");
    expect(
      uniqueCryptoAmount(
        1_000,
        new Set(["10.01"]),
        (() => {
          let i = 0;
          return () => [0, 0.5][i++ % 2]!;
        })(),
        2,
      ),
    ).toBe("10.50");
  });

  it("servisin tutar metni kayıpsız indirgenir; daha hassas tutar eşleşmez", () => {
    expect(normalizeAmount("10.37000000", 2)).toBe("10.37");
    expect(normalizeAmount("10.3", 2)).toBe("10.30");
    expect(normalizeAmount("10", 4)).toBe("10.0000");
    expect(normalizeAmount("10.371", 2)).toBeNull();
    expect(normalizeAmount("-1", 2)).toBeNull();
  });

  it("ödenen tutar sente aşağı yuvarlanarak bakiyeye yazılır", () => {
    expect(centsFromAmount("10.0347")).toBe(1_003);
    expect(centsFromAmount("10.37")).toBe(1_037);
    expect(centsFromAmount("5.0001")).toBe(500);
  });
});

import { describe, expect, it } from "vitest";

import {
  balance,
  createGrant,
  creditsPerDollar,
  mediaCost,
  nextExpiry,
  sfxCost,
  spend,
  sttCost,
  ttsCost,
} from "@/lib/credits";
import { safeRedirect } from "@/lib/redirect";

const now = new Date("2026-10-15T09:00:00Z");
const later = (days: number) => new Date(now.getTime() + days * 86_400_000);

describe("kredi paketleri", () => {
  it("paket süresi gün olarak eklenir", () => {
    const g = createGrant(
      { id: "a", kind: "voice", packageId: "voice-250k", credits: 250_000, days: 30 },
      now,
    );
    expect(g.remaining).toBe(250_000);
    expect(g.expiresAt).toBe("2026-11-14T09:00:00.000Z");
  });

  it("bakiye yalnız aynı türdeki süresi dolmamış paketleri sayar", () => {
    const grants = [
      createGrant({ id: "v", kind: "voice", packageId: "x", credits: 1_000, days: 30 }, now),
      createGrant({ id: "m", kind: "media", packageId: "y", credits: 100, days: 2 }, now),
    ];
    expect(balance(grants, "voice", now)).toBe(1_000);
    expect(balance(grants, "media", now)).toBe(100);
    expect(balance(grants, "media", later(3))).toBe(0);
  });

  it("harcama önce süresi en erken dolan paketten düşer", () => {
    const grants = [
      createGrant({ id: "long", kind: "voice", packageId: "x", credits: 500, days: 30 }, now),
      createGrant({ id: "short", kind: "voice", packageId: "x", credits: 300, days: 7 }, now),
    ];
    const after = spend(grants, "voice", 400, now)!;
    expect(after.find((g) => g.id === "short")!.remaining).toBe(0);
    expect(after.find((g) => g.id === "long")!.remaining).toBe(400);
    expect(balance(after, "voice", now)).toBe(400);
  });

  it("bakiye yetmezse harcama yapılmaz", () => {
    const grants = [
      createGrant({ id: "a", kind: "media", packageId: "x", credits: 4, days: 2 }, now),
    ];
    expect(spend(grants, "media", 5, now)).toBeNull();
    expect(spend(grants, "media", 5, later(1))).toBeNull();
  });

  it("en yakın son kullanma tarihi bulunur", () => {
    const grants = [
      createGrant({ id: "a", kind: "voice", packageId: "x", credits: 10, days: 30 }, now),
      createGrant({ id: "b", kind: "voice", packageId: "x", credits: 10, days: 7 }, now),
    ];
    expect(nextExpiry(grants, "voice", now)).toBe("2026-10-22T09:00:00.000Z");
    expect(nextExpiry(grants, "media", now)).toBeNull();
  });
});

describe("maliyet", () => {
  it("metinden seste karakter başına 1 kredi, kenar boşlukları sayılmaz", () => {
    expect(ttsCost("  Merhaba dünya  ")).toBe(13);
    expect(ttsCost("")).toBe(0);
  });

  it("sesten yazıda kaydın başlayan her saniyesi 1 kredi, en az 1", () => {
    expect(sttCost(0.4)).toBe(1);
    expect(sttCost(60)).toBe(60);
    expect(sttCost(60.2)).toBe(61);
    expect(sttCost(3600)).toBe(3600);
  });

  it("ses efektinde başlayan her saniye 40 kredi; süreyi model seçerse 200", () => {
    expect(sfxCost(null)).toBe(200);
    expect(sfxCost(0.5)).toBe(40);
    expect(sfxCost(5)).toBe(200);
    expect(sfxCost(5.2)).toBe(240);
    expect(sfxCost(30)).toBe(1_200);
  });

  it("görsel 1, video 15 kredi", () => {
    expect(mediaCost("image", 4)).toBe(4);
    expect(mediaCost("video", 1)).toBe(15);
  });

  it("1 USD karşılığı kredi", () => {
    expect(creditsPerDollar(250_000, 8)).toBe(31_250);
    expect(creditsPerDollar(1_000_000, 22)).toBe(45_455);
  });
});

describe("yönlendirme", () => {
  it("yalnız site içi yolları kabul eder", () => {
    expect(safeRedirect("/payment?package=voice-1m")).toBe("/payment?package=voice-1m");
    expect(safeRedirect("https://evil.example")).toBe("/labs");
    expect(safeRedirect("//evil.example")).toBe("/labs");
    expect(safeRedirect("/\\evil.example")).toBe("/labs");
    expect(safeRedirect(undefined)).toBe("/labs");
  });
});

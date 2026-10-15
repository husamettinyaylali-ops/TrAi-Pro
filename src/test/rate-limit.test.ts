import { describe, expect, it } from "vitest";

import { MINUTE, checkLimit, retryMinutes } from "@/lib/rate-limit";

const now = new Date("2026-10-15T09:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * MINUTE).toISOString();
const limit = { max: 3, windowMs: 15 * MINUTE };

describe("deneme sınırı", () => {
  it("sınırın altında izin verir", () => {
    expect(checkLimit([ago(1), ago(2)], limit, now)).toEqual({ allowed: true });
  });

  it("pencere dışındaki denemeler sayılmaz", () => {
    expect(checkLimit([ago(16), ago(20), ago(1), ago(2)], limit, now)).toEqual({ allowed: true });
  });

  it("sınır doluysa en eski denemenin pencereden çıkmasına kalan süreyi verir", () => {
    const res = checkLimit([ago(10), ago(4), ago(1)], limit, now);
    expect(res).toEqual({ allowed: false, retryAfterMs: 5 * MINUTE });
  });

  it("sınırın üstündeyse yeni hak için gereken kaydı esas alır", () => {
    // 5 deneme, sınır 3: bir hak için en eski 3 kaydın çıkması gerekir → 3. en eski (8 dk önce).
    const res = checkLimit([ago(12), ago(10), ago(8), ago(3), ago(1)], limit, now);
    expect(res).toEqual({ allowed: false, retryAfterMs: 7 * MINUTE });
  });

  it("bekleme süresi dakikaya yukarı yuvarlanır, en az 1 dakika", () => {
    expect(retryMinutes(5 * MINUTE)).toBe(5);
    expect(retryMinutes(5 * MINUTE + 1)).toBe(6);
    expect(retryMinutes(10)).toBe(1);
  });
});

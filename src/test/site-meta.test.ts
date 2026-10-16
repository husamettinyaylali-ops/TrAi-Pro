// @vitest-environment node
import { describe, expect, it } from "vitest";

import { robotsTxt, sitemapXml, withSecurityHeaders } from "@/server/site-meta.server";

describe("site meta", () => {
  it("güvenlik başlıkları eklenir; yanıtın kendi başlığı korunur", async () => {
    const res = withSecurityHeaders(
      new Response("x", { headers: { "x-frame-options": "SAMEORIGIN" } }),
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(await res.text()).toBe("x");

    // Değiştirilemeyen başlıklı yanıt kopyalanır.
    const locked = Response.redirect("https://example.com/", 302);
    const copy = withSecurityHeaders(locked);
    expect(copy.status).toBe(302);
    expect(copy.headers.get("location")).toBe("https://example.com/");
    expect(copy.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("robots özel sayfaları kapatır; PUBLIC_URL varsa site haritasını bildirir", () => {
    const txt = robotsTxt("https://trai.example/");
    expect(txt).toContain("Disallow: /admin");
    expect(txt).toContain("Disallow: /payment");
    expect(txt).toContain("Sitemap: https://trai.example/sitemap.xml");
    expect(robotsTxt(undefined)).not.toContain("Sitemap");
  });

  it("site haritası yalnız herkese açık sayfaları mutlak adresle listeler", () => {
    const xml = sitemapXml("https://trai.example")!;
    expect(xml).toContain("<loc>https://trai.example/</loc>");
    expect(xml).toContain("<loc>https://trai.example/pricing</loc>");
    expect(xml).not.toContain("/admin");
    expect(sitemapXml(undefined)).toBeNull();
  });
});

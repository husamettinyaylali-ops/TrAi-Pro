/**
 * Tüm yanıtlara eklenen güvenlik başlıkları. COOP bilerek yok: PayPal ödeme
 * penceresi açan sayfayla haberleşir. HSTS yayında Caddy'de (deploy/Caddyfile).
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

/** Yanıtın başlıkları değiştirilemiyorsa (ör. fetch yanıtı) kopyası üzerinde ekler. */
export function withSecurityHeaders(response: Response): Response {
  let res = response;
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!res.headers.has(k)) res.headers.set(k, v);
    }
  } catch {
    res = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!res.headers.has(k)) res.headers.set(k, v);
    }
  }
  return res;
}

/** Arama motorlarına açık sayfalar. */
export const PUBLIC_PATHS = [
  "/",
  "/pricing",
  "/sign-up",
  "/sign-in",
  "/terms-of-service",
  "/privacy-policy",
  "/refund-policy",
  "/acceptable-use-policy",
  "/api-docs",
] as const;

/** Kişisel ya da işlem sayfaları taranmaz. */
const PRIVATE_PATHS = [
  "/admin",
  "/account",
  "/labs",
  "/projects",
  "/payment",
  "/payment-history",
  "/verify-email",
  "/reset-password",
  "/forgot-password",
  "/auth/",
  "/media/",
  "/webhooks/",
  "/api/",
];

const base = (publicUrl: string | undefined) => publicUrl?.replace(/\/$/, "") || null;

export function robotsTxt(publicUrl: string | undefined): string {
  const url = base(publicUrl);
  return [
    "User-agent: *",
    "Allow: /",
    ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
    ...(url ? ["", `Sitemap: ${url}/sitemap.xml`] : []),
    "",
  ].join("\n");
}

/** PUBLIC_URL yoksa site haritası üretilmez (mutlak adres gerekir). */
export function sitemapXml(publicUrl: string | undefined): string | null {
  const url = base(publicUrl);
  if (!url) return null;
  const items = PUBLIC_PATHS.map((p) => `  <url><loc>${url}${p === "/" ? "/" : p}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...items,
    "</urlset>",
    "",
  ].join("\n");
}

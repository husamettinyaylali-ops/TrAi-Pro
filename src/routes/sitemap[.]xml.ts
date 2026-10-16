import { createFileRoute } from "@tanstack/react-router";

import { env } from "@/server/env.server";
import { sitemapXml } from "@/server/site-meta.server";

// Yalnız sunucu işleyicisi: herkese açık sayfaların listesi (PUBLIC_URL gerekir).
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const xml = sitemapXml(env("PUBLIC_URL"));
        return xml
          ? new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } })
          : new Response("Not found", { status: 404 });
      },
    },
  },
});

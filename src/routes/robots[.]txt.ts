import { createFileRoute } from "@tanstack/react-router";

import { env } from "@/server/env.server";
import { robotsTxt } from "@/server/site-meta.server";

// Yalnız sunucu işleyicisi: özel sayfalar taranmaz; PUBLIC_URL varsa site haritası bildirilir.
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(robotsTxt(env("PUBLIC_URL")), {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
    },
  },
});

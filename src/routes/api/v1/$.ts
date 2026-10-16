import { createFileRoute } from "@tanstack/react-router";

import { handleApi } from "@/server/public-api.server";

// Yalnız sunucu işleyicisi: geliştirici API'si (/api/v1/*). Belgeler: /api-docs.
export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleApi(request, params._splat ?? ""),
      POST: ({ request, params }) => handleApi(request, params._splat ?? ""),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

import { serveFile } from "@/server/media.server";

// Yalnız sunucu işleyicisi: üretilen görsel/video <img>/<video> etiketiyle ya da indirme bağlantısıyla istenir.
export const Route = createFileRoute("/media/file/$id/$index")({
  server: {
    handlers: { GET: ({ request, params }) => serveFile(request, params.id, params.index) },
  },
});

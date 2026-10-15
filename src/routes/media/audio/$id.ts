import { createFileRoute } from "@tanstack/react-router";

import { serveAudio } from "@/server/media.server";

// Yalnız sunucu işleyicisi: ses dosyası <audio> etiketi ya da indirme bağlantısıyla istenir.
export const Route = createFileRoute("/media/audio/$id")({
  server: { handlers: { GET: ({ request, params }) => serveAudio(request, params.id) } },
});

import { createFileRoute } from "@tanstack/react-router";

import { serveSubtitle } from "@/server/media.server";

// Yalnız sunucu işleyicisi: seslendirmenin altyazısı SRT ya da (?format=vtt) WebVTT olarak.
export const Route = createFileRoute("/media/subtitle/$id")({
  server: { handlers: { GET: ({ request, params }) => serveSubtitle(request, params.id) } },
});

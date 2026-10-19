import { createFileRoute } from "@tanstack/react-router";

import { serveVoicePreview } from "@/server/voice-preview.server";

// Yalnız sunucu işleyicisi: seslendiren seçicideki ses örneği (?lang=tr|en).
export const Route = createFileRoute("/media/voice-preview/$id")({
  server: { handlers: { GET: ({ request, params }) => serveVoicePreview(request, params.id) } },
});

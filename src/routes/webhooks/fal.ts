import { createFileRoute } from "@tanstack/react-router";

import { handleFalWebhook } from "@/server/fal-webhook.server";

// Yalnız sunucu işleyicisi: fal.ai video işi bitince buraya haber verir.
export const Route = createFileRoute("/webhooks/fal")({
  server: { handlers: { POST: ({ request }) => handleFalWebhook(request) } },
});

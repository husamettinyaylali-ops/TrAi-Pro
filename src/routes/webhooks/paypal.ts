import { createFileRoute } from "@tanstack/react-router";

import { handlePaypalWebhook } from "@/server/paypal-webhook.server";

// Yalnız sunucu işleyicisi: PayPal ödeme olaylarını buraya gönderir.
export const Route = createFileRoute("/webhooks/paypal")({
  server: { handlers: { POST: ({ request }) => handlePaypalWebhook(request) } },
});

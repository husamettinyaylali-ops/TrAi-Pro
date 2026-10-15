import { createFileRoute } from "@tanstack/react-router";

import { startGoogleSignIn } from "@/server/google-flow.server";

// Yalnız sunucu işleyicisi; sayfa bileşeni yok. Bağlantı tam sayfa isteğiyle açılır.
export const Route = createFileRoute("/auth/google")({
  server: { handlers: { GET: ({ request }) => startGoogleSignIn(request) } },
});

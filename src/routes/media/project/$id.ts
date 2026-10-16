import { createFileRoute } from "@tanstack/react-router";

import { serveProjectZip } from "@/server/project-zip.server";

// Yalnız sunucu işleyicisi: projedeki dosyalar tek ZIP olarak indirilir (tam sayfa bağlantıyla).
export const Route = createFileRoute("/media/project/$id")({
  server: {
    handlers: { GET: ({ request, params }) => serveProjectZip(request, params.id) },
  },
});

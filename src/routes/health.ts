import { createFileRoute } from "@tanstack/react-router";

import { getDb } from "@/server/db.server";

// Yalnız sunucu işleyicisi: Docker sağlık kontrolü ve izleme için. Veritabanı yanıt vermiyorsa 503.
export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await (await getDb()).$client.execute("select 1");
          return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
        } catch {
          return Response.json({ status: "unavailable" }, { status: 503 });
        }
      },
    },
  },
});

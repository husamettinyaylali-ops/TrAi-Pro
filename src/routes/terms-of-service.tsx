import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/site/legal";

export const Route = createFileRoute("/terms-of-service")({
  head: () => ({ meta: [{ title: "Kullanım Şartları — TrAi Pro" }] }),
  component: () => <LegalPage doc="terms" />,
});

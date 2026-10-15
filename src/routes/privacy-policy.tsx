import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/site/legal";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({ meta: [{ title: "Gizlilik Politikası — TrAi Pro" }] }),
  component: () => <LegalPage doc="privacy" />,
});

import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/site/legal";

export const Route = createFileRoute("/refund-policy")({
  head: () => ({ meta: [{ title: "İade Politikası — TrAi Pro" }] }),
  component: () => <LegalPage doc="refund" />,
});

import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/site/legal";

export const Route = createFileRoute("/acceptable-use-policy")({
  head: () => ({ meta: [{ title: "Kabul Edilebilir Kullanım — TrAi Pro" }] }),
  component: () => <LegalPage doc="acceptable" />,
});

import { createFileRoute } from "@tanstack/react-router";

import { finishGoogleSignIn } from "@/server/google-flow.server";

export const Route = createFileRoute("/auth/google/callback")({
  server: { handlers: { GET: ({ request }) => finishGoogleSignIn(request) } },
});

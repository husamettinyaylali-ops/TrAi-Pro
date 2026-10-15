import { createFileRoute } from "@tanstack/react-router";

import { AuthForm } from "@/components/site/auth-form";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { redirect?: string; error?: string; reset?: string } => ({
    ...(typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {}),
    ...(typeof s["error"] === "string" ? { error: s["error"] } : {}),
    ...(typeof s["reset"] === "string" ? { reset: s["reset"] } : {}),
  }),
  head: () => ({ meta: [{ title: "Giriş Yap — TrAi Pro" }] }),
  component: SignIn,
});

function SignIn() {
  const { redirect, error, reset } = Route.useSearch();
  return <AuthForm mode="sign-in" redirect={redirect} error={error} resetDone={reset === "done"} />;
}

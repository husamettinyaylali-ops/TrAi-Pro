import { createFileRoute } from "@tanstack/react-router";

import { AuthForm } from "@/components/site/auth-form";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } =>
    typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {},
  head: () => ({ meta: [{ title: "Giriş Yap — TrAi Pro" }] }),
  component: SignIn,
});

function SignIn() {
  const { redirect } = Route.useSearch();
  return <AuthForm mode="sign-in" redirect={redirect} />;
}

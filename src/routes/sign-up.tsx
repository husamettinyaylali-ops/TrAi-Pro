import { createFileRoute } from "@tanstack/react-router";

import { AuthForm } from "@/components/site/auth-form";

export const Route = createFileRoute("/sign-up")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } =>
    typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {},
  head: () => ({ meta: [{ title: "Kayıt Ol — TrAi Pro" }] }),
  component: SignUp,
});

function SignUp() {
  const { redirect } = Route.useSearch();
  return <AuthForm mode="sign-up" redirect={redirect} />;
}

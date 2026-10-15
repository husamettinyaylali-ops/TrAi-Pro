import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { SiteShell, btnPrimary, field } from "@/components/site/shell";
import { useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (s: Record<string, unknown>): { token?: string } =>
    typeof s["token"] === "string" ? { token: s["token"] } : {},
  head: () => ({ meta: [{ title: "Yeni şifre — TrAi Pro" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const { t, lang } = useI18n();
  const { token } = Route.useSearch();
  const { resetPassword } = useApp();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tokenBad, setTokenBad] = useState(!token);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password.length < 8) return setError(t.email.errors.invalidInput);
    setError(null);
    setBusy(true);
    const res = await resetPassword(token, password, lang);
    setBusy(false);
    if (res.ok) return navigate({ to: "/sign-in", search: { reset: "done" } });
    if (res.error === "invalidToken" || res.error === "expiredToken") setTokenBad(true);
    setError(res.error === "network" ? t.auth.errors.network : t.email.errors[res.error]);
  };

  return (
    <SiteShell>
      <section className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <div className="glass glow-border rounded-3xl p-8 shadow-glow">
          <h1 className="text-3xl font-bold">{t.email.resetTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t.email.resetSub}</p>
          {tokenBad ? (
            <div className="mt-8 space-y-4">
              <p
                role="alert"
                className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {error ?? t.email.errors.invalidToken}
              </p>
              <Link to="/forgot-password" className={`${btnPrimary} w-full`}>
                {t.email.requestNew}
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="mt-8 space-y-5">
              <div>
                <label htmlFor="reset-password" className="mb-1.5 block text-sm font-medium">
                  {t.accountPage.newPassword}
                </label>
                <input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  className={field}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  {...(error ? { "aria-invalid": true, "aria-describedby": "reset-err" } : {})}
                />
                {error ? (
                  <p id="reset-err" role="alert" className="mt-1.5 text-xs text-destructive">
                    {error}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground">{t.auth.passwordHint}</p>
                )}
              </div>
              <button type="submit" disabled={busy || !password} className={`${btnPrimary} w-full`}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t.email.resetSubmit}
              </button>
            </form>
          )}
        </div>
      </section>
    </SiteShell>
  );
}

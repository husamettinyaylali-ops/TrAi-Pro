import { Link, createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { SiteShell, btnPrimary, field } from "@/components/site/shell";
import { useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Şifremi unuttum — TrAi Pro" }] }),
  component: ForgotPassword,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ForgotPassword() {
  const { t, lang } = useI18n();
  const { requestPasswordReset } = useApp();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError(t.auth.errors.email);
    setError(null);
    setBusy(true);
    const res = await requestPasswordReset(email.trim(), lang);
    setBusy(false);
    if (res.ok) return setSent(true);
    setError(
      res.error === "tooManyAttempts"
        ? t.auth.errors.tooManyAttempts(res.retryAfterMinutes)
        : t.auth.errors.network,
    );
  };

  return (
    <SiteShell>
      <section className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <div className="glass glow-border rounded-3xl p-8 shadow-glow">
          <h1 className="text-3xl font-bold">{t.email.forgotTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t.email.forgotSub}</p>
          {sent ? (
            <p
              role="status"
              className="mt-8 flex items-start gap-2 rounded-xl border border-cyan/40 bg-cyan/10 px-4 py-3 text-sm text-cyan"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t.email.forgotSent}
            </p>
          ) : (
            <form onSubmit={submit} noValidate className="mt-8 space-y-5">
              <div>
                <label htmlFor="forgot-email" className="mb-1.5 block text-sm font-medium">
                  {t.auth.email}
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  className={field}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  {...(error ? { "aria-invalid": true, "aria-describedby": "forgot-err" } : {})}
                />
                {error && (
                  <p id="forgot-err" role="alert" className="mt-1.5 text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t.email.forgotSubmit}
              </button>
            </form>
          )}
          <p className="mt-6 text-center text-sm">
            <Link to="/sign-in" search={{}} className="font-semibold hover:text-cyan">
              {t.email.backToSignIn}
            </Link>
          </p>
        </div>
      </section>
    </SiteShell>
  );
}

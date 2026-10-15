import { Link, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { useFormat, useI18n } from "@/lib/i18n";
import { signupBonus } from "@/lib/packages";
import { safeRedirect } from "@/lib/redirect";
import { useApp } from "@/lib/store";
import { isGoogleError } from "@/lib/google-errors";

import { GoogleMark } from "./google-mark";
import { DemoNote, SiteShell, btnPrimary, field } from "./shell";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Errors = Partial<Record<"name" | "email" | "password" | "terms" | "form", string>>;

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function AuthForm({
  mode,
  redirect,
  error,
}: {
  mode: "sign-in" | "sign-up";
  redirect?: string | undefined;
  error?: string | undefined;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const { signIn, signUp } = useApp();
  const router = useRouter();
  const [values, setValues] = useState({ name: "", email: "", password: "", terms: false });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const up = mode === "sign-up";
  const e = t.auth.errors;

  const set = (k: keyof typeof values, v: string | boolean) => setValues((s) => ({ ...s, [k]: v }));

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const next: Errors = {};
    if (up && !values.name.trim()) next.name = e.required;
    if (!values.email.trim()) next.email = e.required;
    else if (!EMAIL_RE.test(values.email.trim())) next.email = e.email;
    if (!values.password) next.password = e.required;
    else if (up && values.password.length < 8) next.password = e.password;
    if (up && !values.terms) next.terms = e.terms;
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    const email = values.email.trim();
    const res = up
      ? await signUp({ name: values.name, email, password: values.password })
      : await signIn({ email, password: values.password });
    setBusy(false);
    if (!res.ok) {
      return setErrors({
        form:
          res.error === "tooManyAttempts" ? e.tooManyAttempts(res.retryAfterMinutes) : e[res.error],
      });
    }
    router.history.push(safeRedirect(redirect));
  };

  const err = (k: keyof Errors) =>
    errors[k] ? { "aria-invalid": true, "aria-describedby": `${k}-err` } : {};

  return (
    <SiteShell>
      <section className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <div className="glass glow-border rounded-3xl p-8 shadow-glow">
          <h1 className="text-3xl font-bold">{up ? t.auth.signUpTitle : t.auth.signInTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {up ? t.auth.signUpSub(f.num(signupBonus.credits)) : t.auth.signInSub}
          </p>
          {isGoogleError(error) && (
            <p
              role="alert"
              className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {e[error]}
            </p>
          )}
          {/* Sunucu rotasına tam sayfa istek gider; istemci yönlendiricisi kullanılmaz. */}
          <a
            href={`/auth/google?${new URLSearchParams({ redirect: safeRedirect(redirect) })}`}
            className="mt-8 inline-flex min-h-11 w-full items-center justify-center gap-3 rounded-full border border-border bg-background px-6 py-3 font-semibold transition hover:border-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GoogleMark />
            {t.auth.google}
          </a>
          {up && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {t.auth.googleTermsBefore}
              <Link to="/terms-of-service" className="underline underline-offset-2 hover:text-cyan">
                {t.auth.terms}
              </Link>
              {t.auth.and}
              <Link to="/privacy-policy" className="underline underline-offset-2 hover:text-cyan">
                {t.auth.privacy}
              </Link>
              {t.auth.googleTermsAfter}
            </p>
          )}
          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden />
            {t.auth.or}
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>
          <form onSubmit={submit} noValidate className="space-y-5">
            {up && (
              <Field id="name" label={t.auth.name} error={errors.name}>
                <input
                  id="name"
                  autoComplete="name"
                  className={field}
                  value={values.name}
                  onChange={(x) => set("name", x.target.value)}
                  {...err("name")}
                />
              </Field>
            )}
            <Field id="email" label={t.auth.email} error={errors.email}>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className={field}
                value={values.email}
                onChange={(x) => set("email", x.target.value)}
                {...err("email")}
              />
            </Field>
            <Field
              id="password"
              label={t.auth.password}
              error={errors.password}
              hint={up ? t.auth.passwordHint : undefined}
            >
              <input
                id="password"
                type="password"
                autoComplete={up ? "new-password" : "current-password"}
                className={field}
                value={values.password}
                onChange={(x) => set("password", x.target.value)}
                {...err("password")}
              />
            </Field>
            {up && (
              <div>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--violet)]"
                    checked={values.terms}
                    onChange={(x) => set("terms", x.target.checked)}
                    {...err("terms")}
                  />
                  <span className="text-muted-foreground">
                    {t.auth.termsBefore}
                    <Link
                      to="/terms-of-service"
                      className="text-foreground underline underline-offset-2 hover:text-cyan"
                    >
                      {t.auth.terms}
                    </Link>
                    {t.auth.and}
                    <Link
                      to="/privacy-policy"
                      className="text-foreground underline underline-offset-2 hover:text-cyan"
                    >
                      {t.auth.privacy}
                    </Link>
                    {t.auth.termsAfter}
                  </span>
                </label>
                {errors.terms && (
                  <p id="terms-err" role="alert" className="mt-1 text-xs text-destructive">
                    {errors.terms}
                  </p>
                )}
              </div>
            )}
            {errors.form && (
              <p
                role="alert"
                className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {errors.form}
              </p>
            )}
            <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? t.auth.submitting : up ? t.signUp : t.signIn}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {up ? t.auth.haveAccount : t.auth.noAccount}{" "}
            <Link
              to={up ? "/sign-in" : "/sign-up"}
              search={redirect ? { redirect } : {}}
              className="font-semibold text-foreground hover:text-cyan"
            >
              {up ? t.signIn : t.signUp}
            </Link>
          </p>
        </div>
        <DemoNote />
      </section>
    </SiteShell>
  );
}

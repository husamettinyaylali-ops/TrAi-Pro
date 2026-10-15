import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { SiteShell, btnOutline, btnPrimary } from "@/components/site/shell";
import { useFormat, useI18n } from "@/lib/i18n";
import { signupBonus } from "@/lib/packages";
import { useApp } from "@/lib/store";
import type { TokenErrorCode } from "@/lib/types";

export const Route = createFileRoute("/verify-email")({
  validateSearch: (s: Record<string, unknown>): { token?: string } =>
    typeof s["token"] === "string" ? { token: s["token"] } : {},
  head: () => ({ meta: [{ title: "E-posta doğrulama — TrAi Pro" }] }),
  component: VerifyEmail,
});

type State =
  { kind: "working" } | { kind: "done" } | { kind: "error"; error: TokenErrorCode | "network" };

function VerifyEmail() {
  const { t } = useI18n();
  const f = useFormat();
  const { token } = Route.useSearch();
  const { user, hydrated, verifyEmail } = useApp();
  const [state, setState] = useState<State>(
    token ? { kind: "working" } : { kind: "error", error: "invalidToken" },
  );
  const started = useRef(false);

  // Bağlantı açıldığında bir kez doğrulanır (React'in çift çalıştırmasına karşı korunur).
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    void verifyEmail(token).then((res) =>
      setState(res.ok ? { kind: "done" } : { kind: "error", error: res.error }),
    );
  }, [token, verifyEmail]);

  return (
    <SiteShell>
      <section className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <div className="glass glow-border rounded-3xl p-8 text-center shadow-glow">
          <h1 className="text-3xl font-bold">{t.email.verifyTitle}</h1>
          {state.kind === "working" && (
            <p
              role="status"
              className="mt-8 flex items-center justify-center gap-2 text-muted-foreground"
            >
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              {t.email.verifying}
            </p>
          )}
          {state.kind === "done" && (
            <>
              <CheckCircle2 className="mx-auto mt-8 h-14 w-14 text-cyan" aria-hidden />
              <p role="status" className="mt-4">
                {t.email.verifyDone(f.num(signupBonus.credits))}
              </p>
            </>
          )}
          {state.kind === "error" && (
            <>
              <AlertCircle className="mx-auto mt-8 h-14 w-14 text-destructive" aria-hidden />
              <p role="alert" className="mt-4 text-destructive">
                {state.error === "network" ? t.auth.errors.network : t.email.errors[state.error]}
              </p>
            </>
          )}
          {state.kind !== "working" && hydrated && (
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {user ? (
                <>
                  <Link to="/labs" search={{ tab: "tts" }} className={btnPrimary}>
                    {t.openLabs}
                  </Link>
                  {state.kind === "error" && (
                    <Link to="/account" search={{}} className={btnOutline}>
                      {t.accountPage.title}
                    </Link>
                  )}
                </>
              ) : (
                <Link to="/sign-in" search={{}} className={btnPrimary}>
                  {t.signIn}
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
    </SiteShell>
  );
}

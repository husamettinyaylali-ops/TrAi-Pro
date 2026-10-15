import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, MailCheck } from "lucide-react";

import { useFormat, useI18n } from "@/lib/i18n";
import { signupBonus } from "@/lib/packages";
import { useApp } from "@/lib/store";

/** E-postası doğrulanmamış kullanıcıya deneme kredisini hatırlatır ve bağlantıyı yeniden gönderir. */
export function VerifyBanner() {
  const { t, lang } = useI18n();
  const f = useFormat();
  const { user, data, resendVerification } = useApp();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user || data.security.emailVerified) return null;

  const resend = async () => {
    setBusy(true);
    const res = await resendVerification(lang);
    setBusy(false);
    if (res.ok) return setNote({ ok: true, text: t.email.resent });
    if (res.error === "tooManyAttempts") {
      return setNote({ ok: false, text: t.auth.errors.tooManyAttempts(res.retryAfterMinutes) });
    }
    if (res.error === "network") return setNote({ ok: false, text: t.auth.errors.network });
    const known = t.email.errors as Record<string, string>;
    setNote({ ok: false, text: known[res.error] ?? t.labs.failed });
  };

  const Icon = note?.ok ? CheckCircle2 : AlertCircle;
  return (
    <section
      aria-label={t.email.banner(f.num(signupBonus.credits))}
      className="glass flex flex-col gap-4 rounded-3xl border border-cyan/40 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan" aria-hidden />
        <div>
          <p className="font-semibold">{t.email.banner(f.num(signupBonus.credits))}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.email.bannerSub}</p>
          {note && (
            <p
              role={note.ok ? "status" : "alert"}
              className={`mt-2 flex items-center gap-1.5 text-sm ${note.ok ? "text-cyan" : "text-destructive"}`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {note.text}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={resend}
        disabled={busy}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-cyan/60 px-5 text-sm font-semibold text-cyan transition hover:bg-cyan/10 disabled:pointer-events-none disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {t.email.resend}
      </button>
    </section>
  );
}

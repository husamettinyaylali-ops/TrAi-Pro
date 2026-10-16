import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, Coins, Loader2, Mic, Sparkles, Trash2, Upload, X } from "lucide-react";

import { useActionError } from "@/components/studio/hooks";
import { Waveform } from "@/components/landing/fx";
import { btnOutline, btnPrimary, field } from "@/components/site/shell";
import { MAX_CLONES, balance, nextExpiry, type CreditKind } from "@/lib/credits";
import { useFormat, useI18n } from "@/lib/i18n";
import { clock } from "@/lib/clock";
import { useApp, type History } from "@/lib/store";
import { useStudioConfig } from "@/lib/studio-config";

export const Panel = ({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) => <div className={`glass glow-border rounded-3xl p-6 ${className}`}>{children}</div>;

/** Geçmiş listesinin yükleniyor, hata ve boş durumları; altta daha eski üretimler. */
export function HistoryView({
  history,
  empty,
  children,
}: {
  history: History;
  empty: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (history.loading) {
    return (
      <div role="status" aria-label={t.loading} className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="shimmer h-16 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (history.error && history.items.length === 0) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center text-sm">
        <p className="text-destructive">{t.labs.historyError}</p>
        <button type="button" onClick={history.retry} className={btnOutline}>
          {t.rootPages.retry}
        </button>
      </div>
    );
  }
  if (history.items.length === 0) return <>{empty}</>;
  return (
    <>
      {children}
      {(history.hasMore || history.error) && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {history.error && (
            <p role="alert" className="text-sm text-destructive">
              {t.labs.historyError}
            </p>
          )}
          <button
            type="button"
            onClick={history.loadMore}
            disabled={history.loadingMore}
            className={`${btnOutline} disabled:opacity-60`}
          >
            {history.loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t.labs.loadMore}
          </button>
        </div>
      )}
    </>
  );
}

export function Balances() {
  const { t } = useI18n();
  const f = useFormat();
  const { data } = useApp();
  const now = clock();
  const card = (kind: CreditKind, label: string) => {
    const exp = nextExpiry(data.grants, kind, now);
    return (
      <Panel className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 font-display text-3xl font-bold">
            {f.num(balance(data.grants, kind, now))}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {exp ? t.labs.expires(f.date(exp)) : t.labs.noPackage}
          </p>
        </div>
        <Link
          to="/pricing"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold transition hover:border-cyan hover:text-cyan"
        >
          <Coins className="h-4 w-4" />
          {t.labs.buy}
        </Link>
      </Panel>
    );
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {card("voice", t.labs.voiceBalance)}
      {card("media", t.labs.mediaBalance)}
    </div>
  );
}

/** Klon için yüklenebilecek en büyük dosya (sunucudaki sınırla aynı). */
const MAX_CLONE_MB = 10;

export function VoiceClone() {
  const { t } = useI18n();
  const f = useFormat();
  const { data, addClone, uploadClone, deleteClone } = useApp();
  const config = useStudioConfig();
  const actionError = useActionError();
  const live = config.data?.cloning === true;
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const full = data.clones.length >= MAX_CLONES;
  const ready = name.trim() && file && consent && !full && !config.isPending;

  const reset = () => {
    setName("");
    setFile(null);
    setConsent(false);
  };

  /** Adımlar yükleme sürerken ilerler; son adım yanıt gelince tamamlanır. */
  const animate = () => {
    setStep(0);
    [1, 2].forEach((s) => timers.current.push(window.setTimeout(() => setStep(s), s * 1100)));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !file) return;
    setError(null);
    if (live) {
      if (file.size > MAX_CLONE_MB * 1024 * 1024)
        return setError(t.labs.clone.tooBig(MAX_CLONE_MB));
      animate();
      const form = new FormData();
      form.append("name", name.trim());
      form.append("consent", "true");
      form.append("file", file);
      const res = await uploadClone(form);
      timers.current.forEach(clearTimeout);
      if (!res.ok) {
        setStep(-1);
        return setError(res.error === "limit" ? t.labs.clone.limit(MAX_CLONES) : actionError(res));
      }
      setStep(3);
      return reset();
    }
    animate();
    timers.current.push(
      window.setTimeout(async () => {
        const res = await addClone(name);
        setStep(3);
        if (!res.ok) {
          return setError(res.error === "limit" ? t.labs.clone.limit(MAX_CLONES) : t.labs.failed);
        }
        reset();
      }, 3300),
    );
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel>
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="clone-name" className="mb-1.5 block text-sm font-medium">
              {t.labs.clone.name}
            </label>
            <input
              id="clone-name"
              className={field}
              placeholder={t.labs.clone.namePlaceholder}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <span className="mb-1.5 block text-sm font-medium">{t.labs.clone.file}</span>
            <label
              htmlFor="clone-file"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = e.dataTransfer.files[0];
                if (dropped) setFile(dropped);
              }}
              className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-violet/40 bg-violet/5 px-4 py-10 text-center transition hover:border-cyan hover:bg-cyan/5 focus-within:border-cyan"
            >
              <Upload className="mb-3 h-8 w-8 text-cyan" />
              <span className="font-medium">{file ? file.name : t.labs.clone.file}</span>
              <span className="mt-1 text-xs text-muted-foreground">{t.labs.clone.fileHint}</span>
              <input
                id="clone-file"
                type="file"
                accept="audio/mpeg,audio/wav,audio/x-wav,audio/*"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--violet)]"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span className="text-muted-foreground">{t.labs.clone.consent}</span>
          </label>
          {full && (
            <p role="alert" className="text-sm text-destructive">
              {t.labs.clone.limit(MAX_CLONES)}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button type="submit" disabled={!ready || (step >= 0 && step < 3)} className={btnPrimary}>
            <Sparkles className="h-4 w-4" />
            {t.labs.clone.submit}
          </button>
          <p className="text-xs text-muted-foreground">
            {live ? t.labs.clone.liveNote : `${t.labs.clone.free} ${t.labs.demoResult}`}
          </p>
        </form>
      </Panel>

      <Panel>
        <h3 className="mb-4 text-lg font-semibold">{t.labs.clone.mine}</h3>
        {data.clones.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t.labs.clone.none}</p>
        ) : (
          <ul className="space-y-2">
            {data.clones.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-muted/50 py-1 pl-4 pr-1 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <Mic className="h-4 w-4 shrink-0 text-cyan" aria-hidden />
                  <span className="truncate">{c.name}</span>
                  {live && !c.live && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {t.labs.clone.demoBadge}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">{f.date(c.createdAt)}</span>
                  <button
                    type="button"
                    onClick={() => deleteClone(c.id)}
                    aria-label={`${t.labs.clone.deleteClone}: ${c.name}`}
                    className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          {f.num(data.clones.length)} / {MAX_CLONES}
        </p>
      </Panel>

      {step >= 0 && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-md animate-in fade-in"
          role="dialog"
          aria-modal="true"
          aria-label={t.labs.tabs.clone}
        >
          <div className="glass glow-border w-full max-w-md rounded-3xl p-8">
            <div className="mb-6 flex items-center justify-between">
              <h4 className="text-lg font-semibold">{t.labs.tabs.clone}</h4>
              {step === 3 && (
                <button
                  onClick={() => setStep(-1)}
                  aria-label={t.close}
                  className="grid h-11 w-11 place-items-center"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
            <ol className="space-y-4">
              {t.labs.clone.steps.map((s, i) => (
                <li key={s} className="flex items-center gap-3">
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-full text-xs ${i < step || step === 3 ? "bg-gradient-brand text-primary-foreground" : i === step ? "border border-cyan text-cyan" : "border border-border text-muted-foreground"}`}
                  >
                    {i < step || step === 3 ? (
                      <Check className="h-4 w-4" />
                    ) : i === step ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className={i <= step ? "" : "text-muted-foreground"}>{s}</span>
                </li>
              ))}
            </ol>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-gradient-brand transition-all duration-700"
                style={{ width: `${((step + 1) / 4) * 100}%` }}
              />
            </div>
            {step === 3 && !error && (
              <div className="mt-6 text-center">
                <p className="mb-3 font-semibold text-gradient">{t.labs.clone.done}</p>
                <div className="flex justify-center overflow-hidden">
                  <Waveform playing bars={30} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

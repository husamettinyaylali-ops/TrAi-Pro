import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  PlugZap,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { btnOutline } from "@/components/site/shell";
import { useAdminSetup, useTestSetup } from "@/lib/admin";
import { useI18n } from "@/lib/i18n";
import type { SetupItem, SetupState, SetupTestResult } from "@/lib/types";

const card = "glass glow-border rounded-3xl p-4 sm:p-6";

const stateStyle: Record<SetupState, { cls: string; icon: typeof CheckCircle2 }> = {
  ready: { cls: "bg-cyan/15 text-cyan", icon: CheckCircle2 },
  missing: { cls: "bg-destructive/15 text-destructive", icon: XCircle },
  warning: { cls: "bg-magenta/15 text-magenta", icon: AlertTriangle },
  optional: { cls: "bg-muted text-muted-foreground", icon: CircleDashed },
};

function StateBadge({ state }: { state: SetupState }) {
  const { t } = useI18n();
  const { cls, icon: Icon } = stateStyle[state];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {t.setup.states[state]}
    </span>
  );
}

/** Tek servis: ne işe yaradığı, eksik anahtarlar, gizli olmayan bilgiler, uyarılar ve test. */
function SetupCard({ item }: { item: SetupItem }) {
  const { t } = useI18n();
  const test = useTestSetup();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SetupTestResult | { error: string } | null>(null);
  const copy = t.setup.items[item.id];

  const run = async () => {
    setBusy(true);
    setOutcome(null);
    const res = await test(item.id);
    setBusy(false);
    if (res.ok) return setOutcome(res.result);
    setOutcome({
      error:
        res.error === "tooManyAttempts" && "retryAfterMinutes" in res
          ? t.auth.errors.tooManyAttempts(res.retryAfterMinutes)
          : res.error === "network"
            ? t.auth.errors.network
            : t.admin.forbidden,
    });
  };

  return (
    <li className={`${card} flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold">{copy.title}</h3>
        <StateBadge state={item.state} />
      </div>
      <p className="text-sm text-muted-foreground">{copy.desc}</p>

      {item.missing.length > 0 && (
        <div className="text-sm">
          <p className="mb-1 font-medium">{t.setup.missing}</p>
          <ul className="flex flex-wrap gap-1.5">
            {item.missing.map((name) => (
              <li key={name}>
                <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{name}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.info.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {item.info.map((i) => (
            <div key={i.key} className="contents">
              <dt className="text-muted-foreground">{t.setup.info[i.key]}</dt>
              <dd className="break-all">
                {i.key === "retention" && i.value === "off" ? t.setup.off : i.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {item.warnings.length > 0 && (
        <ul className="space-y-1">
          {item.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 text-sm text-magenta">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t.setup.warnings[w]}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">{t.setup.docs(copy.docs)}</p>

      {item.testable && (
        <div className="mt-auto space-y-2 pt-1">
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className={`${btnOutline} disabled:opacity-60`}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlugZap className="h-4 w-4" aria-hidden />
            )}
            {busy ? t.setup.testing : item.id === "email" ? t.setup.testEmail : t.setup.test}
          </button>
          {outcome && "error" in outcome && (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {outcome.error}
            </p>
          )}
          {outcome && "code" in outcome && (
            <p
              role={outcome.ok ? "status" : "alert"}
              className={`flex items-start gap-2 text-sm ${outcome.ok ? "text-cyan" : "text-destructive"}`}
            >
              {outcome.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              )}
              {t.setup.results[outcome.code](outcome.value ?? "")}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Yönetim panelinde kurulum durumu: anahtarları girdikçe her servisi buradan doğrulayın. */
export function SetupCheck() {
  const { t, locale } = useI18n();
  const setup = useAdminSetup();
  const items = setup.data?.ok ? setup.data.items : [];
  const used = items.filter((i) => i.state !== "optional");
  const ready = used.filter((i) => i.state === "ready").length;
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);

  return (
    <section aria-labelledby="admin-setup" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="admin-setup" className="text-xl font-semibold">
            {t.setup.title}
            {setup.data?.ok && (
              <span className="ml-3 align-middle text-sm font-normal text-muted-foreground">
                {t.setup.summary(n(ready), n(used.length))}
              </span>
            )}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t.setup.sub}</p>
        </div>
        <button
          type="button"
          onClick={() => void setup.refetch()}
          disabled={setup.isFetching}
          className={`${btnOutline} disabled:opacity-60`}
        >
          <RefreshCw className={`h-4 w-4 ${setup.isFetching ? "animate-spin" : ""}`} aria-hidden />
          {t.setup.refresh}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t.setup.restartNote}</p>
      {setup.isPending ? (
        <div
          role="status"
          aria-label={t.loading}
          className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-48 rounded-3xl" />
          ))}
        </div>
      ) : !setup.data?.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {t.setup.loadError}
        </p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <SetupCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

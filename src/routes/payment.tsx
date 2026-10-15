import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Bitcoin, CheckCircle2, CreditCard, Landmark, Loader2, Lock } from "lucide-react";

import { RequireAuth } from "@/components/site/require-auth";
import { DemoNote, PageHead, SiteShell, btnOutline, btnPrimary } from "@/components/site/shell";
import { useFormat, useI18n } from "@/lib/i18n";
import { allPackages, findPackage, type CreditPackage } from "@/lib/packages";
import { useApp, type Order, type PaymentMethod } from "@/lib/store";

export const Route = createFileRoute("/payment")({
  validateSearch: (s: Record<string, unknown>): { package?: string } =>
    typeof s["package"] === "string" ? { package: s["package"] } : {},
  head: () => ({ meta: [{ title: "Ödeme — TrAi Pro" }] }),
  component: PaymentPage,
});

const methodIcons = { card: CreditCard, crypto: Bitcoin, bank: Landmark };

function usePkgLabel() {
  const { t } = useI18n();
  const f = useFormat();
  return (p: CreditPackage) =>
    p.kind === "voice"
      ? `${t.nav.voice} · ${t.packages.credits(f.num(p.credits))}`
      : `${t.packages.mediaName} · ${t.packages.days(p.days)}`;
}

function Payment() {
  const { t } = useI18n();
  const f = useFormat();
  const search = Route.useSearch();
  const { purchase } = useApp();
  const pkgLabel = usePkgLabel();
  const [selected, setSelected] = useState<string | undefined>(findPackage(search.package)?.id);
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pkg = findPackage(selected);

  const pay = async () => {
    if (!pkg) return;
    setBusy(true);
    setError(null);
    const res = await purchase(pkg.id, method);
    setBusy(false);
    if (res.ok) return setDone(res.order);
    setError(res.error === "paymentsDisabled" ? t.payment.disabled : t.payment.failed);
  };

  if (done) {
    return (
      <div className="mx-auto max-w-lg px-4 pb-24 sm:px-6">
        <div className="glass glow-border rounded-3xl p-10 text-center shadow-glow">
          <CheckCircle2 className="mx-auto h-14 w-14 text-cyan" />
          <h2 className="mt-4 text-2xl font-bold">{t.payment.success}</h2>
          <p className="mt-2 text-muted-foreground">
            {t.payment.successSub(f.num(done.credits), f.date(done.expiresAt))}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/labs"
              search={{ tab: done.kind === "voice" ? "tts" : "image" }}
              className={btnPrimary}
            >
              {t.payment.goLabs}
            </Link>
            <Link to="/payment-history" className={btnOutline}>
              {t.payment.goHistory}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 pb-24 sm:px-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-6">
        <fieldset className="glass glow-border rounded-3xl p-6">
          <legend className="sr-only">{t.payment.choose}</legend>
          <h2 className="mb-4 text-lg font-semibold">{t.payment.choose}</h2>
          <div className="space-y-3">
            {allPackages.map((p) => (
              <label
                key={p.id}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-2xl border px-4 py-3 transition ${selected === p.id ? "border-cyan bg-cyan/10" : "border-border hover:border-cyan/50"}`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="package"
                    value={p.id}
                    checked={selected === p.id}
                    onChange={() => setSelected(p.id)}
                    className="h-4 w-4 accent-[var(--violet)]"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{pkgLabel(p)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.kind === "voice"
                        ? t.packages.days(p.days)
                        : t.packages.mediaIncludes(f.num(p.credits))}
                    </span>
                  </span>
                </span>
                <span className="font-display text-lg font-bold">{f.usd(p.priceUsd)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="glass glow-border rounded-3xl p-6">
          <legend className="sr-only">{t.payment.method}</legend>
          <h2 className="mb-4 text-lg font-semibold">{t.payment.method}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(methodIcons) as PaymentMethod[]).map((m) => {
              const I = methodIcons[m];
              return (
                <label
                  key={m}
                  className={`flex min-h-11 cursor-pointer flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-center text-sm font-medium transition ${method === m ? "border-cyan bg-cyan/10" : "border-border hover:border-cyan/50"}`}
                >
                  <input
                    type="radio"
                    name="method"
                    value={m}
                    checked={method === m}
                    onChange={() => setMethod(m)}
                    className="sr-only"
                  />
                  <I className="h-5 w-5 text-cyan" />
                  {t.payment.methods[m]}
                </label>
              );
            })}
          </div>
          <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t.payment.methodNote}
          </p>
        </fieldset>
      </div>

      <aside className="glass glow-border h-fit rounded-3xl p-6 lg:sticky lg:top-24">
        <h2 className="mb-4 text-lg font-semibold">{t.payment.summary}</h2>
        {pkg ? (
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t.payment.choose}</dt>
              <dd className="text-right font-medium">{pkgLabel(pkg)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t.packages.creditAmount}</dt>
              <dd className="font-medium">{f.num(pkg.credits)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t.packages.usagePeriod}</dt>
              <dd className="font-medium">{t.packages.days(pkg.days)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t.payment.method}</dt>
              <dd className="font-medium">{t.payment.methods[method]}</dd>
            </div>
            <div className="flex items-end justify-between gap-4 border-t border-border pt-4">
              <dt className="font-semibold">{t.payment.total}</dt>
              <dd className="font-display text-3xl font-bold">{f.usd(pkg.priceUsd)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t.payment.pickFirst}</p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <button onClick={pay} disabled={!pkg || busy} className={`${btnPrimary} mt-6 w-full`}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? t.payment.paying : t.payment.pay}
        </button>
      </aside>
    </div>
  );
}

function PaymentPage() {
  const { t } = useI18n();
  return (
    <SiteShell>
      <PageHead title={t.payment.title} sub={t.payment.sub} />
      <RequireAuth>
        <Payment />
        <div className="-mt-16 px-4 pb-16">
          <DemoNote />
        </div>
      </RequireAuth>
    </SiteShell>
  );
}

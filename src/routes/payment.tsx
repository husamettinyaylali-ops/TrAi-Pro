import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Bitcoin,
  CheckCircle2,
  CreditCard,
  FlaskConical,
  Loader2,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { BinancePayPanel, CryptoPayPanel } from "@/components/site/crypto-pay";
import { PaypalPayPanel } from "@/components/site/paypal-pay";
import { RequireAuth } from "@/components/site/require-auth";
import {
  DemoNote,
  PageHead,
  SiteShell,
  btnOutline,
  btnPrimary,
  field,
} from "@/components/site/shell";
import { useFormat, useI18n } from "@/lib/i18n";
import { allPackages, findPackage, type CreditPackage } from "@/lib/packages";
import { usePaymentConfig } from "@/lib/payment-config";
import { useApp, type Order } from "@/lib/store";
import type { PaymentConfig, TopUpIntent, TopUpMethod } from "@/lib/types";
import { MIN_TOPUP_CENTS } from "@/lib/wallet";

export const Route = createFileRoute("/payment")({
  validateSearch: (s: Record<string, unknown>): { package?: string } =>
    typeof s["package"] === "string" ? { package: s["package"] } : {},
  head: () => ({ meta: [{ title: "Ödeme — TrAi Pro" }] }),
  component: PaymentPage,
});

const methodIcons: Record<TopUpMethod, LucideIcon> = {
  usdt_bep20: Bitcoin,
  binance_pay: Wallet,
  paypal: CreditCard,
  demo: FlaskConical,
};

const QUICK_AMOUNTS = [5, 10, 25, 50, 100];

/** Yapılandırmada açık olan yöntemler, genaipro.io'daki sırayla. */
function enabledMethods(cfg: PaymentConfig | undefined): TopUpMethod[] {
  if (!cfg) return [];
  const list: TopUpMethod[] = [];
  if (cfg.binancePay) list.push("binance_pay");
  if (cfg.usdtBep20) list.push("usdt_bep20");
  if (cfg.paypal) list.push("paypal");
  if (cfg.demo) list.push("demo");
  return list;
}

function usePkgLabel() {
  const { t } = useI18n();
  const f = useFormat();
  return (p: CreditPackage) =>
    p.kind === "voice"
      ? `${t.nav.voice} · ${t.packages.credits(f.num(p.credits))}`
      : `${t.packages.mediaName} · ${t.packages.days(p.days)}`;
}

function Note({ ok, text }: { ok: boolean; text: string }) {
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <p
      role={ok ? "status" : "alert"}
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${ok ? "border-cyan/40 bg-cyan/10 text-cyan" : "border-destructive/40 bg-destructive/10 text-destructive"}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {text}
    </p>
  );
}

function TopUpPanel({ amount, setAmount }: { amount: string; setAmount: (v: string) => void }) {
  const { t } = useI18n();
  const f = useFormat();
  const { topUp, data } = useApp();
  const config = usePaymentConfig();
  const methods = enabledMethods(config.data);
  const [method, setMethod] = useState<TopUpMethod | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = method && methods.includes(method) ? method : (methods[0] ?? null);
  const usdtAddress = config.data?.usdtBep20?.address;
  const binanceId = config.data?.binancePay?.binanceId;
  const paypal = config.data?.paypal;
  const hasPanel = (m: TopUpMethod) =>
    (m === "usdt_bep20" && !!usdtAddress) ||
    (m === "binance_pay" && !!binanceId) ||
    (m === "paypal" && !!paypal);
  // Süresi dolmamış talep varsa (sayfaya geri dönüldüğünde) ödeme paneli açık gelir.
  const [active, setActive] = useState<TopUpIntent | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const shown =
    active ??
    data.wallet.pending.find((p) => hasPanel(p.method) && !dismissed.includes(p.id)) ??
    null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    const cents = Math.round(Number(amount.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents < MIN_TOPUP_CENTS) {
      return setNote({ ok: false, text: t.payment.minAmount(f.usd(MIN_TOPUP_CENTS / 100)) });
    }
    setNote(null);
    setBusy(true);
    const res = await topUp(chosen, cents);
    setBusy(false);
    if (!res.ok) {
      return setNote({
        ok: false,
        text:
          res.error === "tooManyAttempts"
            ? t.auth.errors.tooManyAttempts(res.retryAfterMinutes)
            : res.error === "methodDisabled"
              ? t.payment.disabled
              : t.payment.failed,
      });
    }
    if (res.intent.status === "completed") {
      setNote({ ok: true, text: t.payment.topUpDone(f.usd(res.intent.creditCents / 100)) });
    } else if (hasPanel(res.intent.method)) {
      setActive(res.intent);
    }
  };

  const closePanel = () => {
    if (shown) setDismissed((d) => [...d, shown.id]);
    setActive(null);
  };
  const finish = (text: string) => {
    closePanel();
    setNote({ ok: true, text });
  };

  return (
    <section aria-labelledby="topup" className="glass glow-border h-fit rounded-3xl p-6">
      <h2 id="topup" className="mb-4 text-lg font-semibold">
        {t.payment.topUpTitle}
      </h2>
      {config.isPending ? (
        <div className="space-y-3" aria-busy="true" aria-label={t.loading}>
          <div className="shimmer h-11 rounded-xl" />
          <div className="shimmer h-24 rounded-2xl" />
        </div>
      ) : shown?.method === "usdt_bep20" && usdtAddress ? (
        <CryptoPayPanel intent={shown} address={usdtAddress} onClose={closePanel} onDone={finish} />
      ) : shown?.method === "binance_pay" && binanceId ? (
        <BinancePayPanel
          intent={shown}
          binanceId={binanceId}
          onClose={closePanel}
          onDone={finish}
        />
      ) : shown?.method === "paypal" && paypal ? (
        <PaypalPayPanel
          intent={shown}
          clientId={paypal.clientId}
          sandbox={paypal.sandbox}
          onClose={closePanel}
          onDone={finish}
        />
      ) : methods.length === 0 ? (
        <Note ok={false} text={t.payment.noMethods} />
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="topup-amount" className="mb-1.5 block text-sm font-medium">
              {t.payment.amount}
            </label>
            <input
              id="topup-amount"
              inputMode="decimal"
              className={field}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-describedby="topup-min"
            />
            <p id="topup-min" className="mt-1.5 text-xs text-muted-foreground">
              {t.payment.minAmount(f.usd(MIN_TOPUP_CENTS / 100))}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(String(v))}
                  aria-pressed={amount === String(v)}
                  className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition ${amount === String(v) ? "border-cyan bg-cyan/10 text-cyan" : "border-border hover:border-cyan/50"}`}
                >
                  {f.usd(v)}
                </button>
              ))}
            </div>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t.payment.method}</legend>
            <div className="grid gap-2">
              {methods.map((m) => {
                const Icon = methodIcons[m];
                return (
                  <label
                    key={m}
                    className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${chosen === m ? "border-cyan bg-cyan/10" : "border-border hover:border-cyan/50"}`}
                  >
                    <input
                      type="radio"
                      name="topup-method"
                      value={m}
                      checked={chosen === m}
                      onChange={() => setMethod(m)}
                      className="mt-1 h-4 w-4 accent-[var(--violet)]"
                    />
                    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-cyan" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold">{t.payment.methods[m]}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t.payment.methodHints[m]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {note && <Note ok={note.ok} text={note.text} />}
          <button type="submit" disabled={busy || !chosen} className={`${btnPrimary} w-full`}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t.payment.continue}
          </button>
        </form>
      )}
    </section>
  );
}

function Payment() {
  const { t } = useI18n();
  const f = useFormat();
  const search = Route.useSearch();
  const { data, purchase } = useApp();
  const pkgLabel = usePkgLabel();
  const [selected, setSelected] = useState<string | undefined>(findPackage(search.package)?.id);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("10");
  const topUpRef = useRef<HTMLDivElement>(null);
  const pkg = findPackage(selected);
  const balance = data.wallet.balanceCents;
  const price = pkg ? Math.round(pkg.priceUsd * 100) : 0;
  const missing = Math.max(0, price - balance);
  const usd = (cents: number) => f.usd(cents / 100);

  useEffect(() => setError(null), [selected]);

  const buy = async () => {
    if (!pkg) return;
    setBusy(true);
    setError(null);
    const res = await purchase(pkg.id);
    setBusy(false);
    if (res.ok) return setDone(res.order);
    setError(
      res.error === "insufficientBalance" ? t.payment.insufficient(usd(missing)) : t.payment.failed,
    );
  };

  const fillMissing = () => {
    setAmount(String(Math.max(MIN_TOPUP_CENTS, missing) / 100));
    topUpRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    topUpRef.current?.querySelector("input")?.focus();
  };

  if (done) {
    return (
      <div className="mx-auto max-w-lg px-4 pb-24 sm:px-6">
        <div className="glass glow-border rounded-3xl p-10 text-center shadow-glow">
          <CheckCircle2 className="mx-auto h-14 w-14 text-cyan" aria-hidden />
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
    <div className="mx-auto max-w-5xl space-y-6 px-4 pb-24 sm:px-6">
      <div className="glass glow-border flex items-center gap-4 rounded-3xl p-6">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
          <Wallet className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <p className="text-sm text-muted-foreground">{t.payment.balance}</p>
          <p className="font-display text-3xl font-bold">{usd(balance)}</p>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <section aria-labelledby="packs" className="glass glow-border h-fit rounded-3xl p-6">
          <h2 id="packs" className="mb-4 text-lg font-semibold">
            {t.payment.packTitle}
          </h2>
          <fieldset className="space-y-3">
            <legend className="sr-only">{t.payment.choose}</legend>
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
          </fieldset>

          <div className="mt-6 border-t border-border pt-5">
            {pkg ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t.payment.price}</dt>
                  <dd className="font-semibold">{usd(price)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t.payment.balance}</dt>
                  <dd className="font-semibold">{usd(balance)}</dd>
                </div>
                {missing === 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{t.payment.afterPurchase}</dt>
                    <dd className="font-semibold">{usd(balance - price)}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t.payment.pickFirst}</p>
            )}
            {pkg && missing > 0 && (
              <div className="mt-4 space-y-3">
                <Note ok={false} text={t.payment.insufficient(usd(missing))} />
                <button type="button" onClick={fillMissing} className={`${btnOutline} w-full`}>
                  {t.payment.topUpMissing}
                </button>
              </div>
            )}
            {error && missing === 0 && (
              <div className="mt-4">
                <Note ok={false} text={error} />
              </div>
            )}
            <button
              onClick={buy}
              disabled={!pkg || busy || missing > 0}
              className={`${btnPrimary} mt-5 w-full`}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? t.payment.paying : t.payment.payFromBalance}
            </button>
          </div>
        </section>

        <div ref={topUpRef} className="scroll-mt-24">
          <TopUpPanel amount={amount} setAmount={setAmount} />
        </div>
      </div>
    </div>
  );
}

function PaymentPage() {
  const { t } = useI18n();
  const config = usePaymentConfig();
  const demoOnly =
    !!config.data && !config.data.usdtBep20 && !config.data.binancePay && !config.data.paypal;
  return (
    <SiteShell>
      <PageHead title={t.payment.title} sub={t.payment.sub} />
      <RequireAuth>
        <Payment />
        {demoOnly && (
          <div className="-mt-16 px-4 pb-16">
            <DemoNote text={t.demoNotes.payment} />
          </div>
        )}
      </RequireAuth>
    </SiteShell>
  );
}

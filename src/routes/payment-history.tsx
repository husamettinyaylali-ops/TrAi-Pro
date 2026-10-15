import { Link, createFileRoute } from "@tanstack/react-router";
import { Receipt, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import { Balances } from "@/components/labs/tools";
import { RequireAuth } from "@/components/site/require-auth";
import { PageHead, SiteShell, btnPrimary } from "@/components/site/shell";
import { useFormat, useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/payment-history")({
  head: () => ({ meta: [{ title: "Ödeme Geçmişi — TrAi Pro" }] }),
  component: HistoryPage,
});

function Table({
  title,
  heads,
  children,
}: {
  title: string;
  heads: string[];
  children: ReactNode;
}) {
  return (
    <section className="glass glow-border rounded-3xl p-2 sm:p-4">
      <h2 className="px-4 pb-2 pt-3 text-lg font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              {heads.map((h) => (
                <th key={h} scope="col" className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">{children}</tbody>
        </table>
      </div>
    </section>
  );
}

function History() {
  const { t } = useI18n();
  const f = useFormat();
  const { data } = useApp();
  const c = t.history.cols;
  const { wallet, orders } = data;
  const usd = (cents: number) => f.usd(cents / 100);
  const signed = (cents: number) => `${cents > 0 ? "+" : "−"}${usd(Math.abs(cents))}`;

  const name = (kind: "voice" | "media", credits: number, days: number) =>
    kind === "media"
      ? `${t.packages.mediaName} · ${t.packages.days(days)}`
      : `${t.nav.voice} · ${t.packages.credits(f.num(credits))}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pb-24 sm:px-6">
      <Balances />
      <div className="glass glow-border flex flex-wrap items-center justify-between gap-4 rounded-3xl p-6">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
            <Wallet className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <p className="text-sm text-muted-foreground">{t.payment.balance}</p>
            <p className="font-display text-3xl font-bold">{usd(wallet.balanceCents)}</p>
          </div>
        </div>
        <Link to="/payment" className={btnPrimary}>
          {t.history.emptyCta}
        </Link>
      </div>

      {wallet.entries.length === 0 && orders.length === 0 ? (
        <div className="glass glow-border flex flex-col items-center gap-4 rounded-3xl py-16 text-center">
          <Receipt className="h-10 w-10 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">{t.history.empty}</p>
        </div>
      ) : (
        <>
          {wallet.entries.length > 0 && (
            <Table title={t.history.walletTitle} heads={[c.date, c.description, c.amount]}>
              {wallet.entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-3">{f.dateTime(e.createdAt)}</td>
                  <td className="px-4 py-3 font-medium">{t.history.entryKinds[e.kind]}</td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 font-semibold ${e.amountCents > 0 ? "text-cyan" : ""}`}
                  >
                    {signed(e.amountCents)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {orders.length > 0 && (
            <Table
              title={t.history.ordersTitle}
              heads={[c.date, c.pkg, c.credits, c.amount, c.method, c.status, c.expires]}
            >
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="whitespace-nowrap px-4 py-3">{f.dateTime(o.createdAt)}</td>
                  <td className="px-4 py-3 font-medium">{name(o.kind, o.credits, o.days)}</td>
                  <td className="px-4 py-3">{f.num(o.credits)}</td>
                  <td className="px-4 py-3 font-semibold">{f.usd(o.amountUsd)}</td>
                  <td className="px-4 py-3">{t.payment.orderMethods[o.method]}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan/15 px-2.5 py-1 text-xs font-semibold text-cyan">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan" aria-hidden />
                      {t.history.paid}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{f.date(o.expiresAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </div>
  );
}

function HistoryPage() {
  const { t } = useI18n();
  return (
    <SiteShell>
      <PageHead title={t.history.title} sub={t.history.sub} />
      <RequireAuth>
        <History />
      </RequireAuth>
    </SiteShell>
  );
}

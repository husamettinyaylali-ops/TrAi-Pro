import { Link, createFileRoute } from "@tanstack/react-router";
import { Receipt } from "lucide-react";

import { Balances } from "@/components/labs/tools";
import { RequireAuth } from "@/components/site/require-auth";
import { PageHead, SiteShell, btnPrimary } from "@/components/site/shell";
import { useFormat, useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/payment-history")({
  head: () => ({ meta: [{ title: "Ödeme Geçmişi — TrAi Pro" }] }),
  component: HistoryPage,
});

function History() {
  const { t } = useI18n();
  const f = useFormat();
  const { data } = useApp();
  const c = t.history.cols;

  const name = (kind: "voice" | "media", credits: number, days: number) =>
    kind === "media"
      ? `${t.packages.mediaName} · ${t.packages.days(days)}`
      : `${t.nav.voice} · ${t.packages.credits(f.num(credits))}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pb-24 sm:px-6">
      <Balances />
      <div className="glass glow-border rounded-3xl p-2 sm:p-4">
        {data.orders.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <Receipt className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">{t.history.empty}</p>
            <Link to="/pricing" className={btnPrimary}>
              {t.history.emptyCta}
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  {[c.date, c.pkg, c.credits, c.amount, c.method, c.status, c.expires].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap px-4 py-3">{f.dateTime(o.createdAt)}</td>
                    <td className="px-4 py-3 font-medium">{name(o.kind, o.credits, o.days)}</td>
                    <td className="px-4 py-3">{f.num(o.credits)}</td>
                    <td className="px-4 py-3 font-semibold">{f.usd(o.amountUsd)}</td>
                    <td className="px-4 py-3">{t.payment.methods[o.method]}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan/15 px-2.5 py-1 text-xs font-semibold text-cyan">
                        <span className="h-1.5 w-1.5 rounded-full bg-cyan" aria-hidden />
                        {t.history.paid}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{f.date(o.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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

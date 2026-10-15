import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Loader2, Search, ShieldAlert } from "lucide-react";

import { RequireAuth } from "@/components/site/require-auth";
import { PageHead, SiteShell, btnPrimary, field } from "@/components/site/shell";
import { useAdjustBalance, useAdminDashboard, useAdminSearch, useAdminUser } from "@/lib/admin";
import { useFormat, useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";
import type { AdminAction, AdminUserRow } from "@/lib/types";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Yönetim — TrAi Pro" }] }),
  component: AdminPage,
});

const card = "glass glow-border rounded-3xl p-4 sm:p-6";

function useMoney() {
  const f = useFormat();
  const usd = (cents: number) => f.usd(cents / 100);
  return {
    usd,
    signed: (cents: number) => `${cents > 0 ? "+" : "−"}${usd(Math.abs(cents))}`,
  };
}

function Table({ heads, children }: { heads: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            {heads.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

const td = "px-3 py-2 align-top";

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {empty ? <p className="text-sm text-muted-foreground">{t.admin.empty}</p> : children}
    </section>
  );
}

function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone === "danger" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}
    >
      {children}
    </span>
  );
}

function Stats() {
  const { t } = useI18n();
  const f = useFormat();
  const { usd } = useMoney();
  const q = useAdminDashboard();
  const s = t.admin.stats;
  if (q.isPending) {
    return (
      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-5"
        aria-busy="true"
        aria-label={t.loading}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="shimmer h-24 rounded-3xl" />
        ))}
      </div>
    );
  }
  if (!q.data?.ok) return null;
  const o = q.data.overview;
  const items: [string, string][] = [
    [s.users, f.num(o.users)],
    [s.deletedUsers, f.num(o.deletedUsers)],
    [s.liability, usd(o.liabilityCents)],
    [s.topUps24h, usd(o.topUps24hCents)],
    [s.pending, f.num(o.pendingIntents)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {items.map(([label, value]) => (
        <div key={label} className="glass glow-border rounded-3xl p-4">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 font-display text-2xl font-bold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function UserSearch({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const { usd } = useMoney();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(input.trim()), 300);
    return () => window.clearTimeout(id);
  }, [input]);
  const q = useAdminSearch(query);
  const users: AdminUserRow[] = q.data?.ok ? q.data.users : [];

  return (
    <section aria-labelledby="admin-search" className={card}>
      <h2 id="admin-search" className="mb-3 text-lg font-semibold">
        {t.admin.search}
      </h2>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          aria-label={t.admin.search}
          placeholder={t.admin.searchPlaceholder}
          className={`${field} pl-9`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>
      <div className="mt-3" aria-busy={q.isFetching}>
        {q.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="shimmer h-14 rounded-2xl" />
            ))}
          </div>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t.admin.loadFailed}
          </p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.admin.noResults}</p>
        ) : (
          <ul className="space-y-1">
            {users.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => onSelect(u.id)}
                  aria-pressed={selected === u.id}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left transition ${selected === u.id ? "border-cyan bg-cyan/10" : "border-transparent hover:border-border"}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {u.deletedAt ? t.admin.deletedName : u.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {u.deletedAt && <Badge tone="danger">{t.admin.deleted}</Badge>}
                      {!u.deletedAt && !u.verified && <Badge>{t.admin.unverified}</Badge>}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold">{usd(u.balanceCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function AdjustForm({ userId }: { userId: string }) {
  const { t } = useI18n();
  const { usd } = useMoney();
  const adjust = useAdjustBalance();
  const a = t.admin.adjust;
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const cents = Math.round(Number(amount.replace(",", ".")) * 100);
  const valid = Number.isFinite(cents) && cents !== 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return setNote({ ok: false, text: a.errors.invalidInput });
    setBusy(true);
    const res = await adjust({ userId, amountCents: cents, reason });
    setBusy(false);
    if (res.ok) {
      setAmount("");
      setReason("");
      return setNote({ ok: true, text: a.done(usd(res.balanceCents)) });
    }
    setNote({ ok: false, text: a.errors[res.error] });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-2xl border border-border p-4">
      <h3 className="text-sm font-semibold">{a.title}</h3>
      <div>
        <label htmlFor="adjust-amount" className="mb-1.5 block text-sm font-medium">
          {a.amount}
        </label>
        <input
          id="adjust-amount"
          inputMode="decimal"
          className={field}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-describedby="adjust-amount-hint"
        />
        <p id="adjust-amount-hint" className="mt-1 text-xs text-muted-foreground">
          {a.amountHint}
        </p>
      </div>
      <div>
        <label htmlFor="adjust-reason" className="mb-1.5 block text-sm font-medium">
          {a.reason}
        </label>
        <textarea
          id="adjust-reason"
          rows={2}
          maxLength={500}
          className={field}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-describedby="adjust-reason-hint"
        />
        <p id="adjust-reason-hint" className="mt-1 text-xs text-muted-foreground">
          {a.reasonHint}
        </p>
      </div>
      {note && (
        <p
          role={note.ok ? "status" : "alert"}
          className={`flex items-start gap-2 text-sm ${note.ok ? "text-cyan" : "text-destructive"}`}
        >
          {note.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          {note.text}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !valid || reason.trim().length < 5}
        className={`${btnPrimary} w-full`}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy
          ? a.saving
          : valid
            ? cents > 0
              ? a.add(usd(cents))
              : a.subtract(usd(-cents))
            : a.submit}
      </button>
    </form>
  );
}

function ActionRows({ actions, showTarget }: { actions: AdminAction[]; showTarget: boolean }) {
  const { t } = useI18n();
  const f = useFormat();
  const { signed } = useMoney();
  const c = t.admin.cols;
  return (
    <Table heads={[c.date, c.admin, ...(showTarget ? [c.target] : []), c.kind, c.amount, c.reason]}>
      {actions.map((a) => (
        <tr key={a.id}>
          <td className={`${td} whitespace-nowrap`}>{f.dateTime(a.createdAt)}</td>
          <td className={td}>{a.adminEmail}</td>
          {showTarget && <td className={td}>{a.targetEmail ?? "—"}</td>}
          <td className={td}>{t.admin.actionKinds[a.action]}</td>
          <td className={`${td} whitespace-nowrap font-semibold`}>
            {a.amountCents === null ? "—" : signed(a.amountCents)}
          </td>
          <td className={`${td} max-w-xs break-words`}>{a.reason}</td>
        </tr>
      ))}
    </Table>
  );
}

function UserPanel({ userId }: { userId: string | null }) {
  const { t } = useI18n();
  const f = useFormat();
  const { usd, signed } = useMoney();
  const q = useAdminUser(userId);
  const c = t.admin.cols;

  if (!userId) {
    return (
      <section className={`${card} grid min-h-48 place-items-center text-center`}>
        <p className="text-sm text-muted-foreground">{t.admin.pickUser}</p>
      </section>
    );
  }
  if (q.isPending) {
    return (
      <section className={`${card} space-y-3`} aria-busy="true" aria-label={t.loading}>
        <div className="shimmer h-16 rounded-2xl" />
        <div className="shimmer h-40 rounded-2xl" />
        <div className="shimmer h-32 rounded-2xl" />
      </section>
    );
  }
  if (q.isError || !q.data?.ok) {
    return (
      <section className={card}>
        <p role="alert" className="text-sm text-destructive">
          {q.data && !q.data.ok && q.data.error === "notFound"
            ? t.admin.adjust.errors.notFound
            : t.admin.loadFailed}
        </p>
      </section>
    );
  }
  const { user, entries, intents, orders, actions } = q.data.detail;

  return (
    <section aria-labelledby="admin-user" className={`${card} space-y-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="admin-user" className="truncate text-lg font-semibold">
            {user.deletedAt ? t.admin.deletedName : user.name}
          </h2>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.admin.joined(f.date(user.createdAt))} · {t.admin.userId}:{" "}
            <span className="font-mono">{user.id}</span>
          </p>
          <span className="mt-2 flex flex-wrap gap-1">
            {user.deletedAt && <Badge tone="danger">{t.admin.deleted}</Badge>}
            {!user.deletedAt && !user.verified && <Badge>{t.admin.unverified}</Badge>}
          </span>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{t.admin.balance}</p>
          <p className="font-display text-3xl font-bold">{usd(user.balanceCents)}</p>
        </div>
      </div>

      <AdjustForm key={user.id} userId={user.id} />

      <Section title={t.admin.entries} empty={entries.length === 0}>
        <Table heads={[c.date, c.kind, c.amount, c.reference]}>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className={`${td} whitespace-nowrap`}>{f.dateTime(e.createdAt)}</td>
              <td className={td}>{t.history.entryKinds[e.kind]}</td>
              <td
                className={`${td} whitespace-nowrap font-semibold ${e.amountCents > 0 ? "text-cyan" : ""}`}
              >
                {signed(e.amountCents)}
              </td>
              <td className={`${td} break-all font-mono text-xs`}>{e.reference ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title={t.admin.intents} empty={intents.length === 0}>
        <Table heads={[c.date, c.method, c.payAmount, c.status, c.providerRef]}>
          {intents.map((i) => (
            <tr key={i.id}>
              <td className={`${td} whitespace-nowrap`}>{f.dateTime(i.createdAt)}</td>
              <td className={td}>{t.payment.methods[i.method]}</td>
              <td className={`${td} whitespace-nowrap font-mono`}>
                {i.payAmount} {i.payCurrency}
              </td>
              <td className={td}>{t.admin.intentStatus[i.status]}</td>
              <td className={`${td} break-all font-mono text-xs`}>{i.providerRef ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title={t.admin.orders} empty={orders.length === 0}>
        <Table heads={[c.date, c.pkg, c.amount]}>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className={`${td} whitespace-nowrap`}>{f.dateTime(o.createdAt)}</td>
              <td className={td}>{o.packageId}</td>
              <td className={`${td} font-semibold`}>{f.usd(o.amountUsd)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title={t.admin.actions} empty={actions.length === 0}>
        <ActionRows actions={actions} showTarget={false} />
      </Section>
    </section>
  );
}

function RecentActions() {
  const { t } = useI18n();
  const q = useAdminDashboard();
  if (!q.data?.ok) return null;
  return (
    <section aria-labelledby="admin-actions" className={card}>
      <h2 id="admin-actions" className="mb-3 text-lg font-semibold">
        {t.admin.recentActions}
      </h2>
      {q.data.actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.admin.empty}</p>
      ) : (
        <ActionRows actions={q.data.actions} showTarget />
      )}
    </section>
  );
}

function Forbidden() {
  const { t } = useI18n();
  return (
    <div className={`${card} mx-auto flex max-w-xl flex-col items-center gap-3 py-12 text-center`}>
      <ShieldAlert className="h-10 w-10 text-muted-foreground" aria-hidden />
      <p role="alert">{t.admin.forbidden}</p>
    </div>
  );
}

export function AdminPanel() {
  const { admin } = useApp();
  const dashboard = useAdminDashboard();
  const [selected, setSelected] = useState<string | null>(null);
  // Menü bayrağı eskiyse (yetki kaldırıldı) sunucunun cevabı esas alınır.
  if (!admin || (dashboard.data && !dashboard.data.ok)) return <Forbidden />;
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-24 sm:px-6">
      <Stats />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <UserSearch selected={selected} onSelect={setSelected} />
        <UserPanel userId={selected} />
      </div>
      <RecentActions />
    </div>
  );
}

function AdminPage() {
  const { t } = useI18n();
  return (
    <SiteShell>
      <PageHead title={t.admin.title} sub={t.admin.sub} />
      <RequireAuth>
        <AdminPanel />
      </RequireAuth>
    </SiteShell>
  );
}

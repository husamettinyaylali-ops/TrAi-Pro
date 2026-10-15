import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, LogOut, Trash2 } from "lucide-react";

import { GoogleMark } from "@/components/site/google-mark";
import { RequireAuth } from "@/components/site/require-auth";
import { PageHead, SiteShell, btnOutline, btnPrimary, field } from "@/components/site/shell";
import { isGoogleError } from "@/lib/google-errors";
import { useFormat, useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/account")({
  validateSearch: (s: Record<string, unknown>): { error?: string; linked?: string } => ({
    ...(typeof s["error"] === "string" ? { error: s["error"] } : {}),
    ...(typeof s["linked"] === "string" ? { linked: s["linked"] } : {}),
  }),
  head: () => ({ meta: [{ title: "Hesabım — TrAi Pro" }] }),
  component: AccountPage,
});

type Note = { kind: "ok" | "error"; text: string } | null;

/** Durum yalnız renkle verilmez: simge ve rol (status/alert) birlikte. */
function Message({ note }: { note: Note }) {
  if (!note) return null;
  const ok = note.kind === "ok";
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <p
      role={ok ? "status" : "alert"}
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${ok ? "border-cyan/40 bg-cyan/10 text-cyan" : "border-destructive/40 bg-destructive/10 text-destructive"}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {note.text}
    </p>
  );
}

function Section({
  id,
  title,
  sub,
  children,
}: {
  id: string;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="glass glow-border rounded-3xl p-6 sm:p-8">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      <div className="mt-6 space-y-4">{children}</div>
    </section>
  );
}

function useErrorText() {
  const { t } = useI18n();
  return (res: { error: string; retryAfterMinutes?: number }) => {
    if (res.error === "tooManyAttempts" && res.retryAfterMinutes) {
      return t.auth.errors.tooManyAttempts(res.retryAfterMinutes);
    }
    if (res.error === "network") return t.auth.errors.network;
    const known = t.accountPage.errors as Record<string, string>;
    return known[res.error] ?? t.labs.failed;
  };
}

const label = "mb-1.5 block text-sm font-medium";

function ProfileSection() {
  const { t } = useI18n();
  const f = useFormat();
  const { user, updateName } = useApp();
  const errorText = useErrorText();
  const [name, setName] = useState(user?.name ?? "");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await updateName(name);
    setBusy(false);
    setNote(
      res.ok ? { kind: "ok", text: t.accountPage.saved } : { kind: "error", text: errorText(res) },
    );
  };

  return (
    <Section
      id="profile"
      title={t.accountPage.profile}
      sub={t.accountPage.memberSince(f.date(user.createdAt))}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="acc-name" className={label}>
            {t.auth.name}
          </label>
          <input
            id="acc-name"
            autoComplete="name"
            maxLength={80}
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <span className={label}>{t.auth.email}</span>
          <p className="rounded-xl border border-input bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
            {user.email}
          </p>
        </div>
        <Message note={note} />
        <button
          type="submit"
          disabled={busy || !name.trim() || name.trim() === user.name}
          className={btnPrimary}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t.accountPage.save}
        </button>
      </form>
    </Section>
  );
}

function MethodsSection({ initial }: { initial: Note }) {
  const { t } = useI18n();
  const { data, unlinkGoogle } = useApp();
  const errorText = useErrorText();
  const [note, setNote] = useState<Note>(initial);
  const [busy, setBusy] = useState(false);
  const { hasPassword, googleLinked } = data.security;

  const unlink = async () => {
    setBusy(true);
    const res = await unlinkGoogle();
    setBusy(false);
    setNote(
      res.ok
        ? { kind: "ok", text: t.accountPage.googleUnlinked }
        : { kind: "error", text: errorText(res) },
    );
  };

  const row = "flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/40 px-4 py-3";
  const badge = (on: boolean, yes: string, no: string) => (
    <span className={`text-sm ${on ? "text-cyan" : "text-muted-foreground"}`}>
      {on ? `✓ ${yes}` : no}
    </span>
  );

  return (
    <Section id="methods" title={t.accountPage.methods}>
      <div className={row}>
        <span className="flex items-center gap-3 font-medium">
          <KeyRound className="h-5 w-5 text-cyan" aria-hidden />
          {t.accountPage.password}
        </span>
        {badge(hasPassword, t.accountPage.passwordSet, t.accountPage.passwordNone)}
      </div>
      <div className={row}>
        <span className="flex items-center gap-3 font-medium">
          <GoogleMark />
          {t.accountPage.google}
        </span>
        <span className="flex flex-wrap items-center gap-3">
          {badge(googleLinked, t.accountPage.googleLinked, t.accountPage.googleNotLinked)}
          {googleLinked ? (
            <button
              type="button"
              onClick={unlink}
              disabled={busy || !hasPassword}
              className="min-h-11 rounded-full border border-border px-4 text-sm font-semibold transition hover:border-destructive hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
            >
              {t.accountPage.googleUnlink}
            </button>
          ) : (
            // Sunucu rotası; tam sayfa isteğiyle açılır.
            <a
              href="/auth/google?mode=link"
              className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold transition hover:border-cyan hover:text-cyan"
            >
              {t.accountPage.googleLink}
            </a>
          )}
        </span>
      </div>
      {googleLinked && !hasPassword && (
        <p className="text-xs text-muted-foreground">{t.accountPage.googleUnlinkHint}</p>
      )}
      <Message note={note} />
    </Section>
  );
}

function PasswordSection() {
  const { t } = useI18n();
  const { data, changePassword } = useApp();
  const errorText = useErrorText();
  const has = data.security.hasPassword;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setNote({ kind: "error", text: t.auth.errors.password });
    setBusy(true);
    const res = await changePassword(has ? { current, next } : { next });
    setBusy(false);
    if (!res.ok) return setNote({ kind: "error", text: errorText(res) });
    setCurrent("");
    setNext("");
    setNote({ kind: "ok", text: t.accountPage.passwordChanged });
  };

  return (
    <Section
      id="password"
      title={has ? t.accountPage.changePassword : t.accountPage.setPassword}
      {...(has ? {} : { sub: t.accountPage.setPasswordHint })}
    >
      <form onSubmit={submit} className="space-y-4">
        {has && (
          <div>
            <label htmlFor="acc-current" className={label}>
              {t.accountPage.currentPassword}
            </label>
            <input
              id="acc-current"
              type="password"
              autoComplete="current-password"
              className={field}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
        )}
        <div>
          <label htmlFor="acc-next" className={label}>
            {t.accountPage.newPassword}
          </label>
          <input
            id="acc-next"
            type="password"
            autoComplete="new-password"
            className={field}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">{t.auth.passwordHint}</p>
        </div>
        <Message note={note} />
        <button type="submit" disabled={busy || !next || (has && !current)} className={btnPrimary}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {has ? t.accountPage.changePassword : t.accountPage.setPassword}
        </button>
      </form>
    </Section>
  );
}

function SessionsSection() {
  const { t } = useI18n();
  const { signOutOthers } = useApp();
  const errorText = useErrorText();
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const res = await signOutOthers();
    setBusy(false);
    setNote(
      res.ok
        ? { kind: "ok", text: t.accountPage.signedOutOthers }
        : { kind: "error", text: errorText(res) },
    );
  };

  return (
    <Section id="sessions" title={t.accountPage.sessions} sub={t.accountPage.sessionsSub}>
      <Message note={note} />
      <button type="button" onClick={run} disabled={busy} className={btnOutline}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        {t.accountPage.signOutOthers}
      </button>
    </Section>
  );
}

function DangerSection() {
  const { t } = useI18n();
  const { user, data, deleteAccount, forget } = useApp();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const has = data.security.hasPassword;
  if (!user) return null;

  const matches = confirmEmail.trim().toLocaleLowerCase("en-US") === user.email;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await deleteAccount(has ? { confirmEmail, password } : { confirmEmail });
    if (!res.ok) {
      setBusy(false);
      return setNote({ kind: "error", text: errorText(res) });
    }
    // Önce korumalı sayfadan çık, sonra yerel oturumu sil; aksi halde giriş sayfasına yönlenir.
    await navigate({ to: "/" });
    forget();
  };

  return (
    <section
      aria-labelledby="danger"
      className="rounded-3xl border border-destructive/40 p-6 sm:p-8"
    >
      <h2 id="danger" className="flex items-center gap-2 text-xl font-semibold text-destructive">
        <Trash2 className="h-5 w-5" aria-hidden />
        {t.accountPage.danger}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t.accountPage.dangerSub}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="acc-confirm" className={label}>
            {t.accountPage.confirmEmail}:{" "}
            <span className="font-normal text-muted-foreground">{user.email}</span>
          </label>
          <input
            id="acc-confirm"
            type="email"
            autoComplete="off"
            className={field}
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
          />
        </div>
        {has && (
          <div>
            <label htmlFor="acc-delete-password" className={label}>
              {t.accountPage.currentPassword}
            </label>
            <input
              id="acc-delete-password"
              type="password"
              autoComplete="current-password"
              className={field}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
        <Message note={note} />
        <button
          type="submit"
          disabled={busy || !matches || (has && !password)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-destructive/60 px-6 py-3 font-semibold text-destructive transition hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:pointer-events-none disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? t.accountPage.deleting : t.accountPage.deleteButton}
        </button>
      </form>
    </section>
  );
}

function Account() {
  const { t } = useI18n();
  const { error, linked } = Route.useSearch();
  const initial: Note =
    linked === "google"
      ? { kind: "ok", text: t.accountPage.googleLinkedNow }
      : isGoogleError(error)
        ? { kind: "error", text: t.auth.errors[error] }
        : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pb-24 sm:px-6">
      <ProfileSection />
      <MethodsSection initial={initial} />
      <PasswordSection />
      <SessionsSection />
      <DangerSection />
    </div>
  );
}

function AccountPage() {
  const { t } = useI18n();
  return (
    <SiteShell>
      <PageHead title={t.accountPage.title} sub={t.accountPage.sub} />
      <RequireAuth>
        <Account />
      </RequireAuth>
    </SiteShell>
  );
}

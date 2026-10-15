import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Coins,
  CreditCard,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  Moon,
  Receipt,
  Send,
  Sun,
  User,
  Wand2,
  X,
  Youtube,
} from "lucide-react";

import { CursorGlow, Logo } from "@/components/landing/fx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { balance } from "@/lib/credits";
import { useFormat, useI18n } from "@/lib/i18n";
import { site } from "@/lib/packages";
import { clock } from "@/lib/clock";
import { useApp } from "@/lib/store";

export const btnPrimary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-brand px-7 py-3 font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-105 disabled:pointer-events-none disabled:opacity-60 pulse-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
export const btnOutline =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full glass px-7 py-3 font-semibold transition hover:border-cyan hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const field =
  "w-full rounded-xl border border-input bg-muted/60 px-4 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

export const THEME_KEY = "traipro:theme";

export function ThemeToggle() {
  const { t } = useI18n();
  const [light, setLight] = useState(false);
  useEffect(() => setLight(document.documentElement.classList.contains("light")), []);
  const toggle = () => {
    const next = !light;
    const root = document.documentElement;
    root.classList.toggle("light", next);
    root.classList.toggle("dark", !next);
    try {
      localStorage.setItem(THEME_KEY, next ? "light" : "dark");
    } catch {
      /* yoksay */
    }
    setLight(next);
  };
  return (
    <button
      onClick={toggle}
      aria-label={light ? t.theme.toDark : t.theme.toLight}
      title={light ? t.theme.toDark : t.theme.toLight}
      className="glass grid h-11 w-11 place-items-center rounded-full transition hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {light ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div
      className="glass flex rounded-full p-1 text-xs font-bold"
      role="group"
      aria-label="Dil / Language"
    >
      {(["tr", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`min-h-9 rounded-full px-3 uppercase transition ${lang === l ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function CreditBadge() {
  const { data } = useApp();
  const { t } = useI18n();
  const f = useFormat();
  const v = balance(data.grants, "voice", clock());
  return (
    <Link
      to="/payment-history"
      title={t.labs.voiceBalance}
      className="glass inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition hover:text-cyan"
    >
      <Coins className="h-4 w-4 text-cyan" />
      {f.num(v)}
    </Link>
  );
}

function UserMenu() {
  const { user, signOut } = useApp();
  const { t } = useI18n();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t.account}
        className="grid h-11 w-11 place-items-center rounded-full bg-gradient-brand font-bold text-primary-foreground shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {user.name.charAt(0).toLocaleUpperCase("tr-TR") || <User className="h-4 w-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate">{user.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/account" })}>
          <User /> {t.accountPage.title}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/labs" })}>
          <Wand2 /> {t.labs.title}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/payment" })}>
          <CreditCard /> {t.footer.payment}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/payment-history" })}>
          <Receipt /> {t.footer.paymentHistory}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            // Önce korumalı sayfadan çık, sonra oturumu kapat; aksi halde giriş sayfasına yönlenir.
            void navigate({ to: "/" }).then(() => signOut());
          }}
        >
          <LogOut /> {t.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const navCls = "transition hover:text-foreground [&.active]:text-foreground";

function Header() {
  const { t } = useI18n();
  const { user, hydrated, signOut } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/60 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="hidden gap-8 text-sm text-muted-foreground lg:flex">
          <Link to="/labs" search={{ tab: "tts" }} className={navCls}>
            {t.nav.voice}
          </Link>
          <Link to="/labs" search={{ tab: "image" }} className={navCls}>
            {t.nav.media}
          </Link>
          <Link to="/pricing" className={navCls}>
            {t.nav.pricing}
          </Link>
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <ThemeToggle />
          <LangToggle />
          {!hydrated ? (
            <span className="shimmer h-11 w-40 rounded-full" aria-label={t.loading} />
          ) : user ? (
            <>
              <CreditBadge />
              <UserMenu />
            </>
          ) : (
            <>
              <Link
                to="/sign-in"
                search={{}}
                className="min-h-11 rounded-full px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
              >
                {t.signIn}
              </Link>
              <Link
                to="/sign-up"
                search={{}}
                className="rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
              >
                {t.signUp}
              </Link>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 lg:hidden">
          {hydrated && user && <CreditBadge />}
          <button
            className="grid h-11 w-11 place-items-center"
            onClick={() => setOpen(true)}
            aria-label={t.menu}
            aria-expanded={open}
          >
            <Menu />
          </button>
        </div>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-background/95 p-6 backdrop-blur-xl animate-in slide-in-from-right lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t.menu}
        >
          <div className="flex items-center justify-between">
            <Logo />
            <button
              className="grid h-11 w-11 place-items-center"
              onClick={close}
              aria-label={t.close}
            >
              <X />
            </button>
          </div>
          <nav className="mt-10 flex flex-col gap-6 font-display text-2xl">
            <Link to="/labs" search={{ tab: "tts" }} onClick={close}>
              {t.nav.voice}
            </Link>
            <Link to="/labs" search={{ tab: "image" }} onClick={close}>
              {t.nav.media}
            </Link>
            <Link to="/pricing" onClick={close}>
              {t.nav.pricing}
            </Link>
            {user && (
              <>
                <Link to="/account" onClick={close}>
                  {t.accountPage.title}
                </Link>
                <Link to="/payment" onClick={close}>
                  {t.footer.payment}
                </Link>
                <Link to="/payment-history" onClick={close}>
                  {t.footer.paymentHistory}
                </Link>
              </>
            )}
          </nav>
          <div className="mt-10 flex items-center gap-3">
            <ThemeToggle />
            <LangToggle />
          </div>
          <div className="mt-8 flex flex-col gap-3">
            {user ? (
              <button
                className={btnOutline}
                onClick={() => {
                  close();
                  void navigate({ to: "/" }).then(() => signOut());
                }}
              >
                <LogOut className="h-4 w-4" /> {t.signOut}
              </button>
            ) : (
              <>
                <Link to="/sign-up" search={{}} onClick={close} className={btnPrimary}>
                  {t.signUp}
                </Link>
                <Link to="/sign-in" search={{}} onClick={close} className={btnOutline}>
                  {t.signIn}
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  const { t } = useI18n();
  const linkCls = "transition hover:text-cyan";
  const socials = [
    { href: site.social.whatsapp, label: "WhatsApp", icon: MessageCircle },
    { href: site.social.telegram, label: "Telegram", icon: Send },
    { href: site.social.youtube, label: "YouTube", icon: Youtube },
  ].filter((s) => s.href);

  return (
    <footer className="relative border-t border-border">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">{t.footer.tagline}</p>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t.footer.services}
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link to="/labs" search={{ tab: "tts" }} className={linkCls}>
                  {t.nav.voice}
                </Link>
              </li>
              <li>
                <Link to="/pricing" className={linkCls}>
                  {t.nav.pricing}
                </Link>
              </li>
              <li className="flex items-center gap-2 text-muted-foreground">
                {t.footer.apiDocs}
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase">
                  {t.soon}
                </span>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t.footer.support}
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link to="/payment" className={linkCls}>
                  {t.footer.payment}
                </Link>
              </li>
              <li>
                <Link to="/payment-history" className={linkCls}>
                  {t.footer.paymentHistory}
                </Link>
              </li>
              <li>
                <a href={`mailto:${site.email}`} className={linkCls}>
                  {t.footer.contact}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${site.email}`}
                  className={`inline-flex items-center gap-2 text-muted-foreground ${linkCls}`}
                >
                  <Mail className="h-4 w-4" />
                  {site.email}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-14 flex flex-col gap-6 border-t border-border pt-8 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
          <p>© 2026 TrAi Pro. {t.footer.rights}</p>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/terms-of-service" className={linkCls}>
              {t.footer.legal.terms}
            </Link>
            <Link to="/privacy-policy" className={linkCls}>
              {t.footer.legal.privacy}
            </Link>
            <Link to="/refund-policy" className={linkCls}>
              {t.footer.legal.refund}
            </Link>
            <Link to="/acceptable-use-policy" className={linkCls}>
              {t.footer.legal.acceptable}
            </Link>
          </nav>
          {socials.length > 0 && (
            <div className="flex gap-2">
              {socials.map(({ href, label, icon: I }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  className="glass grid h-11 w-11 place-items-center rounded-full transition hover:text-cyan"
                >
                  <I className="h-4 w-4" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="blob absolute -left-40 top-0 h-[500px] w-[500px] rounded-full bg-violet/30" />
        <div
          className="blob absolute right-[-10%] top-1/3 h-[450px] w-[450px] rounded-full bg-cyan/20"
          style={{ animationDelay: "-6s" }}
        />
        <div
          className="blob absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-magenta/20"
          style={{ animationDelay: "-12s" }}
        />
      </div>
      <CursorGlow />
      <div className="relative z-10 flex min-h-screen flex-col">
        <Header />
        <main id="top" className="flex-1">
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}

/** Sayfa başlığı bloğu. */
export function PageHead({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-16 text-center sm:px-6">
      {kicker && (
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan">{kicker}</p>
      )}
      <h1 className="mt-3 text-4xl font-bold md:text-5xl">{title}</h1>
      {sub && <p className="mt-4 text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function DemoNote() {
  const { t } = useI18n();
  return (
    <p className="mx-auto mt-6 max-w-2xl rounded-2xl border border-dashed border-border px-4 py-3 text-center text-xs text-muted-foreground">
      {t.demoNote}
    </p>
  );
}

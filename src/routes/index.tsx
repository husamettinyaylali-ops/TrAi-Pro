import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X, Play, Pause, Sparkles, Loader2, Zap, Globe, Wand2, ShieldCheck, Check, ChevronDown, MessageCircle, Star, ArrowRight } from "lucide-react";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { NeuralCanvas, CursorGlow, Reveal, Waveform, Logo } from "@/components/landing/fx";
import { ToolsSection, gens } from "@/components/landing/tools";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TrAi Pro — Yapay Zeka Ses, Video & Görsel Üretimi" },
      { name: "description", content: "1000+ gerçekçi AI sesi, ses klonlama, metinden videoya ve görsel üretimi tek platformda." },
      { property: "og:title", content: "TrAi Pro — AI Content Creation Platform" },
      { property: "og:description", content: "1000+ realistic AI voices, voice cloning, text-to-video and image generation in one platform." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <I18nProvider>
      <Page />
    </I18nProvider>
  ),
});

const btnPrimary = "inline-flex items-center justify-center gap-2 rounded-full bg-gradient-brand px-7 py-3.5 font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-105 pulse-ring";
const btnOutline = "inline-flex items-center justify-center gap-2 rounded-full glass px-7 py-3.5 font-semibold transition hover:border-cyan hover:text-cyan";
const ids = ["features", "cloning", "media", "pricing", "contact"];

function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="glass flex rounded-full p-1 text-xs font-bold">
      {(["tr", "en"] as const).map((l) => (
        <button key={l} onClick={() => setLang(l)} className={`rounded-full px-3 py-1.5 uppercase transition ${lang === l ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground"}`}>{l}</button>
      ))}
    </div>
  );
}

function Header() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/60 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Logo />
        <nav className="hidden gap-8 text-sm text-muted-foreground lg:flex">
          {t.nav.map((n, i) => <a key={n} href={`#${ids[i]}`} className="transition hover:text-foreground">{n}</a>)}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <LangToggle />
          <a href="#pricing" className="rounded-full bg-gradient-brand px-5 py-2 text-sm font-semibold text-primary-foreground shadow-glow">{t.login}</a>
        </div>
        <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-background/95 p-6 backdrop-blur-xl lg:hidden animate-in slide-in-from-right">
          <div className="flex items-center justify-between"><Logo /><button onClick={() => setOpen(false)} aria-label="Close"><X /></button></div>
          <nav className="mt-10 flex flex-col gap-6 text-2xl font-display">
            {t.nav.map((n, i) => <a key={n} href={`#${ids[i]}`} onClick={() => setOpen(false)}>{n}</a>)}
          </nav>
          <div className="mt-10 flex items-center gap-4"><LangToggle /><a href="#pricing" onClick={() => setOpen(false)} className={btnPrimary}>{t.login}</a></div>
        </div>
      )}
    </header>
  );
}

function Hero() {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  const [img, setImg] = useState<"idle" | "load" | "done">("idle");
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="grid-overlay absolute inset-0" />
      <NeuralCanvas />
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 pb-24 pt-20 lg:grid-cols-[1.1fr_1fr] lg:pt-28">
        <div>
          <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium">
            <span className="h-2 w-2 animate-pulse rounded-full bg-cyan" />{t.heroBadge}
          </span>
          <h1 className="mt-6 text-5xl font-bold leading-[1.05] md:text-6xl xl:text-7xl">
            {t.heroTitle} <span className="text-gradient">TrAi Pro</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">{t.heroSub}</p>
          <div className="mt-9 flex flex-wrap gap-4">
            <a href="#pricing" className={btnPrimary}><Sparkles className="h-4 w-4" />{t.start}</a>
            <a href="#features" className={btnOutline}>{t.explore}<ArrowRight className="h-4 w-4" /></a>
          </div>
          <div className="mt-10 flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex">{[1, 2, 3, 4, 5].map((s) => <Star key={s} className="h-4 w-4 fill-cyan text-cyan" />)}</div>
            4.9 · 25.000+ creators
          </div>
        </div>

        <div className="relative space-y-5">
          <div className="glass glow-border rounded-3xl p-6 shadow-glow">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="font-semibold">{t.tts}</span>
              <span className="rounded-full bg-cyan/15 px-2.5 py-0.5 text-xs text-cyan">Defne · TR</span>
            </div>
            <p className="mb-4 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">"{t.ttsSample}"</p>
            <div className="flex items-center gap-4">
              <button onClick={() => setPlaying(!playing)} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-brand text-primary-foreground shadow-glow">
                {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>
              <Waveform playing={playing} bars={44} />
            </div>
          </div>
          <div className="glass glow-border rounded-3xl p-6 lg:ml-12">
            <div className="mb-3 text-sm font-semibold">{t.imgGen}</div>
            <div className="flex gap-2">
              <div className="flex-1 truncate rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">{t.imgPrompt}</div>
              <button onClick={() => { setImg("load"); setTimeout(() => setImg("done"), 1500); }} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 text-sm font-semibold text-primary-foreground">
                {img === "load" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}{img === "load" ? t.generating : t.generate}
              </button>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {gens.map((g, i) => (
                <div key={i} className="aspect-square overflow-hidden rounded-lg">
                  {img === "load" ? <div className="shimmer h-full w-full" /> :
                    <img src={g} alt="" width={816} height={816} className={`h-full w-full object-cover transition duration-700 ${img === "done" ? "" : "opacity-50 blur-[2px]"}`} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Capabilities() {
  const { t } = useI18n();
  const icons = [Zap, Globe, Wand2, ShieldCheck];
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <Reveal className="mb-14 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-magenta">{t.capKicker}</p>
        <h2 className="mt-3 text-4xl font-bold md:text-5xl">{t.capTitle}</h2>
      </Reveal>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {t.caps.map(([h, d], i) => {
          const I = icons[i] ?? Zap;
          return (
            <Reveal key={h} delay={i * 80}>
              <div className="glass glow-border h-full rounded-3xl p-7 transition hover:-translate-y-1">
                <I className="h-8 w-8 text-cyan" />
                <h3 className="mt-5 text-2xl font-bold text-gradient">{h}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{d}</p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

function Pricing() {
  const { t, lang } = useI18n();
  const [cur, setCur] = useState<"TRY" | "USD" | null>(null);
  const c = cur ?? (lang === "tr" ? "TRY" : "USD");
  const prices = { TRY: ["₺299", "₺999"], USD: ["$9", "$29"] };
  return (
    <section id="pricing" className="mx-auto max-w-7xl px-6 py-24">
      <Reveal className="mb-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan">{t.priceKicker}</p>
        <h2 className="mt-3 text-4xl font-bold md:text-5xl">{t.priceTitle}</h2>
        <div className="glass mx-auto mt-8 inline-flex rounded-full p-1 text-sm font-semibold">
          {(["TRY", "USD"] as const).map((x) => (
            <button key={x} onClick={() => setCur(x)} className={`rounded-full px-5 py-2 ${c === x ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground"}`}>{x}</button>
          ))}
        </div>
      </Reveal>
      <div className="grid gap-6 lg:grid-cols-3">
        {t.plans.map((p, i) => {
          const pop = i === 1;
          return (
            <Reveal key={p.name} delay={i * 100}>
              <div className={`glass glow-border relative h-full rounded-3xl p-8 ${pop ? "shadow-glow lg:-translate-y-4" : ""}`}>
                {pop && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-brand px-4 py-1 text-xs font-bold text-primary-foreground">{t.popular}</span>}
                <h3 className="text-xl font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-cyan">{p.credits}</p>
                <div className="mt-6 flex items-end gap-1">
                  <span className="font-display text-5xl font-bold">{i < 2 ? prices[c][i] : t.custom}</span>
                  {i < 2 && <span className="mb-1 text-muted-foreground">{t.month}</span>}
                </div>
                <ul className="mt-8 space-y-3 text-sm">
                  {p.feats.map((f) => <li key={f} className="flex gap-3"><Check className="h-4 w-4 shrink-0 text-cyan" />{f}</li>)}
                </ul>
                <a href="#contact" className={`mt-8 w-full ${pop ? btnPrimary : btnOutline}`}>{t.buy}</a>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

function Trusted() {
  const { t } = useI18n();
  const logos = ["NEXUS", "Orbital", "Pixelon", "KUANTUM", "Vertex", "Lumina", "ARKA", "Synthwave"];
  return (
    <section className="py-24">
      <Reveal><p className="mb-10 text-center text-sm uppercase tracking-[0.25em] text-muted-foreground">{t.trusted}</p></Reveal>
      <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_15%,#000_85%,transparent)]">
        <div className="marquee flex w-max gap-16">
          {[...logos, ...logos].map((l, i) => <span key={i} className="font-display text-3xl font-bold text-muted-foreground/60">{l}</span>)}
        </div>
      </div>
      <div className="mx-auto mt-16 grid max-w-7xl gap-6 px-6 md:grid-cols-3">
        {t.testimonials.map(([n, r, q], i) => (
          <Reveal key={n} delay={i * 100}>
            <figure className="glass glow-border h-full rounded-3xl p-7">
              <div className="flex">{[1, 2, 3, 4, 5].map((s) => <Star key={s} className="h-4 w-4 fill-magenta text-magenta" />)}</div>
              <blockquote className="mt-4">"{q}"</blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-brand font-bold text-primary-foreground">{n?.[0]}</span>
                <span><b className="block text-sm">{n}</b><span className="text-xs text-muted-foreground">{r}</span></span>
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function FAQ() {
  const { t } = useI18n();
  const [open, setOpen] = useState(0);
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <Reveal><h2 className="mb-10 text-center text-4xl font-bold md:text-5xl">{t.faqTitle}</h2></Reveal>
      <div className="space-y-3">
        {t.faqs.map(([q, a], i) => (
          <div key={q} className="glass glow-border rounded-2xl">
            <button onClick={() => setOpen(open === i ? -1 : i)} className="flex w-full items-center justify-between p-5 text-left font-semibold">
              {q}<ChevronDown className={`h-5 w-5 shrink-0 text-cyan transition-transform ${open === i ? "rotate-180" : ""}`} />
            </button>
            <div className={`grid transition-all duration-300 ${open === i ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <p className="overflow-hidden px-5 text-sm text-muted-foreground"><span className="block pb-5">{a}</span></p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer id="contact" className="relative border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <Reveal>
          <div className="glass glow-border relative mb-20 overflow-hidden rounded-3xl p-12 text-center">
            <div className="blob absolute -left-20 -top-20 h-72 w-72 rounded-full bg-magenta/30" />
            <h2 className="relative text-4xl font-bold md:text-5xl">{t.ctaTitle}</h2>
            <a href="#pricing" className={`${btnPrimary} relative mt-8`}><Sparkles className="h-4 w-4" />{t.start}</a>
          </div>
        </Reveal>
        <div className="grid gap-10 md:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-4 text-sm text-muted-foreground">{t.footerTag}</p>
            <p className="mt-4 text-sm text-muted-foreground">hello@traipro.ai<br />İstanbul, Türkiye</p>
          </div>
          {[[t.product, t.nav], [t.company, t.companyLinks], [t.legal, t.legalLinks]].map(([h, ls]) => (
            <div key={h as string}>
              <h4 className="mb-4 font-semibold">{h as string}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {(ls as string[]).map((l) => <li key={l}><a href="#top" className="hover:text-cyan">{l}</a></li>)}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-14 text-center text-xs text-muted-foreground">© 2026 TrAi Pro. {t.rights}</p>
      </div>
      <a href="https://wa.me/905000000000" target="_blank" rel="noreferrer" aria-label="WhatsApp"
        className="pulse-ring fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-brand text-primary-foreground shadow-glow">
        <MessageCircle className="h-6 w-6" />
      </a>
    </footer>
  );
}

function Page() {
  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="blob absolute -left-40 top-0 h-[500px] w-[500px] rounded-full bg-violet/30" />
        <div className="blob absolute right-[-10%] top-1/3 h-[450px] w-[450px] rounded-full bg-cyan/20" style={{ animationDelay: "-6s" }} />
        <div className="blob absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-magenta/20" style={{ animationDelay: "-12s" }} />
      </div>
      <CursorGlow />
      <div className="relative z-10">
        <Header />
        <Hero />
        <ToolsSection />
        <Capabilities />
        <Pricing />
        <Trusted />
        <FAQ />
        <Footer />
      </div>
    </div>
  );
}

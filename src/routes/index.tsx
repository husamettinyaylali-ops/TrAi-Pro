import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Loader2, Pause, Play, Sparkles, Wand2 } from "lucide-react";

import { NeuralCanvas, Waveform } from "@/components/landing/fx";
import { PackagesSection } from "@/components/site/packages";
import { SiteShell, btnOutline, btnPrimary } from "@/components/site/shell";
import { useI18n } from "@/lib/i18n";
import { gens } from "@/lib/samples";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TrAi Pro — Yapay Zeka Ses, Video & Görsel Üretimi" },
      {
        name: "description",
        content:
          "1000+ gerçekçi AI sesi, ses klonlama, metinden videoya ve görsel üretimi; kredi tabanlı, aboneliksiz.",
      },
      { property: "og:title", content: "TrAi Pro — AI Content Creation Platform" },
      {
        property: "og:description",
        content:
          "1000+ realistic AI voices, voice cloning, text-to-video and image generation. Credit-based, no subscription.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});

function HeroActions() {
  const { t } = useI18n();
  const { user, hydrated } = useApp();
  if (hydrated && user) {
    return (
      <Link to="/labs" search={{ tab: "tts" }} className={btnPrimary}>
        <Sparkles className="h-4 w-4" />
        {t.openLabs}
      </Link>
    );
  }
  return (
    <>
      <Link to="/sign-up" search={{}} className={btnPrimary}>
        <Sparkles className="h-4 w-4" />
        {t.signUpNow}
      </Link>
      <Link to="/sign-in" search={{}} className={btnOutline}>
        {t.signIn}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </>
  );
}

function Hero() {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  const [img, setImg] = useState<"idle" | "load" | "done">("idle");
  return (
    <section className="relative overflow-hidden">
      <div className="grid-overlay absolute inset-0" />
      <NeuralCanvas />
      <div className="relative mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] items-center gap-14 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
        <div>
          <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium">
            <span className="h-2 w-2 animate-pulse rounded-full bg-cyan" />
            {t.hero.badge}
          </span>
          <h1 className="mt-6 text-4xl font-bold leading-[1.05] sm:text-5xl md:text-6xl xl:text-7xl">
            {t.hero.title} <span className="text-gradient">TrAi Pro</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">{t.hero.sub}</p>
          <div className="mt-9 flex flex-wrap gap-4">
            <HeroActions />
          </div>
        </div>

        <div className="relative space-y-5">
          <div className="glass glow-border rounded-3xl p-6 shadow-glow">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="font-semibold">{t.hero.tts}</span>
              <span className="rounded-full bg-cyan/15 px-2.5 py-0.5 text-xs text-cyan">
                Defne · TR
              </span>
            </div>
            <p className="mb-4 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
              "{t.hero.ttsSample}"
            </p>
            <div className="flex items-center gap-4 overflow-hidden">
              <button
                onClick={() => setPlaying(!playing)}
                aria-label={playing ? t.labs.tts.stop : t.labs.tts.play}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-brand text-primary-foreground shadow-glow"
              >
                {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>
              <Waveform playing={playing} bars={44} />
            </div>
          </div>
          <div className="glass glow-border rounded-3xl p-6 lg:ml-12">
            <div className="mb-3 text-sm font-semibold">{t.hero.imgGen}</div>
            <div className="flex gap-2">
              <div className="flex-1 truncate rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
                {t.hero.imgPrompt}
              </div>
              <button
                onClick={() => {
                  setImg("load");
                  setTimeout(() => setImg("done"), 1500);
                }}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-gradient-brand px-4 text-sm font-semibold text-primary-foreground"
              >
                {img === "load" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                {img === "load" ? t.hero.generating : t.hero.generate}
              </button>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {gens.map((g, i) => (
                <div key={i} className="aspect-square overflow-hidden rounded-lg">
                  {img === "load" ? (
                    <div className="shimmer h-full w-full" />
                  ) : (
                    <img
                      src={g}
                      alt=""
                      width={816}
                      height={816}
                      className={`h-full w-full object-cover transition duration-700 ${img === "done" ? "" : "opacity-50 blur-[2px]"}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Page() {
  return (
    <SiteShell>
      <Hero />
      <PackagesSection kind="voice" />
      <PackagesSection kind="media" />
      <div className="pb-16" />
    </SiteShell>
  );
}

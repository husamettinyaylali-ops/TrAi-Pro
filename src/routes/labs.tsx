import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Film, ImageIcon, Mic, Upload } from "lucide-react";

import { Balances, MediaStudio, TextToSpeech, VoiceClone } from "@/components/labs/tools";
import { RequireAuth } from "@/components/site/require-auth";
import { DemoNote, SiteShell } from "@/components/site/shell";
import { VerifyBanner } from "@/components/site/verify-banner";
import { useI18n } from "@/lib/i18n";
import { useStudioConfig } from "@/lib/studio-config";

const tabs = ["tts", "clone", "image", "video"] as const;
type Tab = (typeof tabs)[number];

export const Route = createFileRoute("/labs")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    tabs.includes(s["tab"] as Tab) ? { tab: s["tab"] as Tab } : {},
  head: () => ({ meta: [{ title: "Stüdyo — TrAi Pro" }] }),
  component: LabsPage,
});

const icons = { tts: Mic, clone: Upload, image: ImageIcon, video: Film };

function Labs() {
  const { t, locale } = useI18n();
  const { tab = "tts" } = Route.useSearch();
  const navigate = useNavigate({ from: "/labs" });
  const studio = useStudioConfig();
  // Anahtarı olmayan servisler demo kipte çalışır; not yalnız onları sayar.
  const demoParts = studio.data
    ? (["tts", "image", "video"] as const)
        .filter((k) => studio.data[k] === "demo")
        .map((k) => t.demoNotes.parts[k])
    : [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-4xl font-bold">{t.labs.title}</h1>
        <p className="mt-2 text-muted-foreground">{t.labs.sub}</p>
      </div>
      <VerifyBanner />
      <Balances />
      <div
        role="tablist"
        aria-label={t.labs.title}
        className="glass flex w-full gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none] sm:w-fit"
      >
        {tabs.map((k) => {
          const I = icons[k];
          const active = tab === k;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={active}
              onClick={() => navigate({ search: { tab: k }, replace: true })}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-5 text-sm font-semibold transition ${active ? "bg-gradient-brand text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground"}`}
            >
              <I className="h-4 w-4" />
              {t.labs.tabs[k]}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">
        {tab === "tts" && <TextToSpeech />}
        {tab === "clone" && <VoiceClone />}
        {tab === "image" && <MediaStudio key="image" type="image" />}
        {tab === "video" && <MediaStudio key="video" type="video" />}
      </div>
      {demoParts.length > 0 && (
        <DemoNote
          text={t.demoNotes.studio(
            new Intl.ListFormat(locale, { type: "conjunction" }).format(demoParts),
          )}
        />
      )}
    </div>
  );
}

function LabsPage() {
  return (
    <SiteShell>
      <RequireAuth>
        <Labs />
      </RequireAuth>
    </SiteShell>
  );
}

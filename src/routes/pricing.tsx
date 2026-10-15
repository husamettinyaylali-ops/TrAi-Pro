import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { Reveal } from "@/components/landing/fx";
import { PackagesSection } from "@/components/site/packages";
import { PageHead, SiteShell } from "@/components/site/shell";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/pricing")({
  head: () => ({ meta: [{ title: "Fiyatlandırma — TrAi Pro" }] }),
  component: PricingPage,
});

function CostTable() {
  const { t } = useI18n();
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <Reveal>
        <h2 className="mb-8 text-center text-3xl font-bold md:text-4xl">{t.pricing.costTitle}</h2>
        <dl className="glass glow-border divide-y divide-border rounded-3xl">
          {t.pricing.costRows.map(([k, v]) => (
            <div
              key={k}
              className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <dt className="font-semibold">{k}</dt>
              <dd className="text-sm text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </section>
  );
}

function FAQ() {
  const { t } = useI18n();
  const [open, setOpen] = useState(0);
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <Reveal>
        <h2 className="mb-8 text-center text-3xl font-bold md:text-4xl">{t.pricing.faqTitle}</h2>
      </Reveal>
      <div className="space-y-3">
        {t.pricing.faqs.map(([q, a], i) => (
          <div key={q} className="glass glow-border rounded-2xl">
            <button
              onClick={() => setOpen(open === i ? -1 : i)}
              aria-expanded={open === i}
              className="flex min-h-11 w-full items-center justify-between gap-4 p-5 text-left font-semibold"
            >
              {q}
              <ChevronDown
                className={`h-5 w-5 shrink-0 text-cyan transition-transform ${open === i ? "rotate-180" : ""}`}
              />
            </button>
            <div
              className={`grid transition-all duration-300 ${open === i ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
            >
              <p className="overflow-hidden px-5 text-sm text-muted-foreground">
                <span className="block pb-5">{a}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PricingPage() {
  const { t } = useI18n();
  return (
    <SiteShell>
      <PageHead title={t.pricing.title} sub={t.pricing.sub} />
      <PackagesSection kind="voice" />
      <PackagesSection kind="media" />
      <CostTable />
      <FAQ />
      <div className="pb-8" />
    </SiteShell>
  );
}

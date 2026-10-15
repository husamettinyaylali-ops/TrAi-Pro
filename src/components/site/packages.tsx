import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";

import { Reveal } from "@/components/landing/fx";
import { creditsPerDollar, type CreditKind } from "@/lib/credits";
import { useFormat, useI18n } from "@/lib/i18n";
import { mediaPackages, voicePackages, type CreditPackage } from "@/lib/packages";
import { useApp } from "@/lib/store";

import { btnOutline, btnPrimary } from "./shell";

function PackageCard({ pkg, onSelect }: { pkg: CreditPackage; onSelect: () => void }) {
  const { t } = useI18n();
  const f = useFormat();
  const isVoice = pkg.kind === "voice";
  const title = isVoice ? t.packages.credits(f.num(pkg.credits)) : t.packages.mediaName;
  const feats = isVoice
    ? [
        `${t.packages.creditAmount}: ${f.num(pkg.credits)}`,
        `${t.packages.usagePeriod}: ${t.packages.days(pkg.days)}`,
        `${t.packages.unitPrice}: ${t.packages.perDollar(f.num(creditsPerDollar(pkg.credits, pkg.priceUsd)))}`,
      ]
    : [
        `${t.packages.usagePeriod}: ${t.packages.days(pkg.days)}`,
        t.packages.mediaIncludes(f.num(pkg.credits)),
      ];

  return (
    <div
      className={`glass glow-border relative flex h-full flex-col rounded-3xl p-8 ${pkg.popular ? "shadow-glow" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-cyan">{t.packages.days(pkg.days)}</p>
        </div>
        {pkg.popular && (
          <span className="rounded-full bg-gradient-brand px-3 py-1 text-xs font-bold text-primary-foreground">
            {t.packages.popular}
          </span>
        )}
      </div>
      <p className="mt-8 font-display text-5xl font-bold">{f.usd(pkg.priceUsd)}</p>
      <ul className="mt-8 flex-1 space-y-3 text-sm">
        {feats.map((x) => (
          <li key={x} className="flex gap-3">
            <Check className="h-4 w-4 shrink-0 text-cyan" aria-hidden />
            {x}
          </li>
        ))}
      </ul>
      <button onClick={onSelect} className={`mt-8 w-full ${pkg.popular ? btnPrimary : btnOutline}`}>
        {t.packages.select}
      </button>
    </div>
  );
}

export function PackagesSection({ kind }: { kind: CreditKind }) {
  const { t } = useI18n();
  const { user } = useApp();
  const navigate = useNavigate();
  const list = kind === "voice" ? voicePackages : mediaPackages;
  const choose = (id: string) =>
    user
      ? navigate({ to: "/payment", search: { package: id } })
      : navigate({ to: "/sign-up", search: { redirect: `/payment?package=${id}` } });

  return (
    <section
      id={kind === "voice" ? "voice-packages" : "media-packages"}
      className="mx-auto max-w-5xl scroll-mt-20 px-4 py-16 sm:px-6"
    >
      <Reveal className="mb-10 text-center">
        <h2 className="text-3xl font-bold md:text-4xl">
          {kind === "voice" ? t.packages.voiceTitle : t.packages.mediaTitle}
        </h2>
        <p className="mt-3 text-muted-foreground">
          {kind === "voice" ? t.packages.voiceSub : t.packages.mediaSub}
        </p>
      </Reveal>
      <div className="grid gap-6 md:grid-cols-2">
        {list.map((p, i) => (
          <Reveal key={p.id} delay={i * 100}>
            <PackageCard pkg={p} onSelect={() => choose(p.id)} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

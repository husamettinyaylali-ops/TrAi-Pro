import { useFormat, useI18n } from "@/lib/i18n";
import { legalContent, legalUpdated, type LegalDoc } from "@/lib/legal-content";

import { PageHead, SiteShell } from "./shell";

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const { t, lang } = useI18n();
  const f = useFormat();
  return (
    <SiteShell>
      <PageHead title={t.footer.legal[doc]} sub={t.legal.updated(f.date(legalUpdated))} />
      <article className="mx-auto max-w-3xl px-4 pb-24 sm:px-6">
        <p className="mb-8 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {t.legal.template}
        </p>
        <div className="glass glow-border space-y-8 rounded-3xl p-8">
          {legalContent[doc][lang].map((s) => (
            <section key={s.h}>
              <h2 className="text-xl font-semibold">{s.h}</h2>
              <p className="mt-2 leading-relaxed text-muted-foreground">{s.p}</p>
            </section>
          ))}
        </div>
      </article>
    </SiteShell>
  );
}

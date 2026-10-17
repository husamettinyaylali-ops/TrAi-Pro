import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { KeyRound } from "lucide-react";

import { PageHead, SiteShell, btnPrimary } from "@/components/site/shell";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/api-docs")({
  head: () => ({ meta: [{ title: "API Belgeleri — TrAi Pro" }] }),
  component: ApiDocsPage,
});

type FieldKey = "text" | "voiceId" | "voiceSettings" | "prompt" | "count" | "style";
const FIELD_NAMES: Record<FieldKey, string> = {
  text: "text",
  voiceId: "voice_id",
  voiceSettings: "voice_settings",
  prompt: "prompt",
  count: "count",
  style: "style",
};

interface Endpoint {
  key: "me" | "voices" | "tts" | "images" | "videos" | "generation" | "file";
  method: "GET" | "POST";
  path: string;
  fields?: FieldKey[];
  curl: (base: string) => string;
  response?: string;
}

const auth = `-H "Authorization: Bearer $TRAI_KEY"`;
const jsonBody = (body: string) =>
  `${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`;
const GEN = (status: string, files: string[]) =>
  JSON.stringify(
    {
      id: "3f6c…",
      type: "image",
      status,
      prompt: "a red fox in the snow",
      cost: 2,
      created_at: "2026-10-16T09:00:00.000Z",
      files,
    },
    null,
    2,
  );

const ENDPOINTS: Endpoint[] = [
  {
    key: "me",
    method: "GET",
    path: "/me",
    curl: (b) => `curl ${b}/me \\\n  ${auth}`,
    response: `{\n  "credits": { "voice": 4993, "media": 98 },\n  "balance_usd": "2.00"\n}`,
  },
  {
    key: "voices",
    method: "GET",
    path: "/voices",
    curl: (b) => `curl ${b}/voices \\\n  ${auth}`,
    response: `{\n  "voices": [\n    { "id": "VOICE_ID", "name": "Ayla", "gender": "female", "type": "stock" }\n  ]\n}`,
  },
  {
    key: "tts",
    method: "POST",
    path: "/tts",
    fields: ["text", "voiceId", "voiceSettings"],
    curl: (b) =>
      `curl -X POST ${b}/tts \\\n  ${jsonBody('{"text":"Merhaba dünya","voice_id":"VOICE_ID","voice_settings":{"speed":1.1}}')}`,
  },
  {
    key: "images",
    method: "POST",
    path: "/images",
    fields: ["prompt", "count"],
    curl: (b) =>
      `curl -X POST ${b}/images \\\n  ${jsonBody('{"prompt":"a red fox in the snow","count":2}')}`,
    response: GEN("completed", ["…/api/v1/generations/3f6c…/files/0", "…/files/1"]),
  },
  {
    key: "videos",
    method: "POST",
    path: "/videos",
    fields: ["prompt", "style"],
    curl: (b) =>
      `curl -X POST ${b}/videos \\\n  ${jsonBody('{"prompt":"a ship sailing the Bosphorus","style":"cinematic"}')}`,
  },
  {
    key: "generation",
    method: "GET",
    path: "/generations/:id",
    curl: (b) => `curl ${b}/generations/GENERATION_ID \\\n  ${auth}`,
  },
  {
    key: "file",
    method: "GET",
    path: "/generations/:id/files/:index",
    curl: (b) => `curl -o result.jpg ${b}/generations/GENERATION_ID/files/0 \\\n  ${auth}`,
  },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-2xl bg-muted/60 p-4 text-xs leading-relaxed">
      <code className="font-mono">{children}</code>
    </pre>
  );
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="glass glow-border space-y-4 rounded-3xl p-6 sm:p-8">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ApiDocs() {
  const { t } = useI18n();
  const d = t.apiDocs;
  // Örnekler sayfanın açıldığı alan adıyla gösterilir; sunucuda bilinmediği için açılıştan sonra.
  const [origin, setOrigin] = useState("https://your-domain");
  useEffect(() => setOrigin(window.location.origin), []);
  const base = `${origin}/api/v1`;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 pb-24 sm:px-6">
      <Block id="api-intro" title={d.introTitle}>
        <p className="text-sm text-muted-foreground">{d.intro}</p>
        <div>
          <p className="mb-1.5 text-sm font-medium">{d.baseUrl}</p>
          <Code>{base}</Code>
        </div>
        <Link to="/account" hash="api-keys" className={btnPrimary}>
          <KeyRound className="h-4 w-4" aria-hidden />
          {d.createKey}
        </Link>
      </Block>

      <Block id="api-auth" title={d.authTitle}>
        <p className="text-sm text-muted-foreground">{d.auth}</p>
        <Code>{`export TRAI_KEY="trai_…"\ncurl ${base}/me \\\n  ${auth}`}</Code>
      </Block>

      <Block id="api-endpoints" title={d.endpointsTitle}>
        <div className="space-y-8">
          {ENDPOINTS.map((e) => (
            <article key={e.key} aria-labelledby={`ep-${e.key}`} className="space-y-3">
              <h3
                id={`ep-${e.key}`}
                className="flex flex-wrap items-center gap-2 font-mono text-sm"
              >
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${e.method === "GET" ? "bg-cyan/15 text-cyan" : "bg-magenta/15 text-magenta"}`}
                >
                  {e.method}
                </span>{" "}
                <span className="break-all font-semibold">/api/v1{e.path}</span>
              </h3>
              <p className="text-sm text-muted-foreground">{d.endpoints[e.key]}</p>
              {e.fields && (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">{d.fieldsTitle}</p>
                  <dl className="space-y-1">
                    {e.fields.map((field) => (
                      <div key={field} className="flex flex-wrap gap-x-2">
                        <dt className="font-mono text-cyan">{FIELD_NAMES[field]}</dt>
                        <dd className="text-muted-foreground">{d.fields[field]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <Code>{e.curl(base)}</Code>
              {e.response && (
                <>
                  <p className="text-sm font-medium">{d.responseTitle}</p>
                  <Code>{e.response}</Code>
                </>
              )}
            </article>
          ))}
        </div>
      </Block>

      <Block id="api-video" title={d.videoFlowTitle}>
        <p className="text-sm text-muted-foreground">{d.videoFlow}</p>
        <Code>{GEN("pending", [])}</Code>
      </Block>

      <Block id="api-errors" title={d.errorsTitle}>
        <p className="text-sm text-muted-foreground">{d.errorsIntro}</p>
        <Code>{`{\n  "error": {\n    "code": "insufficient_credits",\n    "message": "Not enough credits. No credits were used."\n  }\n}`}</Code>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {d.errorCols.code}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {d.errorCols.status}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {d.errorCols.meaning}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.errorRows.map(([code, status, meaning]) => (
                <tr key={code}>
                  <td className="px-3 py-2 font-mono text-xs">{code}</td>
                  <td className="px-3 py-2">{status}</td>
                  <td className="px-3 py-2 text-muted-foreground">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <Block id="api-limits" title={d.limitsTitle}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {d.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Block>

      <Block id="api-credits" title={d.creditsTitle}>
        <p className="text-sm text-muted-foreground">{d.credits}</p>
        <Link to="/pricing" className="text-sm font-semibold text-cyan hover:underline">
          {d.seePricing}
        </Link>
      </Block>
    </div>
  );
}

function ApiDocsPage() {
  const { t } = useI18n();
  return (
    <SiteShell>
      <PageHead title={t.apiDocs.title} sub={t.apiDocs.sub} />
      <ApiDocs />
    </SiteShell>
  );
}

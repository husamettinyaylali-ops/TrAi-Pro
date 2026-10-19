import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, AudioWaveform, Captions, Film, ImageIcon, Mic } from "lucide-react";

import { AudioEditor } from "@/components/editor/audio-editor";
import { ImageEditor } from "@/components/editor/image-editor";
import { editorBlock } from "@/components/editor/utils";
import { Panel } from "@/components/labs/tools";
import { RequireAuth } from "@/components/site/require-auth";
import { SiteShell } from "@/components/site/shell";
import { useFormat, useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/editor/$id")({
  head: () => ({ meta: [{ title: "Düzenleyici — TrAi Pro" }] }),
  component: EditorPage,
});

const typeIcons = { tts: Mic, stt: Captions, sfx: AudioWaveform, image: ImageIcon, video: Film };

function EditorBody() {
  const { t } = useI18n();
  const f = useFormat();
  const { id } = Route.useParams();
  const { getGeneration, user } = useApp();
  const q = useQuery({
    queryKey: ["generation", user?.id, id],
    queryFn: async () => {
      const res = await getGeneration(id);
      if (!res.ok) throw new Error(res.error);
      return res.generation;
    },
    retry: false,
    staleTime: 60_000,
  });
  const g = q.data;

  const back = (
    <Link
      to="/labs"
      search={g?.projectId ? { project: g.projectId } : {}}
      className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t.editor.back}
    </Link>
  );

  if (q.isPending) {
    return (
      <div
        role="status"
        aria-label={t.loading}
        className="mx-auto max-w-4xl space-y-6 px-4 py-12 sm:px-6"
      >
        <div className="shimmer h-10 w-64 rounded-full" />
        <div className="shimmer h-64 rounded-3xl" />
      </div>
    );
  }
  if (!g) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-12 sm:px-6">
        {back}
        <Panel>
          <p role="alert" className="text-center text-muted-foreground">
            {t.editor.notFound}
          </p>
        </Panel>
      </div>
    );
  }

  const Icon = typeIcons[g.type];
  const block = editorBlock(g);
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-12 sm:px-6">
      {back}
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t.editor.title} · {t.labs.tabs[g.type]}
          </p>
          <h1 className="break-words text-2xl font-bold sm:text-3xl">
            {g.title ?? (g.text.length > 80 ? `${g.text.slice(0, 80)}…` : g.text)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{f.dateTime(g.createdAt)}</p>
        </div>
      </div>
      {block ? (
        <Panel>
          <p className="text-center text-muted-foreground">{t.editor.unavailable[block]}</p>
        </Panel>
      ) : g.type === "tts" || g.type === "stt" || g.type === "sfx" ? (
        <AudioEditor key={g.id} g={g} />
      ) : (
        <ImageEditor key={g.id} g={g} />
      )}
    </div>
  );
}

function EditorPage() {
  return (
    <SiteShell>
      <RequireAuth>
        <EditorBody />
      </RequireAuth>
    </SiteShell>
  );
}

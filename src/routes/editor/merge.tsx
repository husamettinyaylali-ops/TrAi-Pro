import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Combine } from "lucide-react";

import { MergeEditor } from "@/components/editor/merge-editor";
import { RequireAuth } from "@/components/site/require-auth";
import { SiteShell } from "@/components/site/shell";
import { useI18n } from "@/lib/i18n";
import { useProjects } from "@/lib/store";

interface MergeSearch {
  project?: string;
}

const ID_RE = /^[\w-]{1,80}$/;

export const Route = createFileRoute("/editor/merge")({
  validateSearch: (s: Record<string, unknown>): MergeSearch =>
    typeof s["project"] === "string" && ID_RE.test(s["project"]) ? { project: s["project"] } : {},
  head: () => ({ meta: [{ title: "Sesleri birleştir — TrAi Pro" }] }),
  component: MergePage,
});

function MergeBody() {
  const { t } = useI18n();
  const { project: projectId } = Route.useSearch();
  const projects = useProjects();
  const project = projectId ? projects.data?.find((p) => p.id === projectId) : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-12 sm:px-6">
      <Link
        to="/labs"
        search={projectId ? { project: projectId } : {}}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.editor.back}
      </Link>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground">
          <Combine className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t.editor.title} ·{" "}
            {project ? t.editor.merge.scopeProject(project.name) : t.editor.merge.scopeAll}
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">{t.editor.merge.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.editor.merge.sub}</p>
        </div>
      </div>
      <MergeEditor key={projectId ?? "all"} projectId={projectId} />
    </div>
  );
}

function MergePage() {
  return (
    <SiteShell>
      <RequireAuth>
        <MergeBody />
      </RequireAuth>
    </SiteShell>
  );
}

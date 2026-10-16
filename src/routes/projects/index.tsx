import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { FolderPlus } from "lucide-react";

import { Panel } from "@/components/labs/tools";
import { RequireAuth } from "@/components/site/require-auth";
import { PageHead, SiteShell, btnOutline, btnPrimary, field } from "@/components/site/shell";
import { useFormat, useI18n } from "@/lib/i18n";
import { MAX_PROJECTS, PROJECT_NAME_MAX, PROJECT_NOTES_MAX } from "@/lib/projects";
import { useApp, useProjects } from "@/lib/store";

export const Route = createFileRoute("/projects/")({
  head: () => ({ meta: [{ title: "Projeler — TrAi Pro" }] }),
  component: ProjectsPage,
});

function CreateProject() {
  const { t } = useI18n();
  const f = useFormat();
  const { createProject } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t.projects.errors.invalidInput);
    setBusy(true);
    const res = await createProject({ name, notes });
    setBusy(false);
    if (!res.ok) {
      return setError(
        res.error === "limit"
          ? t.projects.errors.limit(f.num(MAX_PROJECTS))
          : res.error === "invalidInput"
            ? t.projects.errors.invalidInput
            : t.projects.errors.failed,
      );
    }
    void navigate({ to: "/projects/$id", params: { id: res.project.id } });
  };

  return (
    <Panel>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <FolderPlus className="h-5 w-5 text-cyan" aria-hidden />
        {t.projects.new}
      </h2>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="project-name" className="mb-1.5 block text-sm font-medium">
            {t.projects.name}
          </label>
          <input
            id="project-name"
            className={field}
            maxLength={PROJECT_NAME_MAX}
            placeholder={t.projects.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="project-notes" className="mb-1.5 block text-sm font-medium">
            {t.projects.notes}
          </label>
          <textarea
            id="project-notes"
            rows={3}
            className={`${field} resize-y`}
            maxLength={PROJECT_NOTES_MAX}
            placeholder={t.projects.notesPlaceholder}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={btnPrimary}>
          {t.projects.create}
        </button>
      </form>
    </Panel>
  );
}

function Projects() {
  const { t } = useI18n();
  const f = useFormat();
  const projects = useProjects();

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-16 sm:px-6">
      <CreateProject />
      {projects.isPending ? (
        <div
          role="status"
          aria-label={t.loading}
          className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-44 rounded-3xl" />
          ))}
        </div>
      ) : projects.isError ? (
        <Panel className="flex flex-col items-center gap-3 text-center">
          <p role="alert" className="text-destructive">
            {t.projects.loadError}
          </p>
          <button type="button" onClick={() => void projects.refetch()} className={btnOutline}>
            {t.rootPages.retry}
          </button>
        </Panel>
      ) : projects.data.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">{t.projects.empty}</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((p) => (
            <li key={p.id}>
              <Panel className="flex h-full flex-col gap-3">
                <h2 className="truncate text-lg font-semibold">
                  <Link
                    to="/projects/$id"
                    params={{ id: p.id }}
                    className="rounded transition hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {p.name}
                  </Link>
                </h2>
                {p.notes && (
                  <p className="line-clamp-2 whitespace-pre-line break-words text-sm text-muted-foreground">
                    {p.notes}
                  </p>
                )}
                <p className="text-sm">
                  {t.projects.counts(
                    f.num(p.counts.tts),
                    f.num(p.counts.image),
                    f.num(p.counts.video),
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.projects.updated(f.dateTime(p.updatedAt))}
                </p>
                <div className="mt-auto pt-2">
                  <Link
                    to="/labs"
                    search={{ tab: "tts", project: p.id }}
                    className={btnOutline}
                    aria-label={`${t.projects.openStudio}: ${p.name}`}
                  >
                    {t.projects.openStudio}
                  </Link>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectsPage() {
  const { t } = useI18n();
  return (
    <SiteShell>
      <PageHead title={t.projects.title} sub={t.projects.sub} />
      <RequireAuth>
        <Projects />
      </RequireAuth>
    </SiteShell>
  );
}

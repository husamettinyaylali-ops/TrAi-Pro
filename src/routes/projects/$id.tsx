import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Download, Film, ImageIcon, Loader2, Mic, Trash2, Wand2 } from "lucide-react";

import { GenerationMenu, GenerationTitle, NoDownload } from "@/components/labs/generation-ui";
import { HistoryView, Panel } from "@/components/labs/tools";
import { RequireAuth } from "@/components/site/require-auth";
import { SiteShell, btnOutline, btnPrimary, field } from "@/components/site/shell";
import { useFormat, useI18n } from "@/lib/i18n";
import { PROJECT_NAME_MAX, PROJECT_NOTES_MAX } from "@/lib/projects";
import { useApp, useHistory, useProjects, type Generation } from "@/lib/store";
import type { GenerationType, Project } from "@/lib/types";

export const Route = createFileRoute("/projects/$id")({
  head: () => ({ meta: [{ title: "Proje — TrAi Pro" }] }),
  component: ProjectPage,
});

const typeIcons = { tts: Mic, image: ImageIcon, video: Film };
const iconLink =
  "grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Projenin adı ve notu; kaydedilene kadar değişiklik yalnız formda durur. */
function ProjectEditor({ project }: { project: Project }) {
  const { t } = useI18n();
  const { updateProject } = useApp();
  const [name, setName] = useState(project.name);
  const [notes, setNotes] = useState(project.notes);
  const [state, setState] = useState<"idle" | "saving" | "saved" | { error: string }>("idle");
  const dirty = name !== project.name || notes !== project.notes;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState("saving");
    const res = await updateProject(project.id, { name, notes });
    if (res.ok) return setState("saved");
    setState({
      error:
        res.error === "invalidInput"
          ? t.projects.errors.invalidInput
          : res.error === "notFound"
            ? t.projects.errors.notFound
            : t.projects.errors.failed,
    });
  };

  return (
    <Panel>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="project-name" className="mb-1.5 block text-sm font-medium">
            {t.projects.name}
          </label>
          <input
            id="project-name"
            className={field}
            maxLength={PROJECT_NAME_MAX}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setState("idle");
            }}
          />
        </div>
        <div>
          <label htmlFor="project-notes" className="mb-1.5 block text-sm font-medium">
            {t.projects.notes}
          </label>
          <textarea
            id="project-notes"
            rows={6}
            className={`${field} resize-y`}
            maxLength={PROJECT_NOTES_MAX}
            placeholder={t.projects.notesPlaceholder}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setState("idle");
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={!dirty || state === "saving"} className={btnPrimary}>
            {state === "saving" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {state === "saving" ? t.projects.saving : t.projects.save}
          </button>
          {state === "saved" && (
            <p role="status" className="text-sm text-cyan">
              {t.projects.saved}
            </p>
          )}
          {typeof state === "object" && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
        </div>
      </form>
    </Panel>
  );
}

/** Stüdyoda açma, tüm dosyaları ZIP olarak indirme ve silme (onaylı). */
function ProjectActions({ project }: { project: Project }) {
  const { t, lang } = useI18n();
  const { deleteProject } = useApp();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = project.counts.tts + project.counts.image + project.counts.video;

  const remove = async () => {
    const res = await deleteProject(project.id);
    if (!res.ok) return setError(t.projects.errors.failed);
    void navigate({ to: "/projects" });
  };

  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Link to="/labs" search={{ tab: "tts", project: project.id }} className={btnPrimary}>
          <Wand2 className="h-4 w-4" aria-hidden />
          {t.projects.openStudio}
        </Link>
        {total > 0 && (
          // Tam sayfa bağlantı: ZIP sunucu rotasından akış olarak iner.
          <a href={`/media/project/${project.id}?lang=${lang}`} download className={btnOutline}>
            <Download className="h-4 w-4" aria-hidden />
            {t.projects.downloadAll}
          </a>
        )}
        <button
          type="button"
          aria-expanded={confirming}
          aria-controls="delete-project"
          onClick={() => setConfirming((v) => !v)}
          className={`${btnOutline} hover:border-destructive hover:text-destructive`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {t.projects.delete}
        </button>
      </div>
      {total > 0 && <p className="text-xs text-muted-foreground">{t.projects.downloadNote}</p>}
      {confirming && (
        <div
          id="delete-project"
          role="group"
          aria-labelledby="delete-project-title"
          className="space-y-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4"
        >
          <p id="delete-project-title" className="font-semibold">
            {t.projects.deleteTitle(project.name)}
          </p>
          <p className="text-sm text-muted-foreground">{t.projects.deleteBody}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void remove()}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-destructive px-6 font-semibold text-destructive-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t.projects.delete}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={btnOutline}>
              {t.projects.cancel}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Projedeki tek üretim: tür, ad, meta, dinleme/önizleme ve indirme; işlemler menüde. */
function MaterialRow({
  g,
  projectId,
  renaming,
  onRename,
  onRenamed,
}: {
  g: Generation;
  projectId: string;
  renaming: boolean;
  onRename: () => void;
  onRenamed: () => void;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const Icon = typeIcons[g.type];
  const file = g.audioUrl ?? (g.type === "video" ? g.fileUrls?.[0] : undefined);
  const demo = !g.audioUrl && !g.fileUrls?.length && !g.status;

  return (
    <li className="rounded-2xl bg-muted/40 p-3">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-primary-foreground">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <GenerationTitle g={g} renaming={renaming} onDone={onRenamed} onError={setError} />
          <p className="truncate text-xs text-muted-foreground">
            {t.labs.tabs[g.type]} · {f.dateTime(g.createdAt)} · {f.num(g.cost)}{" "}
            {t.labs.creditsShort}
          </p>
        </div>
        {file ? (
          <a
            href={`${file}?download=1`}
            aria-label={t.projects.downloadFile}
            title={t.projects.downloadFile}
            className={iconLink}
          >
            <Download className="h-4 w-4" aria-hidden />
          </a>
        ) : (
          demo && <NoDownload />
        )}
        <GenerationMenu
          g={g}
          onEdit={() =>
            void navigate({
              to: "/labs",
              search: { tab: g.type, project: projectId, edit: g.id },
            })
          }
          onRename={() => {
            setError(null);
            onRename();
          }}
          onError={setError}
        />
      </div>
      {g.audioUrl && (
        <audio
          controls
          preload="none"
          src={g.audioUrl}
          className="mt-2 w-full"
          aria-label={`${t.labs.tts.play}: ${g.title ?? g.text.slice(0, 60)}`}
        />
      )}
      {g.type === "image" && g.fileUrls && (
        <div className="mt-2 flex flex-wrap gap-2">
          {g.fileUrls.map((url, i) => (
            <a
              key={url}
              href={`${url}?download=1`}
              aria-label={t.projects.downloadImage(i + 1)}
              className="block overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src={url} alt="" loading="lazy" className="h-20 w-20 object-cover" />
            </a>
          ))}
        </div>
      )}
      {g.type === "video" && g.fileUrls?.[0] && (
        <video
          controls
          preload="metadata"
          src={g.fileUrls[0]}
          aria-label={g.title ?? g.text}
          className="mt-2 aspect-video w-full max-w-md rounded-xl bg-muted"
        />
      )}
      {g.status === "pending" && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {t.projects.pending}
        </p>
      )}
      {g.status === "failed" && (
        <p className="mt-2 text-sm text-destructive">{t.projects.failed(f.num(g.cost))}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

const FILTERS = ["all", "tts", "image", "video"] as const;

function Materials({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [renaming, setRenaming] = useState<string | null>(null);
  const history = useHistory(filter === "all" ? undefined : (filter as GenerationType), projectId);

  return (
    <Panel>
      <h2 className="mb-4 text-lg font-semibold">{t.projects.materials}</h2>
      <div role="group" aria-label={t.projects.filter} className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className={`min-h-11 rounded-full border px-4 text-sm transition ${filter === k ? "border-cyan bg-cyan/15 text-cyan" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {k === "all" ? t.projects.all : t.labs.tabs[k]}
          </button>
        ))}
      </div>
      <HistoryView
        history={history}
        empty={
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t.projects.noMaterials}
          </p>
        }
      >
        <ul className="space-y-3">
          {history.items.map((g) => (
            <MaterialRow
              key={g.id}
              g={g}
              projectId={projectId}
              renaming={renaming === g.id}
              onRename={() => setRenaming(g.id)}
              onRenamed={() => setRenaming(null)}
            />
          ))}
        </ul>
      </HistoryView>
    </Panel>
  );
}

function ProjectDetail() {
  const { t } = useI18n();
  const f = useFormat();
  const { id } = Route.useParams();
  const projects = useProjects();
  const project = projects.data?.find((p) => p.id === id);

  const back = (
    <Link
      to="/projects"
      className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t.projects.back}
    </Link>
  );

  if (projects.isPending) {
    return (
      <div
        role="status"
        aria-label={t.loading}
        className="mx-auto max-w-5xl space-y-6 px-4 py-12 sm:px-6"
      >
        <div className="shimmer h-10 w-64 rounded-full" />
        <div className="shimmer h-64 rounded-3xl" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-12 sm:px-6">
        {back}
        <Panel>
          <p role="alert" className="text-center text-muted-foreground">
            {projects.isError ? t.projects.loadError : t.projects.notFound}
          </p>
        </Panel>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-12 sm:px-6">
      {back}
      <div>
        <h1 className="break-words text-4xl font-bold">{project.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.projects.counts(
            f.num(project.counts.tts),
            f.num(project.counts.image),
            f.num(project.counts.video),
          )}{" "}
          · {t.projects.updated(f.dateTime(project.updatedAt))}
        </p>
      </div>
      <ProjectActions project={project} />
      <ProjectEditor key={project.id} project={project} />
      <Materials projectId={project.id} />
    </div>
  );
}

function ProjectPage() {
  return (
    <SiteShell>
      <RequireAuth>
        <ProjectDetail />
      </RequireAuth>
    </SiteShell>
  );
}

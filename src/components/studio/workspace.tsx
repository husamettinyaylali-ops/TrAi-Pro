import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Clapperboard, Combine, Download, FolderOpen, NotebookPen, PanelLeft } from "lucide-react";

import { VoiceClone } from "@/components/labs/tools";
import { VerifyBanner } from "@/components/site/verify-banner";
import { useFormat, useI18n } from "@/lib/i18n";
import { useApp, useProjects, type Generation } from "@/lib/store";
import type { Project } from "@/lib/types";

import { Composer } from "./composer";
import { StudioFeed } from "./feed";
import { useVoices, type Tool } from "./hooks";
import { ProjectSidebar } from "./sidebar";

const ghost =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:border-cyan hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function TopBar({
  project,
  notesOpen,
  onToggleNotes,
  onMenu,
}: {
  project: Project | undefined;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onMenu: () => void;
}) {
  const { t, lang } = useI18n();
  const f = useFormat();
  const total = project ? Object.values(project.counts).reduce((a, b) => a + b, 0) : 0;
  // Seslendirme ve yazıya dökülen kayıtlar düzenleyicide birlikte kullanılır.
  const audio = project ? project.counts.tts + project.counts.stt : 0;
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 sm:px-6">
      <button
        type="button"
        onClick={onMenu}
        aria-label={t.studio.openProjects}
        aria-controls="studio-projects"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:text-foreground lg:hidden"
      >
        <PanelLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-lg font-bold">
          {project ? project.name : t.studio.all}
        </h1>
        <p className="truncate text-xs text-muted-foreground">
          {project
            ? `${t.projects.counts(f.num(project.counts.tts), f.num(project.counts.image), f.num(project.counts.video), project.counts.stt ? f.num(project.counts.stt) : undefined)} · ${t.projects.updated(f.dateTime(project.updatedAt))}`
            : t.studio.allSub}
        </p>
      </div>
      {project?.notes && (
        <button
          type="button"
          aria-expanded={notesOpen}
          aria-controls="studio-notes"
          onClick={onToggleNotes}
          className={ghost}
        >
          <NotebookPen className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t.studio.notes}</span>
        </button>
      )}
      {project && total > 0 && (
        // Tam sayfa bağlantı: ZIP sunucu rotasından akış olarak iner.
        <a
          href={`/media/project/${project.id}?lang=${lang}`}
          download
          aria-label={t.projects.downloadAll}
          className={ghost}
        >
          <Download className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t.studio.downloadAll}</span>
        </a>
      )}
      {(!project || (audio > 0 && project.counts.image > 0)) && (
        <Link
          to="/editor/video"
          search={project ? { project: project.id } : {}}
          aria-label={t.editor.video.open}
          className={ghost}
        >
          <Clapperboard className="h-4 w-4" aria-hidden />
          <span className="hidden xl:inline">{t.editor.video.open}</span>
        </Link>
      )}
      {(!project || audio > 1) && (
        <Link
          to="/editor/merge"
          search={project ? { project: project.id } : {}}
          aria-label={t.editor.merge.open}
          className={ghost}
        >
          <Combine className="h-4 w-4" aria-hidden />
          <span className="hidden xl:inline">{t.editor.merge.open}</span>
        </Link>
      )}
      {project && (
        <Link
          to="/projects/$id"
          params={{ id: project.id }}
          aria-label={t.studio.openProject}
          className={ghost}
        >
          <FolderOpen className="h-4 w-4" aria-hidden />
          <span className="hidden md:inline">{t.studio.openProject}</span>
        </Link>
      )}
    </div>
  );
}

/**
 * Yapay zeka uygulaması düzeninde stüdyo: solda projeler, ortada seçili
 * projenin akışı, altta yazma kutusu. Araç, proje ve düzenlenecek kayıt
 * adresten gelir (?tab=, ?project=, ?edit=).
 */
export function StudioWorkspace({
  tool,
  projectId,
  editId,
  onTool,
  onProject,
  onEditLoaded,
}: {
  tool: Tool;
  projectId?: string | undefined;
  editId?: string | undefined;
  onTool: (tool: Tool) => void;
  onProject: (id: string | undefined) => void;
  onEditLoaded: () => void;
}) {
  const { t } = useI18n();
  const { getGeneration } = useApp();
  const projects = useProjects();
  const { voices } = useVoices();
  const project = projectId ? projects.data?.find((p) => p.id === projectId) : undefined;
  const [drawer, setDrawer] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [editing, setEditing] = useState<Generation | null>(null);
  const [busy, setBusy] = useState<Generation["type"] | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);

  const startEdit = (g: Generation) => {
    onTool(g.type);
    setEditing(g);
  };

  // Proje sayfasından "Düzenle ve yeniden üret": kayıt bir kez yüklenip kutuya gelir.
  const handlers = useRef({ startEdit, onEditLoaded, getGeneration });
  useEffect(() => {
    handlers.current = { startEdit, onEditLoaded, getGeneration };
  });
  useEffect(() => {
    if (!editId) return;
    let live = true;
    void handlers.current.getGeneration(editId).then((res) => {
      if (!live) return;
      if (res.ok) handlers.current.startEdit(res.generation);
      handlers.current.onEditLoaded();
    });
    return () => {
      live = false;
    };
  }, [editId]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ProjectSidebar
        activeId={projectId}
        open={drawer}
        onClose={() => setDrawer(false)}
        onSelect={(id) => {
          onProject(id);
          setNotesOpen(false);
          setDrawer(false);
        }}
      />
      <section aria-label={t.labs.title} className="flex min-h-0 min-w-0 flex-col">
        <TopBar
          project={project}
          notesOpen={notesOpen}
          onToggleNotes={() => setNotesOpen((v) => !v)}
          onMenu={() => setDrawer(true)}
        />
        {notesOpen && project?.notes && (
          <div id="studio-notes" className="px-4 pt-3 sm:px-6">
            <div className="mx-auto max-w-4xl rounded-2xl border border-dashed border-border bg-muted/40 p-4 text-sm">
              <p className="whitespace-pre-wrap break-words text-muted-foreground">
                {project.notes}
              </p>
              <Link
                to="/projects/$id"
                params={{ id: project.id }}
                className="mt-2 inline-flex min-h-11 items-center font-semibold text-cyan hover:underline"
              >
                {t.studio.editNotes}
              </Link>
            </div>
          </div>
        )}
        <div className="px-4 sm:px-6 [&:has(*)]:pt-3">
          <div className="mx-auto max-w-4xl">
            <VerifyBanner />
          </div>
        </div>
        {tool === "clone" ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            <div className="mx-auto max-w-5xl">
              <VoiceClone />
            </div>
          </div>
        ) : (
          <StudioFeed
            projectId={projectId}
            projectName={project?.name}
            busy={busy}
            voices={voices}
            onEdit={startEdit}
            onSuggest={(type) => {
              onTool(type);
              setFocusSignal((n) => n + 1);
            }}
          />
        )}
        <Composer
          tool={tool}
          onTool={onTool}
          projectId={projectId}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onBusy={setBusy}
          focusSignal={focusSignal}
        />
      </section>
    </div>
  );
}

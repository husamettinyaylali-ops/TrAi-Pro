import { useState, type FormEvent } from "react";
import { FolderOpen, Plus } from "lucide-react";

import { Panel } from "@/components/labs/tools";
import { btnOutline, btnPrimary, field } from "@/components/site/shell";
import { useFormat, useI18n } from "@/lib/i18n";
import { MAX_PROJECTS, PROJECT_NAME_MAX } from "@/lib/projects";
import { useApp, useProjects } from "@/lib/store";

/**
 * Stüdyonun etkin projesi: seçiliyken yeni üretimler o projeye kaydedilir ve
 * geçmiş yalnız onu gösterir. Buradan yeni proje de açılır (açılan proje seçilir).
 */
export function ProjectBar({
  projectId,
  onSelect,
}: {
  projectId?: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const { createProject } = useApp();
  const projects = useProjects();
  const active = projects.data?.find((p) => p.id === projectId);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t.projects.errors.invalidInput);
    setBusy(true);
    const res = await createProject({ name });
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
    setName("");
    setCreating(false);
    setError(null);
    onSelect(res.project.id);
  };

  return (
    <Panel className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor="studio-project" className="mb-1.5 block text-sm font-medium">
            {t.projects.active}
          </label>
          <select
            id="studio-project"
            className={field}
            value={active?.id ?? ""}
            onChange={(e) => onSelect(e.target.value || undefined)}
          >
            <option value="">{t.projects.none}</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          aria-expanded={creating}
          aria-controls="new-project-form"
          onClick={() => {
            setCreating((v) => !v);
            setError(null);
          }}
          className={btnOutline}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t.projects.new}
        </button>
      </div>
      {creating && (
        <form
          id="new-project-form"
          onSubmit={submit}
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <label htmlFor="new-project-name" className="sr-only">
            {t.projects.name}
          </label>
          <input
            id="new-project-name"
            autoFocus
            className={`${field} sm:max-w-sm`}
            maxLength={PROJECT_NAME_MAX}
            placeholder={t.projects.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={btnPrimary}>
              {t.projects.create}
            </button>
            <button type="button" onClick={() => setCreating(false)} className={btnOutline}>
              {t.projects.cancel}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <FolderOpen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {active ? t.projects.activeHint(active.name) : t.projects.noneHint}
      </p>
    </Panel>
  );
}

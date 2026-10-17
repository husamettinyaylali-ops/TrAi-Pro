import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Coins, Folder, FolderOpen, Layers, MoreHorizontal, Plus, Search, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clock } from "@/lib/clock";
import { balance, nextExpiry, type CreditKind } from "@/lib/credits";
import { useFormat, useI18n } from "@/lib/i18n";
import { MAX_PROJECTS, PROJECT_NAME_MAX } from "@/lib/projects";
import { useApp, useProjects } from "@/lib/store";
import type { Project } from "@/lib/types";

const row =
  "group relative flex w-full min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Projenin kısa sayımı: yalnız olan türler ("3 ses · 2 görsel"). */
function useCounts() {
  const { t } = useI18n();
  const f = useFormat();
  return (p: Project) => {
    const parts = (["tts", "stt", "image", "video"] as const)
      .filter((k) => p.counts[k] > 0)
      .map((k) => t.studio.countParts[k](f.num(p.counts[k])));
    return parts.length ? parts.join(" · ") : t.studio.noItems;
  };
}

/** Kenar çubuğunun altında iki kredi bakiyesi ve kredi alma bağlantısı. */
function Credits() {
  const { t } = useI18n();
  const f = useFormat();
  const { data } = useApp();
  const now = clock();
  const line = (kind: CreditKind, label: string) => {
    const exp = nextExpiry(data.grants, kind, now);
    return (
      <div className="text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">{label}</span>
          <b className="font-semibold">{f.num(balance(data.grants, kind, now))}</b>
        </div>
        {exp && <p className="text-[11px] text-muted-foreground">{t.labs.expires(f.date(exp))}</p>}
      </div>
    );
  };
  return (
    <div className="glass space-y-1.5 rounded-2xl p-3">
      {line("voice", t.labs.voiceBalance)}
      {line("media", t.labs.mediaBalance)}
      <Link
        to="/pricing"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Coins className="h-4 w-4" aria-hidden />
        {t.labs.buy}
      </Link>
    </div>
  );
}

/**
 * Stüdyonun sol çubuğu: yeni proje, arama, tüm üretimler ve projeler; altta
 * krediler. Geniş ekranda sabit, dar ekranda soldan açılan çekmece (Esc kapatır).
 */
export function ProjectSidebar({
  activeId,
  onSelect,
  open,
  onClose,
}: {
  activeId?: string | undefined;
  onSelect: (id: string | undefined) => void;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const navigate = useNavigate();
  const { createProject } = useApp();
  const projects = useProjects();
  const countsOf = useCounts();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  const q = query.trim().toLocaleLowerCase("tr-TR");
  const list = (projects.data ?? []).filter((p) => p.name.toLocaleLowerCase("tr-TR").includes(q));

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t.projects.errors.invalidInput);
    const res = await createProject({ name });
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

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) onClose();
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-background/70 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        id="studio-projects"
        aria-label={t.projects.title}
        onKeyDown={onKey}
        className={`fixed inset-y-0 left-0 z-50 flex w-[85%] max-w-xs flex-col gap-3 border-r border-border bg-background p-3 transition-transform lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 lg:bg-background/40 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between lg:hidden">
          <span className="px-2 font-semibold">{t.projects.title}</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t.studio.closeProjects}
            className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {creating ? (
          <form onSubmit={(e) => void create(e)} className="space-y-2">
            <label htmlFor="sidebar-project-name" className="sr-only">
              {t.projects.name}
            </label>
            <input
              id="sidebar-project-name"
              autoFocus
              maxLength={PROJECT_NAME_MAX}
              placeholder={t.projects.namePlaceholder}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setCreating(false);
                }
              }}
              className="min-h-11 w-full rounded-xl border border-input bg-muted/60 px-3 text-sm outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-gradient-brand px-4 text-sm font-semibold text-primary-foreground"
              >
                {t.projects.create}
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm"
              >
                {t.projects.cancel}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setError(null);
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-brand px-4 font-semibold text-primary-foreground shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t.projects.new}
          </button>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <label className="flex min-h-11 items-center gap-2 rounded-xl bg-muted/60 px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring/40">
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className="sr-only">{t.studio.search}</span>
          <input
            type="search"
            value={query}
            placeholder={t.studio.search}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </label>

        <nav aria-label={t.projects.title} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <button
            type="button"
            aria-current={!activeId ? "page" : undefined}
            onClick={() => onSelect(undefined)}
            className={`${row} ${!activeId ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"}`}
          >
            <Layers className="h-4 w-4 shrink-0" aria-hidden />
            <span className="font-medium">{t.studio.all}</span>
          </button>
          <p className="mx-3 mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t.projects.title}
          </p>
          {projects.isPending ? (
            <div role="status" aria-label={t.loading} className="space-y-2 px-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="shimmer h-11 rounded-xl" />
              ))}
            </div>
          ) : projects.isError ? (
            <p role="alert" className="px-3 text-sm text-destructive">
              {t.projects.loadError}
            </p>
          ) : list.length === 0 ? (
            <p className="px-3 text-sm text-muted-foreground">
              {q ? t.studio.noResults : t.studio.noProjects}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {list.map((p) => {
                const active = p.id === activeId;
                const Icon = active ? FolderOpen : Folder;
                return (
                  <li key={p.id} className="relative">
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => onSelect(p.id)}
                      className={`${row} pr-12 ${active ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"}`}
                    >
                      {active && (
                        <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-gradient-brand" />
                      )}
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {countsOf(p)}
                        </span>
                      </span>
                    </button>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger
                        aria-label={`${t.studio.more}: ${p.name}`}
                        className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-52">
                        <DropdownMenuItem
                          className="min-h-11"
                          onSelect={() =>
                            void navigate({ to: "/projects/$id", params: { id: p.id } })
                          }
                        >
                          <FolderOpen /> {t.studio.openProject}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <Credits />
      </aside>
    </>
  );
}

import { Link } from "@tanstack/react-router";
import { useRef, useState, type KeyboardEvent } from "react";
import {
  Download,
  Folder,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Scissors,
  TextCursorInput,
  Trash2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { editorBlock } from "@/components/editor/utils";
import { useI18n } from "@/lib/i18n";
import { GENERATION_TITLE_MAX } from "@/lib/projects";
import { useApp, useProjects, type Generation } from "@/lib/store";

const iconBtn =
  "grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const item = "min-h-11";

/** Kısa ad: kullanıcının verdiği ad, yoksa metnin başı. */
const shortName = (g: Generation) =>
  g.title ?? (g.text.length > 40 ? `${g.text.slice(0, 40)}…` : g.text);

/**
 * Üretimin adı (yoksa metni); yeniden adlandırılırken ad alanı. Ad verilmişse
 * metin altında soluk gösterilir.
 */
export function GenerationTitle({
  g,
  renaming,
  onDone,
  onError,
}: {
  g: Generation;
  renaming: boolean;
  onDone: () => void;
  onError: (text: string) => void;
}) {
  if (renaming) return <RenameInput g={g} onDone={onDone} onError={onError} />;
  return (
    <>
      <p className="truncate text-sm font-medium">{g.title ?? g.text}</p>
      {g.title && <p className="truncate text-xs text-muted-foreground">{g.text}</p>}
    </>
  );
}

/** Enter ya da odaktan çıkınca bir kez kaydeder; Esc vazgeçer. */
function RenameInput({
  g,
  onDone,
  onError,
}: {
  g: Generation;
  onDone: () => void;
  onError: (text: string) => void;
}) {
  const { t } = useI18n();
  const { renameGeneration } = useApp();
  const [value, setValue] = useState(g.title ?? "");
  const finished = useRef(false);

  const finish = async (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save && value.trim() !== (g.title ?? "")) {
      const res = await renameGeneration(g.id, value);
      if (!res.ok) onError(t.projects.errors.failed);
    }
    onDone();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void finish(true);
    }
    if (e.key === "Escape") void finish(false);
  };
  return (
    <input
      autoFocus
      aria-label={t.labs.renameLabel}
      className="w-full rounded-lg border border-input bg-muted/60 px-3 py-2 text-sm outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      maxLength={GENERATION_TITLE_MAX}
      placeholder={g.text.slice(0, GENERATION_TITLE_MAX)}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => void finish(true)}
    />
  );
}

/** Demo üretimde dosya yoktur; indirme düğmesi nedenini söyleyerek kapalı durur. */
export function NoDownload() {
  const { t } = useI18n();
  return (
    <button
      type="button"
      disabled
      aria-label={t.labs.downloadUnavailable}
      title={t.labs.downloadUnavailable}
      className={`${iconBtn} cursor-not-allowed opacity-40`}
    >
      <Download className="h-4 w-4" aria-hidden />
    </button>
  );
}

/**
 * Üretimin işlemleri: düzenleyip yeniden üretme, yeniden adlandırma, projeye
 * taşıma ve silme. Hazırlanan (pending) video düzenlenemez ve silinemez.
 */
export function GenerationMenu({
  g,
  onEdit,
  onRename,
  onError,
}: {
  g: Generation;
  onEdit: () => void;
  onRename: () => void;
  onError: (text: string) => void;
}) {
  const { t } = useI18n();
  const { moveGeneration, deleteGeneration } = useApp();
  const projects = useProjects();
  const pending = g.status === "pending";
  // Düzenle ve yeniden adlandır odağı forma/ad alanına taşır; menü kapanırken
  // odağı kendi düğmesine geri almasın.
  const keepFocus = useRef(false);
  const focusElsewhere = (action: () => void) => () => {
    keepFocus.current = true;
    action();
  };

  const move = async (value: string) => {
    const target = value || null;
    if (target === (g.projectId ?? null)) return;
    const res = await moveGeneration(g.id, target);
    if (!res.ok) onError(t.projects.errors[res.error === "notFound" ? "notFound" : "failed"]);
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger aria-label={t.labs.actions} className={iconBtn}>
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60"
        onCloseAutoFocus={(e) => {
          if (keepFocus.current) e.preventDefault();
          keepFocus.current = false;
        }}
      >
        <DropdownMenuItem className={item} disabled={pending} onSelect={focusElsewhere(onEdit)}>
          <Pencil /> {t.labs.edit}
        </DropdownMenuItem>
        {!editorBlock(g) && (
          <DropdownMenuItem asChild className={item}>
            <Link to="/editor/$id" params={{ id: g.id }}>
              <Scissors /> {t.studio.openEditor}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={item} onSelect={focusElsewhere(onRename)}>
          <TextCursorInput /> {t.labs.rename}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={item}>
            <FolderInput /> {t.labs.moveTo}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
            <DropdownMenuRadioGroup value={g.projectId ?? ""} onValueChange={(v) => void move(v)}>
              <DropdownMenuRadioItem className={item} value="">
                {t.labs.noProject}
              </DropdownMenuRadioItem>
              {projects.data?.map((p) => (
                <DropdownMenuRadioItem key={p.id} className={item} value={p.id}>
                  <span className="truncate">{p.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={`${item} text-destructive focus:text-destructive`}
          disabled={pending}
          onSelect={() => void deleteGeneration(g.id)}
        >
          <Trash2 /> {t.labs.delete}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Süzgeçsiz geçmişte üretimin hangi projede olduğu; dar sütunda kesilmesin diye ayrı satır. */
export function ProjectTag({ id }: { id?: string | undefined }) {
  const { t } = useI18n();
  const projects = useProjects();
  const name = id ? projects.data?.find((p) => p.id === id)?.name : undefined;
  if (!name) return null;
  return (
    <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <Folder className="h-3 w-3 shrink-0" aria-hidden />
      <span className="sr-only">{t.projects.active}: </span>
      <span className="truncate">{name}</span>
    </p>
  );
}

/** Düzeltme sırasında formun üstünde: hangi kaydın düzenlendiği ve ne olacağı. */
export function EditBanner({ g, onCancel }: { g: Generation; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-cyan/40 bg-cyan/10 p-3 text-sm">
      <p className="min-w-0">
        <span className="font-semibold">{t.labs.editing.banner(shortName(g))}</span>{" "}
        <span className="text-muted-foreground">{t.labs.editing.note}</span>
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 shrink-0 rounded-full px-3 font-semibold text-cyan transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t.labs.editing.cancel}
      </button>
    </div>
  );
}

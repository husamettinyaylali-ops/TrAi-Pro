import { Fragment, useLayoutEffect, useRef } from "react";
import { Film, FolderOpen, ImageIcon, Loader2, Mic } from "lucide-react";

import { btnOutline } from "@/components/site/shell";
import { useI18n } from "@/lib/i18n";
import { useHistory, type Generation } from "@/lib/store";
import type { GenerationType } from "@/lib/types";
import type { Voice } from "@/lib/voices";

import { GenerationCard } from "./card";
import { dayKey, useDayLabel, usePendingPolling } from "./hooks";

const suggestions: { type: GenerationType; icon: typeof Mic }[] = [
  { type: "tts", icon: Mic },
  { type: "image", icon: ImageIcon },
  { type: "video", icon: Film },
];

/**
 * Seçili projenin (ya da tüm üretimlerin) akışı: sohbet gibi en yenisi altta.
 * Açılışta ve yeni üretim gelince en alta kayar; daha eski sayfa yüklenince
 * okunan yer kaymaz.
 */
export function StudioFeed({
  projectId,
  projectName,
  busy,
  voices,
  onEdit,
  onSuggest,
}: {
  projectId?: string | undefined;
  projectName?: string | undefined;
  /** Yazma kutusunda süren üretim: akışın sonunda yer tutucu gösterilir. */
  busy: GenerationType | null;
  voices: Voice[];
  onEdit: (g: Generation) => void;
  onSuggest: (type: GenerationType) => void;
}) {
  const { t } = useI18n();
  const dayLabel = useDayLabel();
  const history = useHistory(undefined, projectId);
  usePendingPolling(history.items);
  const items = [...history.items].reverse();

  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ newest?: string | undefined; fromBottom: number | null }>({
    fromBottom: null,
  });
  const newest = history.items[0]?.id;

  // Yeni üretim, proje değişimi ya da ilk yükleme: en alta. Eski sayfa: okunan yer korunur.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const keep = anchor.current.fromBottom;
    if (keep !== null && anchor.current.newest === newest) {
      el.scrollTop = el.scrollHeight - keep;
    } else {
      el.scrollTop = el.scrollHeight;
    }
    anchor.current = { newest, fromBottom: null };
  }, [newest, items.length, busy, projectId, history.loading]);

  const loadOlder = () => {
    const el = scroller.current;
    if (el) anchor.current = { newest, fromBottom: el.scrollHeight - el.scrollTop };
    history.loadMore();
  };

  let body;
  if (history.loading) {
    body = (
      <div role="status" aria-label={t.loading} className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="shimmer h-36 rounded-3xl" />
        ))}
      </div>
    );
  } else if (history.error && items.length === 0) {
    body = (
      <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center text-sm">
        <p className="text-destructive">{t.labs.historyError}</p>
        <button type="button" onClick={history.retry} className={btnOutline}>
          {t.rootPages.retry}
        </button>
      </div>
    );
  } else if (items.length === 0 && !busy) {
    body = (
      <div className="flex flex-col items-center py-16 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
          <FolderOpen className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-bold">
          {projectName ? t.studio.emptyTitle(projectName) : t.studio.emptyAllTitle}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.studio.emptySub}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {suggestions.map(({ type, icon: I }) => (
            <button
              key={type}
              type="button"
              onClick={() => onSuggest(type)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm transition hover:border-cyan hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <I className="h-4 w-4" aria-hidden />
              {t.studio.suggest[type]}
            </button>
          ))}
        </div>
      </div>
    );
  } else {
    body = (
      <>
        {(history.hasMore || history.error) && (
          <div className="flex flex-col items-center gap-2">
            {history.error && (
              <p role="alert" className="text-sm text-destructive">
                {t.labs.historyError}
              </p>
            )}
            <button
              type="button"
              onClick={loadOlder}
              disabled={history.loadingMore}
              className={`${btnOutline} disabled:opacity-60`}
            >
              {history.loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t.labs.loadMore}
            </button>
          </div>
        )}
        <ol className="flex flex-col gap-4" aria-label={t.labs.history}>
          {items.map((g, i) => {
            const day = dayKey(g.createdAt);
            const first = i === 0 || dayKey(items[i - 1]!.createdAt) !== day;
            return (
              <Fragment key={g.id}>
                {first && (
                  <li className="self-center">
                    <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                      {dayLabel(g.createdAt)}
                    </span>
                  </li>
                )}
                <li>
                  <GenerationCard g={g} voices={voices} showProject={!projectId} onEdit={onEdit} />
                </li>
              </Fragment>
            );
          })}
        </ol>
        {busy && (
          <div role="status" aria-label={t.studio.working} className="shimmer h-36 rounded-3xl" />
        )}
      </>
    );
  }

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">{body}</div>
    </div>
  );
}

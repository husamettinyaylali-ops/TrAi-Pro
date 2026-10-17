import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Combine, Loader2 } from "lucide-react";

import { Panel } from "@/components/labs/tools";
import { btnPrimary, field } from "@/components/site/shell";
import { GENERATION_TITLE_MAX } from "@/lib/projects";
import { useFormat, useI18n } from "@/lib/i18n";
import { useApp, useHistory, type Generation } from "@/lib/store";

import { SavedNotice } from "./saved-notice";
import { smallBtn, useAudioDurations, useEditError, useSeconds } from "./utils";

/** Sunucudaki MERGE_GAPS ve MERGE_MAX_CLIPS ile aynı. */
const GAPS = [0, 500, 1000, 2000] as const;
const MAX_CLIPS = 30;

const iconBtn =
  "grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30";

/**
 * Sesleri birleştir: projedeki (ya da tüm) gerçek seslendirmeler eskiden
 * yeniye listelenir; seçilenler gösterilen sırayla, araya istenen sessizlik
 * konarak tek MP3 ve altyazıda birleşir. Sonuç yeni kayıttır, ücretsizdir.
 */
export function MergeEditor({ projectId }: { projectId: string | undefined }) {
  const { t } = useI18n();
  const m = t.editor.merge;
  const f = useFormat();
  const secs = useSeconds();
  const editError = useEditError();
  const { mergeSpeech } = useApp();
  const history = useHistory("tts", projectId);
  // Birleştirme doğal sırayla (eskiden yeniye) yapılır.
  const clips = useMemo(
    () => history.items.filter((g) => g.audioUrl && !g.status).reverse(),
    [history.items],
  );
  const durations = useAudioDurations(clips);
  const [order, setOrder] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [gap, setGap] = useState<(typeof GAPS)[number]>(500);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Generation | null>(null);

  // Yeni yüklenen sesler sıranın sonuna eklenir; kullanıcının sırası korunur.
  useEffect(() => {
    setOrder((o) => {
      const known = new Set(o);
      const fresh = clips.map((g) => g.id).filter((id) => !known.has(id));
      return fresh.length ? [...o.filter((id) => clips.some((g) => g.id === id)), ...fresh] : o;
    });
  }, [clips]);

  const byId = new Map(clips.map((g) => [g.id, g]));
  const rows = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const selected = rows.filter((g) => checked.has(g.id));
  const known = selected.every((g) => durations[g.id] !== undefined);
  const totalMs =
    selected.reduce((s, g) => s + (durations[g.id] ?? 0), 0) +
    Math.max(0, selected.length - 1) * gap;

  const move = (id: string, by: -1 | 1) =>
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const toggle = (id: string) =>
    setChecked((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_CLIPS) next.add(id);
      return next;
    });

  const submit = async () => {
    if (selected.length < 2) return setError(m.needTwo);
    setBusy(true);
    setError(null);
    const res = await mergeSpeech({
      ids: selected.map((g) => g.id),
      gapMs: gap,
      projectId,
      title: title.trim() || m.defaultName(f.num(selected.length)),
    });
    setBusy(false);
    if (res.ok) setSaved(res.generation);
    else setError(res.error === "invalidInput" ? m.invalid : editError(res));
  };

  if (history.loading) {
    return <div role="status" aria-label={t.loading} className="shimmer h-64 rounded-3xl" />;
  }
  if (history.error) {
    return (
      <Panel>
        <p role="alert" className="text-center text-muted-foreground">
          {t.labs.historyError}
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="merge-pick"
        className="glass glow-border space-y-3 rounded-3xl p-4 sm:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="merge-pick" className="text-lg font-semibold">
            {m.pick}
          </h2>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {m.summary(f.num(selected.length), known ? secs(totalMs) : "…")}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.empty}</p>
        ) : (
          <ol className="divide-y divide-border">
            {rows.map((g, i) => {
              const name = g.title ?? (g.text.length > 60 ? `${g.text.slice(0, 60)}…` : g.text);
              const n = selected.indexOf(g);
              return (
                <li key={g.id} className="flex items-center gap-2 py-2">
                  <input
                    id={`merge-${g.id}`}
                    type="checkbox"
                    checked={checked.has(g.id)}
                    onChange={() => toggle(g.id)}
                    className="h-5 w-5 shrink-0 accent-violet"
                  />
                  <label htmlFor={`merge-${g.id}`} className="min-w-0 flex-1 cursor-pointer py-1">
                    <span className="block truncate text-sm font-medium">
                      {n >= 0 && <span className="mr-1.5 text-cyan">{f.num(n + 1)}.</span>}
                      {name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {f.dateTime(g.createdAt)}
                      {durations[g.id] !== undefined && ` · ${secs(durations[g.id]!)} sn`}
                      {g.edit && ` · ${t.studio.editTag[g.edit]}`}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => move(g.id, -1)}
                    disabled={i === 0}
                    aria-label={m.moveUp(name)}
                    className={iconBtn}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(g.id, 1)}
                    disabled={i === rows.length - 1}
                    aria-label={m.moveDown(name)}
                    className={iconBtn}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {history.hasMore && (
          <button
            type="button"
            onClick={history.loadMore}
            disabled={history.loadingMore}
            className={smallBtn}
          >
            {history.loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {m.loadOlder}
          </button>
        )}
        {checked.size >= MAX_CLIPS && (
          <p className="text-xs text-muted-foreground">{m.max(f.num(MAX_CLIPS))}</p>
        )}
      </section>

      <section
        aria-labelledby="merge-options"
        className="glass glow-border space-y-4 rounded-3xl p-4 sm:p-6"
      >
        <h2 id="merge-options" className="sr-only">
          {m.options}
        </h2>
        <div>
          <p id="merge-gap" className="mb-2 text-sm font-medium">
            {m.gap}
          </p>
          <div role="group" aria-labelledby="merge-gap" className="flex flex-wrap gap-2">
            {GAPS.map((v, i) => (
              <button
                key={v}
                type="button"
                aria-pressed={gap === v}
                onClick={() => setGap(v)}
                className={`${smallBtn} ${gap === v ? "border-cyan bg-cyan/10 text-cyan" : ""}`}
              >
                {m.gaps[i]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="merge-title" className="mb-1.5 block text-sm font-medium">
            {m.name}
          </label>
          <input
            id="merge-title"
            className={field}
            maxLength={GENERATION_TITLE_MAX}
            value={title}
            placeholder={m.defaultName(f.num(Math.max(2, selected.length)))}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      </section>

      {saved ? (
        <SavedNotice g={saved} text={m.saved} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className={btnPrimary}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Combine className="h-4 w-4" aria-hidden />
            )}
            {busy ? m.working : m.submit}
          </button>
          <p className="text-sm text-muted-foreground">{t.editor.free}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

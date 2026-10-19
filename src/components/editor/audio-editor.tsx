import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, Save, Square, Wand2 } from "lucide-react";

import { btnPrimary, field } from "@/components/site/shell";
import { useFormat, useI18n } from "@/lib/i18n";
import { useApp, type Generation } from "@/lib/store";
import type { SubtitleCue } from "@/lib/types";

import { analyzeAudio, bucketPeaks, silenceBounds } from "./audio-analysis";
import { SavedNotice } from "./saved-notice";
import { smallBtn, useClock, useEditError, useSeconds } from "./utils";

const BARS = 160;
/** Kırpılan ses en az bu kadar sürer (sunucudaki MIN_TRIM_MS ile aynı). */
const MIN_MS = 500;
const CUE_MAX = 200;

function RangeField({
  id,
  label,
  value,
  max,
  display,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  max: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <output htmlFor={id} className="font-mono tabular-nums text-muted-foreground">
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        step={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-6 w-full accent-violet"
      />
    </div>
  );
}

/**
 * Ses düzenleyici: baştan/sondan kırpma (sunucuda kayıpsız), seçimi dinleme,
 * sessiz baş ve sonu otomatik bulma ve altyazı metnini düzeltme. Kayıt yeni
 * sürüm açar; kaynak değişmez.
 */
export function AudioEditor({ g }: { g: Generation }) {
  const { t } = useI18n();
  const e = t.editor;
  const f = useFormat();
  const clock = useClock();
  const secs = useSeconds();
  const editError = useEditError();
  const { trimSpeech } = useApp();
  const audioUrl = g.audioUrl ?? "";
  const audioRef = useRef<HTMLAudioElement>(null);
  const raf = useRef(0);

  const [duration, setDuration] = useState<number | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [env, setEnv] = useState<Float32Array | null>(null);
  const [wave, setWave] = useState<"loading" | "ready" | "none">("loading");
  const [cues, setCues] = useState<SubtitleCue[] | null>(null);
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [head, setHead] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Generation | null>(null);
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  });

  useEffect(() => {
    const ctrl = new AbortController();
    analyzeAudio(audioUrl, ctrl.signal).then(
      (v) => {
        setEnv(v);
        setWave(v ? "ready" : "none");
      },
      () => {
        if (!ctrl.signal.aborted) setWave("none");
      },
    );
    return () => ctrl.abort();
  }, [audioUrl]);

  useEffect(() => {
    if (!g.subtitleUrl) {
      setCues([]);
      return;
    }
    const ctrl = new AbortController();
    fetch(`${g.subtitleUrl}?format=json`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ cues?: SubtitleCue[] }>) : { cues: [] }))
      .then(
        (b) => setCues(b.cues ?? []),
        () => {
          if (!ctrl.signal.aborted) setCues([]);
        },
      );
    return () => ctrl.abort();
  }, [g.subtitleUrl]);

  // Süre önce oynatıcıdan; okunamazsa çözülen sesten.
  const total = duration ?? (env ? env.length * 10 : null);
  useEffect(() => {
    if (total && !range) setRange([0, total]);
  }, [total, range]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const peaks = useMemo(() => (env ? bucketPeaks(env, BARS) : null), [env]);

  const stop = () => {
    audioRef.current?.pause();
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    setHead(null);
  };
  const play = () => {
    const a = audioRef.current;
    if (!a || !range) return;
    if (playing) return stop();
    a.currentTime = range[0] / 1000;
    a.play().then(
      () => {
        setPlaying(true);
        const tick = () => {
          const ms = a.currentTime * 1000;
          const end = rangeRef.current?.[1] ?? 0;
          if (a.paused || ms >= end) return stop();
          setHead(ms);
          raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
      },
      () => setError(e.audio.playFailed),
    );
  };

  const setStart = (v: number) =>
    setRange((r) => (r ? [Math.max(0, Math.min(v, r[1] - MIN_MS)), r[1]] : r));
  const setEnd = (v: number) =>
    setRange((r) => (r && total ? [r[0], Math.min(total, Math.max(v, r[0] + MIN_MS))] : r));
  const autoTrim = () => {
    const b = env && silenceBounds(env);
    if (b && total && b.end - b.start >= MIN_MS) setRange([b.start, Math.min(total, b.end)]);
  };

  const edited = cues?.some((c, i) => texts[i] !== undefined && texts[i] !== c.text) ?? false;
  const trimmed = !!range && !!total && (range[0] > 0 || range[1] < total);
  const visible = (cues ?? [])
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => range && c.end > range[0] && c.start < range[1]);
  const dropped = (cues?.length ?? 0) - visible.length;

  const save = async () => {
    if (!range) return;
    stop();
    setSaving(true);
    setError(null);
    const res = await trimSpeech({
      id: g.id,
      startMs: Math.round(range[0]),
      endMs: Math.round(range[1]),
      cues: edited && cues ? cues.map((c, i) => ({ ...c, text: texts[i] ?? c.text })) : undefined,
    });
    setSaving(false);
    if (res.ok) setSaved(res.generation);
    else setError(editError(res));
  };

  return (
    <div className="space-y-6">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={(ev) => {
          const d = Math.round(ev.currentTarget.duration * 1000);
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        className="hidden"
      />

      <section
        aria-labelledby="trim-title"
        className="glass glow-border space-y-4 rounded-3xl p-4 sm:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="trim-title" className="text-lg font-semibold">
            {e.audio.trim}
          </h2>
          {total !== null && (
            <p className="text-sm text-muted-foreground">{e.audio.original(secs(total))}</p>
          )}
        </div>

        {wave === "loading" || !range || !total ? (
          <div role="status" aria-label={t.loading} className="shimmer h-24 rounded-2xl" />
        ) : (
          <div
            className="relative flex h-24 items-center gap-px overflow-hidden rounded-2xl bg-muted/50 px-2"
            aria-hidden
          >
            {(peaks ?? Array.from({ length: BARS }, () => 0.15)).map((p, i) => {
              const at = ((i + 0.5) / BARS) * total;
              const inside = at >= range[0] && at <= range[1];
              return (
                <span
                  key={i}
                  className={`flex-1 rounded-full ${inside ? "bg-cyan" : "bg-muted-foreground/30"}`}
                  style={{ height: `${Math.max(6, Math.round(p * 100))}%` }}
                />
              );
            })}
            {head !== null && (
              <span
                className="absolute inset-y-2 w-0.5 rounded-full bg-foreground"
                style={{ left: `calc(0.5rem + (100% - 1rem) * ${head / total})` }}
              />
            )}
          </div>
        )}
        {wave === "none" && <p className="text-xs text-muted-foreground">{e.audio.noWave}</p>}

        {range && total ? (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
              <RangeField
                id="trim-start"
                label={e.audio.start}
                value={range[0]}
                max={total}
                display={clock(range[0])}
                onChange={setStart}
              />
              <RangeField
                id="trim-end"
                label={e.audio.end}
                value={range[1]}
                max={total}
                display={clock(range[1])}
                onChange={setEnd}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm font-medium" aria-live="polite">
                {e.audio.selection(clock(range[0]), clock(range[1]), secs(range[1] - range[0]))}
              </p>
              <button
                type="button"
                onClick={autoTrim}
                disabled={wave !== "ready"}
                title={wave === "ready" ? undefined : e.audio.noWave}
                className={smallBtn}
              >
                <Wand2 className="h-4 w-4" aria-hidden />
                {e.audio.autoTrim}
              </button>
              <button
                type="button"
                onClick={() => setRange([0, total])}
                disabled={!trimmed}
                className={smallBtn}
              >
                {e.audio.reset}
              </button>
              <button type="button" onClick={play} className={smallBtn}>
                {playing ? (
                  <Square className="h-4 w-4" aria-hidden />
                ) : (
                  <Play className="h-4 w-4" aria-hidden />
                )}
                {playing ? e.audio.stop : e.audio.play}
              </button>
            </div>
          </>
        ) : null}
      </section>

      {/* Ses efektinin konuşması, dolayısıyla altyazısı yoktur. */}
      {g.type !== "sfx" && (
        <section
          aria-labelledby="captions-title"
          className="glass glow-border space-y-3 rounded-3xl p-4 sm:p-6"
        >
          <h2 id="captions-title" className="text-lg font-semibold">
            {e.audio.captions}
          </h2>
          {cues === null ? (
            <div role="status" aria-label={t.loading} className="shimmer h-24 rounded-2xl" />
          ) : cues.length === 0 ? (
            <p className="text-sm text-muted-foreground">{e.audio.noCaptions}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{e.audio.captionsHint}</p>
              {dropped > 0 && (
                <p className="text-sm text-magenta">{e.audio.dropped(f.num(dropped))}</p>
              )}
              <ol className="space-y-1.5">
                {visible.map(({ c, i }) => {
                  const from = range ? Math.max(0, c.start - range[0]) : c.start;
                  const to = range ? Math.min(range[1], c.end) - range[0] : c.end;
                  const active = head !== null && head >= c.start && head < c.end;
                  return (
                    <li
                      key={i}
                      className={`grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-center gap-2 rounded-xl px-2 py-1 transition ${active ? "bg-cyan/10" : ""}`}
                    >
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {clock(from)} → {clock(to)}
                      </span>
                      <label htmlFor={`cue-${i}`} className="sr-only">
                        {e.audio.lineLabel(i + 1)}
                      </label>
                      <textarea
                        id={`cue-${i}`}
                        rows={2}
                        maxLength={CUE_MAX}
                        value={texts[i] ?? c.text}
                        onChange={(ev) => {
                          const v = ev.target.value;
                          setTexts((x) => ({ ...x, [i]: v }));
                        }}
                        className={`${field} resize-none py-2`}
                      />
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>
      )}

      {saved ? (
        <SavedNotice g={saved} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !range || (!trimmed && !edited)}
            className={btnPrimary}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            {saving ? e.saving : e.save}
          </button>
          <p className="text-sm text-muted-foreground">
            {/* Altyazısız seste (efekt ya da zamanlaması olmayan ses) yalnız kırpma kalır. */}
            {!trimmed && !edited
              ? cues?.length
                ? e.audio.unchanged
                : e.audio.unchangedTrim
              : e.free}
          </p>
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

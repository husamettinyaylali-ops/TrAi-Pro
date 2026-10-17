import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Clapperboard, Loader2, X } from "lucide-react";

import { Panel } from "@/components/labs/tools";
import { btnPrimary, field } from "@/components/site/shell";
import { GENERATION_TITLE_MAX } from "@/lib/projects";
import { useFormat, useI18n } from "@/lib/i18n";
import { useApp, useHistory, type Generation } from "@/lib/store";
import { useStudioConfig } from "@/lib/studio-config";
import type { ComposeRequest } from "@/lib/types";

import { smallBtn, useAudioDurations, useEditError, useSeconds } from "./utils";

/** Sunucudaki COMPOSE_MAX_IMAGES ile aynı. */
const MAX_IMAGES = 30;
const FORMATS = ["9:16", "16:9", "1:1"] as const;
const ASPECT = { "9:16": "9 / 16", "16:9": "16 / 9", "1:1": "1 / 1" } as const;
/** Altyazı boyutu kısa kenarın oranı (sunucudaki ASS stiliyle aynı). */
const CAPTION_SIZE = { s: 0.05, m: 0.065, l: 0.08 } as const;

interface ImageRef {
  key: string;
  id: string;
  index: number;
  url: string;
  label: string;
}

const iconBtn =
  "grid h-9 w-9 place-items-center rounded-full bg-background/80 text-foreground transition hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30";

/**
 * Kısa video oluşturucu: projedeki bir seslendirme ve seçilen görsellerden
 * (gösterim sırasıyla) altyazılı MP4. Önizleme ilk görseli seçilen biçimde ve
 * altyazı stiliyle gösterir. İş sunucuda arka planda yapılır; ilerleme kartta.
 */
export function VideoComposer({ projectId }: { projectId: string | undefined }) {
  const { t } = useI18n();
  const v = t.editor.video;
  const f = useFormat();
  const secs = useSeconds();
  const editError = useEditError();
  const { composeVideo } = useApp();
  const config = useStudioConfig();
  const audioHistory = useHistory("audio", projectId);
  const imageHistory = useHistory("image", projectId);
  const audios = useMemo(
    () => audioHistory.items.filter((g) => g.audioUrl && !g.status),
    [audioHistory.items],
  );
  const durations = useAudioDurations(audios);
  const images = useMemo<ImageRef[]>(
    () =>
      imageHistory.items
        .filter((g) => g.fileUrls?.length && !g.status)
        .flatMap((g) =>
          (g.fileUrls ?? []).map((url, index) => ({
            key: `${g.id}:${index}`,
            id: g.id,
            index,
            url,
            label: g.title ?? g.text,
          })),
        ),
    [imageHistory.items],
  );

  const [audioId, setAudioId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [format, setFormat] = useState<ComposeRequest["format"]>("9:16");
  const [showCaptions, setShowCaptions] = useState(true);
  const [position, setPosition] = useState<ComposeRequest["captions"]["position"]>("bottom");
  const [size, setSize] = useState<ComposeRequest["captions"]["size"]>("m");
  const [motion, setMotion] = useState(true);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<Generation | null>(null);

  const audio = audios.find((g) => g.id === (audioId ?? audios[0]?.id));
  const byKey = new Map(images.map((r) => [r.key, r]));
  const order = picked.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
  const canBurn = config.data?.compose.subtitles ?? false;
  const captionsOn = showCaptions && canBurn && Boolean(audio?.subtitleUrl);
  const length = audio ? durations[audio.id] : undefined;

  const toggle = (key: string) =>
    setPicked((p) =>
      p.includes(key) ? p.filter((k) => k !== key) : p.length < MAX_IMAGES ? [...p, key] : p,
    );
  const shift = (i: number, by: -1 | 1) =>
    setPicked((p) => {
      const j = i + by;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const submit = async () => {
    if (!audio) return setError(v.needAudio);
    if (!order.length) return setError(v.needImages);
    setBusy(true);
    setError(null);
    const res = await composeVideo({
      audioId: audio.id,
      images: order.map((r) => ({ id: r.id, index: r.index })),
      format,
      captions: { show: captionsOn, position, size },
      motion,
      projectId,
      title: title.trim() || (audio.title ?? undefined),
    });
    setBusy(false);
    if (res.ok) return setStarted(res.generation);
    setError(
      res.error === "limit"
        ? v.errors.limit
        : res.error === "invalidInput"
          ? v.errors.invalidInput
          : res.error === "unavailable"
            ? v.unavailable
            : editError(res),
    );
  };

  if (config.isPending || audioHistory.loading || imageHistory.loading) {
    return <div role="status" aria-label={t.loading} className="shimmer h-72 rounded-3xl" />;
  }
  if (!config.data?.compose.available) {
    return (
      <Panel>
        <p className="text-center text-muted-foreground">{v.unavailable}</p>
      </Panel>
    );
  }

  const segment = (on: boolean) => `${smallBtn} ${on ? "border-cyan bg-cyan/10 text-cyan" : ""}`;
  const minSide = format === "16:9" ? 56.25 : 100;
  const sample = (audio?.text ?? "").split(/\s+/).slice(0, 7).join(" ");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <section
          aria-labelledby="compose-audio"
          className="glass glow-border space-y-3 rounded-3xl p-4 sm:p-6"
        >
          <div>
            <h2 id="compose-audio" className="text-lg font-semibold">
              {v.audio}
            </h2>
            <p className="text-sm text-muted-foreground">{v.audioHint}</p>
          </div>
          {audios.length === 0 ? (
            <p className="text-sm text-muted-foreground">{v.noAudio}</p>
          ) : (
            <div
              role="radiogroup"
              aria-labelledby="compose-audio"
              className="divide-y divide-border"
            >
              {audios.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-3 py-2">
                  <input
                    type="radio"
                    name="compose-audio"
                    checked={audio?.id === g.id}
                    onChange={() => setAudioId(g.id)}
                    className="h-5 w-5 shrink-0 accent-violet"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{g.title ?? g.text}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {f.dateTime(g.createdAt)}
                      {durations[g.id] !== undefined && ` · ${secs(durations[g.id]!)} sn`}
                      {g.subtitleUrl && ` · ${v.hasCaptions}`}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {audioHistory.hasMore && (
            <button
              type="button"
              onClick={audioHistory.loadMore}
              disabled={audioHistory.loadingMore}
              className={smallBtn}
            >
              {v.loadMore}
            </button>
          )}
        </section>

        <section
          aria-labelledby="compose-images"
          className="glass glow-border space-y-3 rounded-3xl p-4 sm:p-6"
        >
          <div>
            <h2 id="compose-images" className="text-lg font-semibold">
              {v.images}
            </h2>
            <p className="text-sm text-muted-foreground">{v.imagesHint}</p>
          </div>
          {images.length === 0 ? (
            <p className="text-sm text-muted-foreground">{v.noImages}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((r) => {
                const n = picked.indexOf(r.key);
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      aria-pressed={n >= 0}
                      aria-label={`${r.label} (${v.pickImage(f.num(r.index + 1))})`}
                      onClick={() => toggle(r.key)}
                      className={`relative block w-full overflow-hidden rounded-xl ring-offset-2 ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${n >= 0 ? "ring-2 ring-cyan" : "opacity-80 hover:opacity-100"}`}
                    >
                      <img
                        src={r.url}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                      {n >= 0 && (
                        <span className="absolute left-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-cyan text-xs font-bold text-background">
                          {f.num(n + 1)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {imageHistory.hasMore && (
            <button
              type="button"
              onClick={imageHistory.loadMore}
              disabled={imageHistory.loadingMore}
              className={smallBtn}
            >
              {v.loadMore}
            </button>
          )}
          {picked.length >= MAX_IMAGES && (
            <p className="text-xs text-muted-foreground">{v.maxImages(f.num(MAX_IMAGES))}</p>
          )}
          {order.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">{v.order}</p>
              <ol className="flex gap-2 overflow-x-auto pb-1">
                {order.map((r, i) => {
                  const n = f.num(i + 1);
                  return (
                    <li key={r.key} className="relative w-24 shrink-0">
                      <img
                        src={r.url}
                        alt={`${n}. ${r.label}`}
                        className="aspect-square w-24 rounded-xl object-cover"
                      />
                      <div className="absolute inset-x-1 bottom-1 flex justify-between">
                        <button
                          type="button"
                          onClick={() => shift(i, -1)}
                          disabled={i === 0}
                          aria-label={v.moveLeft(n)}
                          className={iconBtn}
                        >
                          <ArrowLeft className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => shift(i, 1)}
                          disabled={i === order.length - 1}
                          aria-label={v.moveRight(n)}
                          className={iconBtn}
                        >
                          <ArrowRight className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle(r.key)}
                        aria-label={v.remove(n)}
                        className={`${iconBtn} absolute right-1 top-1`}
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </section>
      </div>

      <div className="space-y-6">
        <section
          aria-labelledby="compose-preview"
          className="glass glow-border space-y-3 rounded-3xl p-4 sm:p-6"
        >
          <h2 id="compose-preview" className="text-lg font-semibold">
            {v.preview}
          </h2>
          <div
            className="relative mx-auto max-h-[28rem] overflow-hidden rounded-2xl bg-muted"
            style={{
              aspectRatio: ASPECT[format],
              width: format === "9:16" ? "min(100%, 15.75rem)" : "100%",
              containerType: "inline-size",
            }}
          >
            {order[0] && (
              <img
                src={order[0].url}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            {captionsOn && sample && (
              <p
                aria-hidden
                className="absolute inset-x-[8%] text-center font-bold leading-tight text-white"
                style={{
                  fontSize: `${CAPTION_SIZE[size] * minSide}cqw`,
                  WebkitTextStroke: "0.09em black",
                  paintOrder: "stroke fill",
                  ...(position === "middle"
                    ? { top: "50%", transform: "translateY(-50%)" }
                    : { bottom: format === "9:16" ? "14%" : "8%" }),
                }}
              >
                {sample}
              </p>
            )}
          </div>
          {length !== undefined && order.length > 0 && (
            <p className="text-center text-sm text-muted-foreground" aria-live="polite">
              {v.summary(secs(length), secs(length / order.length))}
            </p>
          )}
        </section>

        <section
          aria-labelledby="compose-settings"
          className="glass glow-border space-y-4 rounded-3xl p-4 sm:p-6"
        >
          <h2 id="compose-settings" className="text-lg font-semibold">
            {v.settings}
          </h2>
          <div>
            <p id="compose-format" className="mb-2 text-sm font-medium">
              {v.format}
            </p>
            <div role="group" aria-labelledby="compose-format" className="flex flex-wrap gap-2">
              {FORMATS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={format === k}
                  onClick={() => setFormat(k)}
                  className={segment(format === k)}
                >
                  {v.formats[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={captionsOn}
                disabled={!canBurn || !audio?.subtitleUrl}
                onChange={(e) => setShowCaptions(e.target.checked)}
                className="h-5 w-5 accent-violet"
              />
              {v.captions}
            </label>
            {!canBurn ? (
              <p className="text-xs text-muted-foreground">{v.captionsUnsupported}</p>
            ) : (
              audio &&
              !audio.subtitleUrl && <p className="text-xs text-muted-foreground">{v.captionsOff}</p>
            )}
            {captionsOn && (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <div>
                  <p id="compose-position" className="mb-2 text-xs text-muted-foreground">
                    {v.position}
                  </p>
                  <div role="group" aria-labelledby="compose-position" className="flex gap-2">
                    {(["bottom", "middle"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={position === k}
                        onClick={() => setPosition(k)}
                        className={segment(position === k)}
                      >
                        {v.positions[k]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p id="compose-size" className="mb-2 text-xs text-muted-foreground">
                    {v.size}
                  </p>
                  <div role="group" aria-labelledby="compose-size" className="flex flex-wrap gap-2">
                    {(["s", "m", "l"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={size === k}
                        onClick={() => setSize(k)}
                        className={segment(size === k)}
                      >
                        {v.sizes[k]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={motion}
              onChange={(e) => setMotion(e.target.checked)}
              className="h-5 w-5 accent-violet"
            />
            {v.motion}
          </label>
          <div>
            <label htmlFor="compose-title" className="mb-1.5 block text-sm font-medium">
              {v.name}
            </label>
            <input
              id="compose-title"
              className={field}
              maxLength={GENERATION_TITLE_MAX}
              value={title}
              placeholder={audio?.title ?? ""}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        </section>

        {started ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-cyan/40 bg-cyan/10 p-4 text-sm"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0 text-cyan" aria-hidden />
            <p className="min-w-0 flex-1">{v.started}</p>
            <Link
              to="/labs"
              search={started.projectId ? { project: started.projectId } : {}}
              className="font-semibold text-cyan hover:underline"
            >
              {v.openStudio}
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className={`${btnPrimary} w-full`}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Clapperboard className="h-4 w-4" aria-hidden />
              )}
              {busy ? v.working : v.submit}
            </button>
            <p className="text-center text-sm text-muted-foreground">{t.editor.free}</p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

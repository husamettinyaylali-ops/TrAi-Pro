import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Film,
  FolderInput,
  ImageIcon,
  Loader2,
  Mic,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Scissors,
  Square,
  Subtitles,
  TextCursorInput,
  Trash2,
} from "lucide-react";

import { GenerationTitle, ProjectTag } from "@/components/labs/generation-ui";
import { Waveform } from "@/components/landing/fx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFormat, useI18n } from "@/lib/i18n";
import { gens } from "@/lib/samples";
import { useApp, useProjects, type Generation } from "@/lib/store";
import { speak, stockVoices, stopSpeaking, type Voice } from "@/lib/voices";

import { editorBlock } from "@/components/editor/utils";

import { regenerateInput, useActionError } from "./hooks";

const actBtn =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
const item = "min-h-11";
const icons = { tts: Mic, image: ImageIcon, video: Film };

/** Panoya kopyalar; Clipboard API yoksa ya da izin vermezse seçip kopyalama yoluna düşer. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/** İndir: tek dosya bağlantı; çok görsel ya da altyazılı ses menü; demo üretimde nedeniyle kapalı. */
function DownloadAction({ g }: { g: Generation }) {
  const { t } = useI18n();
  const files = g.audioUrl ? [g.audioUrl] : (g.fileUrls ?? []);
  if (g.audioUrl && g.subtitleUrl) {
    const links = [
      { href: `${g.audioUrl}?download=1`, label: t.studio.downloadAudio, Icon: Download },
      {
        href: `${g.subtitleUrl}?format=srt&download=1`,
        label: t.studio.downloadSrt,
        Icon: Subtitles,
      },
      {
        href: `${g.subtitleUrl}?format=vtt&download=1`,
        label: t.studio.downloadVtt,
        Icon: Subtitles,
      },
    ];
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className={`${actBtn} text-cyan`}>
          <Download className="h-4 w-4" aria-hidden />
          {t.studio.download}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {links.map(({ href, label, Icon }) => (
            <DropdownMenuItem key={href} asChild className={item}>
              <a href={href} download>
                <Icon /> {label}
              </a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  if (files.length === 0) {
    return (
      <button
        type="button"
        disabled
        aria-label={t.labs.downloadUnavailable}
        title={t.labs.downloadUnavailable}
        className={actBtn}
      >
        <Download className="h-4 w-4" aria-hidden />
        {t.studio.download}
      </button>
    );
  }
  if (files.length === 1) {
    return (
      <a href={`${files[0]}?download=1`} download className={`${actBtn} text-cyan`}>
        <Download className="h-4 w-4" aria-hidden />
        {t.studio.download}
      </a>
    );
  }
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={`${actBtn} text-cyan`}>
        <Download className="h-4 w-4" aria-hidden />
        {t.studio.download}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {files.map((url, i) => (
          <DropdownMenuItem key={url} asChild className={item}>
            <a href={`${url}?download=1`} download>
              <Download /> {t.studio.downloadImage(i + 1)}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Üretimin içeriği: ses oynatıcı, görsel ızgarası, video ya da bekleme durumu. */
function CardBody({ g, voice }: { g: Generation; voice: Voice | undefined }) {
  const { t } = useI18n();
  const f = useFormat();
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  useEffect(
    () => () => {
      if (playingRef.current) stopSpeaking();
    },
    [],
  );

  if (g.status === "pending") {
    const p = g.progress;
    const compose = g.edit === "compose";
    return (
      <div
        role="status"
        className="space-y-3 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground"
      >
        <p className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
          {g.type === "tts"
            ? p
              ? t.labs.tts.longProgress(f.num(p.done), f.num(p.total))
              : t.labs.tts.longPending
            : compose
              ? t.editor.video.progress(f.num(p?.done ?? 0))
              : t.labs.video.pending}
        </p>
        {p && (
          <progress
            value={p.done}
            max={p.total}
            aria-label={
              compose
                ? t.editor.video.progress(f.num(p.done))
                : t.labs.tts.longProgress(f.num(p.done), f.num(p.total))
            }
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted accent-violet [&::-moz-progress-bar]:bg-violet [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-violet"
          />
        )}
      </div>
    );
  }
  if (g.status === "failed") {
    return (
      <p className="rounded-2xl border border-destructive/40 p-4 text-sm text-destructive">
        {g.type === "tts"
          ? t.labs.tts.failedRefund(f.num(g.cost))
          : g.edit === "compose"
            ? t.editor.video.failed
            : t.labs.video.failedRefund(f.num(g.cost))}
      </p>
    );
  }
  if (g.type === "tts") {
    if (g.audioUrl) {
      return (
        <audio
          controls
          preload="none"
          src={g.audioUrl}
          className="w-full"
          aria-label={`${t.labs.tts.play}: ${g.title ?? g.text.slice(0, 60)}`}
        />
      );
    }
    // Demo: tarayıcının konuşma sentezi.
    const toggle = () => {
      if (playing) {
        stopSpeaking();
        playingRef.current = false;
        return setPlaying(false);
      }
      playingRef.current = true;
      setPlaying(true);
      speak(
        g.text,
        voice ?? stockVoices[0]!,
        () => {
          playingRef.current = false;
          setPlaying(false);
        },
        g.voiceSettings?.speed ?? 1,
      );
    };
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-2 pr-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? t.labs.tts.stop : t.labs.tts.play}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {playing ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1 overflow-hidden" aria-hidden>
          <Waveform playing={playing} bars={64} />
        </div>
      </div>
    );
  }
  if (g.type === "image") {
    const urls = g.fileUrls ?? (g.images ?? [0]).map((i) => gens[i]!);
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {urls.map((url, i) =>
          g.fileUrls ? (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img
                src={url}
                alt={g.title ?? g.text}
                loading="lazy"
                className="aspect-square w-full object-cover transition duration-500 hover:scale-105"
              />
            </a>
          ) : (
            <img
              key={i}
              src={url}
              alt={g.title ?? g.text}
              loading="lazy"
              className="aspect-square w-full rounded-xl object-cover"
            />
          ),
        )}
      </div>
    );
  }
  if (g.fileUrls?.[0]) {
    return (
      <video
        controls
        preload="metadata"
        src={g.fileUrls[0]}
        aria-label={g.title ?? g.text}
        className="aspect-video w-full max-w-xl rounded-2xl bg-muted"
      />
    );
  }
  return (
    <div className="relative aspect-video w-full max-w-xl overflow-hidden rounded-2xl">
      <img
        src={gens[g.images?.[0] ?? 0]}
        alt={g.title ?? g.text}
        loading="lazy"
        className="h-full w-full object-cover"
      />
      <span className="absolute inset-0 grid place-items-center bg-background/20" aria-hidden>
        <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-brand text-primary-foreground shadow-glow">
          <Play className="h-6 w-6" />
        </span>
      </span>
    </div>
  );
}

/**
 * Akıştaki tek üretim. Sık işlemler (indir, düzenle, yeniden üret, metni
 * kopyala, taşı) doğrudan görünür; yeniden adlandırma ve silme menüdedir.
 * Hazırlanan video için işlem gösterilmez.
 */
export function GenerationCard({
  g,
  voices,
  showProject,
  onEdit,
}: {
  g: Generation;
  voices: Voice[];
  showProject: boolean;
  onEdit: (g: Generation) => void;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const { generate, deleteGeneration, moveGeneration } = useApp();
  const projects = useProjects();
  const actionError = useActionError();
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Yeniden adlandırırken menü kapanınca odak ad alanında kalsın.
  const keepFocus = useRef(false);
  const Icon = icons[g.type];
  const voice = voices.find((v) => v.id === g.voiceId);
  const again = regenerateInput(g);
  // Özel ses ayarı: hız farklıysa hız, değilse "Özel ayar".
  const vs = g.voiceSettings;
  const tuned = vs
    ? vs.speed !== 1
      ? `${f.num(vs.speed)}x`
      : t.studio.voiceSettings.custom
    : null;
  const kind =
    g.type === "tts"
      ? [voice?.name ?? t.labs.tts.unknownVoice, tuned].filter(Boolean).join(" · ")
      : g.type === "image"
        ? t.studio.images(f.num(g.fileUrls?.length || g.images?.length || 1))
        : (t.labs.video.styles[Number(g.style)] ?? t.studio.tool.video);
  const meta = g.edit ? `${kind} · ${t.studio.editTag[g.edit]}` : kind;

  const regenerate = async () => {
    if (!again) return;
    setBusy(true);
    setError(null);
    const res = await generate(again);
    setBusy(false);
    if (!res.ok) setError(actionError(res, g.type));
  };

  const copy = async () => {
    setError(null);
    if (await copyText(g.text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      setError(t.labs.failed);
    }
  };

  const move = async (value: string) => {
    const target = value || null;
    if (target === (g.projectId ?? null)) return;
    const res = await moveGeneration(g.id, target);
    if (!res.ok) setError(t.projects.errors[res.error === "notFound" ? "notFound" : "failed"]);
  };

  return (
    <article className="glass rounded-3xl p-4" aria-label={g.title ?? g.text.slice(0, 80)}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-brand text-primary-foreground">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <GenerationTitle
            g={g}
            renaming={renaming}
            onDone={() => setRenaming(false)}
            onError={setError}
          />
          <p className="truncate text-xs text-muted-foreground">
            {meta} · {f.num(g.cost)} {t.labs.creditsShort}
          </p>
          {showProject && <ProjectTag id={g.projectId} />}
        </div>
        <time dateTime={g.createdAt} className="shrink-0 pt-0.5 text-xs text-muted-foreground">
          {f.time(g.createdAt)}
        </time>
      </div>

      <div className="mt-3">
        <CardBody g={g} voice={voice} />
      </div>

      {g.status !== "pending" && (
        <div className="mt-2 flex flex-wrap items-center gap-0.5">
          <DownloadAction g={g} />
          {g.type !== "video" &&
            g.status !== "failed" &&
            (editorBlock(g) ? (
              <button
                type="button"
                disabled
                aria-label={t.studio.editorUnavailable}
                title={t.studio.editorUnavailable}
                className={actBtn}
              >
                <Scissors className="h-4 w-4" aria-hidden />
                {t.studio.openEditor}
              </button>
            ) : (
              <Link to="/editor/$id" params={{ id: g.id }} className={actBtn}>
                <Scissors className="h-4 w-4" aria-hidden />
                {t.studio.openEditor}
              </Link>
            ))}
          {/* Sesten oluşturulan videonun istemi yok: metin seslendirmenindir. */}
          {g.edit !== "compose" && (
            <button type="button" onClick={() => onEdit(g)} className={actBtn}>
              <Pencil className="h-4 w-4" aria-hidden />
              {t.studio.editText[g.type]}
            </button>
          )}
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={busy || !again}
            title={t.studio.againHint(f.num(g.cost))}
            className={actBtn}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            {t.studio.again}
          </button>
          <button type="button" onClick={() => void copy()} className={actBtn}>
            {copied ? (
              <Check className="h-4 w-4 text-cyan" aria-hidden />
            ) : (
              <Copy className="h-4 w-4" aria-hidden />
            )}
            <span aria-live="polite">{copied ? t.studio.copied : t.studio.copy}</span>
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger className={actBtn}>
              <FolderInput className="h-4 w-4" aria-hidden />
              {t.studio.move}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
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
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger aria-label={t.studio.more} className={actBtn}>
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-52"
              onCloseAutoFocus={(e) => {
                if (keepFocus.current) e.preventDefault();
                keepFocus.current = false;
              }}
            >
              <DropdownMenuItem
                className={item}
                onSelect={() => {
                  keepFocus.current = true;
                  setError(null);
                  setRenaming(true);
                }}
              >
                <TextCursorInput /> {t.labs.rename}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={`${item} text-destructive focus:text-destructive`}
                onSelect={() => void deleteGeneration(g.id)}
              >
                <Trash2 /> {t.labs.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}

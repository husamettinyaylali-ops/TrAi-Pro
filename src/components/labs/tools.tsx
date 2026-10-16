import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  Coins,
  Download,
  Film,
  ImageIcon,
  Loader2,
  Lock,
  Mic,
  Play,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Waveform } from "@/components/landing/fx";
import { btnPrimary, field } from "@/components/site/shell";
import {
  MAX_CLONES,
  MAX_TTS_CHARS,
  balance,
  mediaCost,
  nextExpiry,
  ttsCost,
  type CreditKind,
  type MediaType,
} from "@/lib/credits";
import { useFormat, useI18n } from "@/lib/i18n";
import { gens } from "@/lib/samples";
import { clock } from "@/lib/clock";
import { useApp, type Generation } from "@/lib/store";
import { useStudioConfig } from "@/lib/studio-config";
import { canSpeak, speak, stockVoices, stopSpeaking, type Voice } from "@/lib/voices";

export const Panel = ({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) => <div className={`glass glow-border rounded-3xl p-6 ${className}`}>{children}</div>;

function Insufficient() {
  const { t } = useI18n();
  return (
    <p
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle className="h-4 w-4 shrink-0" />
      {t.labs.insufficient}
      <Link to="/pricing" className="font-semibold underline underline-offset-2">
        {t.labs.seePackages}
      </Link>
    </p>
  );
}

export function Balances() {
  const { t } = useI18n();
  const f = useFormat();
  const { data } = useApp();
  const now = clock();
  const card = (kind: CreditKind, label: string) => {
    const exp = nextExpiry(data.grants, kind, now);
    return (
      <Panel className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 font-display text-3xl font-bold">
            {f.num(balance(data.grants, kind, now))}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {exp ? t.labs.expires(f.date(exp)) : t.labs.noPackage}
          </p>
        </div>
        <Link
          to="/pricing"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold transition hover:border-cyan hover:text-cyan"
        >
          <Coins className="h-4 w-4" />
          {t.labs.buy}
        </Link>
      </Panel>
    );
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {card("voice", t.labs.voiceBalance)}
      {card("media", t.labs.mediaBalance)}
    </div>
  );
}

/**
 * Canlı kipte: sağlayıcının hazır sesleri ve kullanıcının canlı klonları.
 * Demo kipte: örnek sesler ve tüm klonlar. Yapılandırma yüklenirken liste boştur.
 */
function useVoices(): { voices: Voice[]; live: boolean; loading: boolean } {
  const { data } = useApp();
  const config = useStudioConfig();
  if (config.isPending) return { voices: [], live: false, loading: true };
  if (config.data?.tts === "live") {
    return {
      live: true,
      loading: false,
      voices: [
        ...data.clones
          .filter((c) => c.live)
          .map(
            (c) =>
              ({
                id: c.id,
                name: c.name,
                lang: "multi",
                gender: null,
                cloned: true,
              }) satisfies Voice,
          ),
        ...config.data.voices.map(
          (v) => ({ id: v.id, name: v.name, lang: "multi", gender: v.gender }) satisfies Voice,
        ),
      ],
    };
  }
  return {
    live: false,
    loading: false,
    voices: [
      ...data.clones.map(
        (c) =>
          ({ id: c.id, name: c.name, lang: "tr-TR", gender: null, cloned: true }) satisfies Voice,
      ),
      ...stockVoices,
    ],
  };
}

/** Sunucudan dönen hata sonucunu kullanıcı metnine çevirir. */
function useActionError() {
  const { t } = useI18n();
  return (res: { error: string; retryAfterMinutes?: number }) => {
    if (res.error === "tooManyAttempts" && res.retryAfterMinutes) {
      return t.auth.errors.tooManyAttempts(res.retryAfterMinutes);
    }
    if (res.error === "providerFailed") return t.labs.providerFailed;
    if (res.error === "network") return t.auth.errors.network;
    return t.labs.failed;
  };
}

export function TextToSpeech() {
  const { t } = useI18n();
  const f = useFormat();
  const { generate, deleteGeneration, data } = useApp();
  const { voices, live, loading } = useVoices();
  const actionError = useActionError();
  const [text, setText] = useState(t.labs.tts.sample);
  const [voiceId, setVoiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<
    { kind: "insufficient" } | { kind: "text"; text: string } | null
  >(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [speechOk, setSpeechOk] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setSpeechOk(canSpeak());
    return () => {
      stopSpeaking();
      audioRef.current?.pause();
    };
  }, []);

  // Seçili ses listede yoksa (ilk yükleme, kip değişimi) ilk sese geçilir.
  useEffect(() => {
    if (voices.length && !voices.some((v) => v.id === voiceId)) setVoiceId(voices[0]!.id);
  }, [voices, voiceId]);

  const cost = ttsCost(text);
  const voiceOf = (id?: string) => voices.find((v) => v.id === id);
  const history = data.generations.filter((g) => g.type === "tts");
  const serviceDown = live && !loading && voices.length === 0;

  /** Demo üretimi tarayıcının konuşma sentezi ile önizler. */
  const preview = (g: Generation) => {
    if (playing === g.id) {
      stopSpeaking();
      return setPlaying(null);
    }
    setPlaying(g.id);
    speak(g.text, voiceOf(g.voiceId) ?? stockVoices[0]!, () =>
      setPlaying((p) => (p === g.id ? null : p)),
    );
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (cost === 0) return setError({ kind: "text", text: t.labs.tts.emptyText });
    setError(null);
    setBusy(true);
    const res = await generate({ type: "tts", text: text.trim(), voiceId });
    setBusy(false);
    if (!res.ok) {
      return setError(
        res.error === "insufficient"
          ? { kind: "insufficient" }
          : { kind: "text", text: actionError(res) },
      );
    }
    if (res.generation.audioUrl) {
      audioRef.current?.pause();
      audioRef.current = new Audio(res.generation.audioUrl);
      // Otomatik oynatma tarayıcıca engellenirse kullanıcı geçmişten dinler.
      void audioRef.current.play().catch(() => undefined);
    } else {
      preview(res.generation);
    }
  };

  const label = (v: Voice) => {
    const kind = v.cloned
      ? t.labs.tts.cloned
      : v.gender === "male"
        ? t.labs.tts.male
        : v.gender === "female"
          ? t.labs.tts.female
          : null;
    const lang = v.lang === "multi" ? t.labs.tts.multilingual : v.lang;
    return [v.name, kind, lang].filter(Boolean).join(" · ");
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="tts-text" className="mb-1.5 block text-sm font-medium">
              {t.labs.tts.text}
            </label>
            <textarea
              id="tts-text"
              rows={8}
              maxLength={MAX_TTS_CHARS}
              placeholder={t.labs.tts.placeholder}
              className={`${field} resize-y`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
              <span>{t.labs.tts.chars(f.num([...text].length), f.num(MAX_TTS_CHARS))}</span>
              <span>{t.labs.cost(f.num(cost))}</span>
            </div>
          </div>
          <div>
            <label htmlFor="tts-voice" className="mb-1.5 block text-sm font-medium">
              {t.labs.tts.voice}
            </label>
            <select
              id="tts-voice"
              className={field}
              value={voiceId}
              disabled={loading || serviceDown}
              onChange={(e) => setVoiceId(e.target.value)}
            >
              {loading && <option value="">{t.loading}</option>}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {label(v)}
                </option>
              ))}
            </select>
          </div>
          {serviceDown && (
            <p role="alert" className="text-sm text-destructive">
              {t.labs.tts.serviceDown}
            </p>
          )}
          {error?.kind === "insufficient" && <Insufficient />}
          {error?.kind === "text" && (
            <p role="alert" className="text-sm text-destructive">
              {error.text}
            </p>
          )}
          {!live && !speechOk && (
            <p className="text-xs text-muted-foreground">{t.labs.tts.noSpeech}</p>
          )}
          <button
            type="submit"
            disabled={busy || loading || serviceDown || !voiceId}
            className={btnPrimary}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            {busy ? t.labs.tts.working : t.labs.tts.submit}
          </button>
          {!live && !loading && (
            <p className="text-xs text-muted-foreground">{t.labs.demoResult}</p>
          )}
        </form>
      </Panel>

      <Panel>
        <h3 className="mb-4 text-lg font-semibold">{t.labs.history}</h3>
        {history.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t.labs.tts.empty}</p>
        ) : (
          <ul className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
            {history.map((g) => (
              <li key={g.id} className="rounded-2xl bg-muted/50 p-3">
                <div className="flex items-center gap-3">
                  {!g.audioUrl && (
                    <button
                      onClick={() => preview(g)}
                      aria-label={playing === g.id ? t.labs.tts.stop : t.labs.tts.play}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-primary-foreground"
                    >
                      {playing === g.id ? (
                        <Square className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{g.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {voiceOf(g.voiceId)?.name ?? t.labs.tts.unknownVoice} ·{" "}
                      {f.dateTime(g.createdAt)} · {f.num(g.cost)} {t.labs.creditsShort}
                    </p>
                  </div>
                  {g.audioUrl && (
                    <a
                      href={`${g.audioUrl}?download=1`}
                      aria-label={t.labs.tts.download}
                      title={t.labs.tts.download}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:text-cyan"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  )}
                  <button
                    onClick={() => deleteGeneration(g.id)}
                    aria-label={t.labs.delete}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {g.audioUrl ? (
                  <audio
                    controls
                    preload="none"
                    src={g.audioUrl}
                    className="mt-2 w-full"
                    aria-label={`${t.labs.tts.play}: ${g.text.slice(0, 60)}`}
                  />
                ) : (
                  playing === g.id && (
                    <div className="mt-2 overflow-hidden">
                      <Waveform playing bars={40} />
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Klon için yüklenebilecek en büyük dosya (sunucudaki sınırla aynı). */
const MAX_CLONE_MB = 10;

export function VoiceClone() {
  const { t } = useI18n();
  const f = useFormat();
  const { data, addClone, uploadClone, deleteClone } = useApp();
  const config = useStudioConfig();
  const actionError = useActionError();
  const live = config.data?.cloning === true;
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const full = data.clones.length >= MAX_CLONES;
  const ready = name.trim() && file && consent && !full && !config.isPending;

  const reset = () => {
    setName("");
    setFile(null);
    setConsent(false);
  };

  /** Adımlar yükleme sürerken ilerler; son adım yanıt gelince tamamlanır. */
  const animate = () => {
    setStep(0);
    [1, 2].forEach((s) => timers.current.push(window.setTimeout(() => setStep(s), s * 1100)));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !file) return;
    setError(null);
    if (live) {
      if (file.size > MAX_CLONE_MB * 1024 * 1024)
        return setError(t.labs.clone.tooBig(MAX_CLONE_MB));
      animate();
      const form = new FormData();
      form.append("name", name.trim());
      form.append("consent", "true");
      form.append("file", file);
      const res = await uploadClone(form);
      timers.current.forEach(clearTimeout);
      if (!res.ok) {
        setStep(-1);
        return setError(res.error === "limit" ? t.labs.clone.limit(MAX_CLONES) : actionError(res));
      }
      setStep(3);
      return reset();
    }
    animate();
    timers.current.push(
      window.setTimeout(async () => {
        const res = await addClone(name);
        setStep(3);
        if (!res.ok) {
          return setError(res.error === "limit" ? t.labs.clone.limit(MAX_CLONES) : t.labs.failed);
        }
        reset();
      }, 3300),
    );
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Panel>
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="clone-name" className="mb-1.5 block text-sm font-medium">
              {t.labs.clone.name}
            </label>
            <input
              id="clone-name"
              className={field}
              placeholder={t.labs.clone.namePlaceholder}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <span className="mb-1.5 block text-sm font-medium">{t.labs.clone.file}</span>
            <label
              htmlFor="clone-file"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = e.dataTransfer.files[0];
                if (dropped) setFile(dropped);
              }}
              className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-violet/40 bg-violet/5 px-4 py-10 text-center transition hover:border-cyan hover:bg-cyan/5 focus-within:border-cyan"
            >
              <Upload className="mb-3 h-8 w-8 text-cyan" />
              <span className="font-medium">{file ? file.name : t.labs.clone.file}</span>
              <span className="mt-1 text-xs text-muted-foreground">{t.labs.clone.fileHint}</span>
              <input
                id="clone-file"
                type="file"
                accept="audio/mpeg,audio/wav,audio/x-wav,audio/*"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--violet)]"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span className="text-muted-foreground">{t.labs.clone.consent}</span>
          </label>
          {full && (
            <p role="alert" className="text-sm text-destructive">
              {t.labs.clone.limit(MAX_CLONES)}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button type="submit" disabled={!ready || (step >= 0 && step < 3)} className={btnPrimary}>
            <Sparkles className="h-4 w-4" />
            {t.labs.clone.submit}
          </button>
          <p className="text-xs text-muted-foreground">
            {live ? t.labs.clone.liveNote : `${t.labs.clone.free} ${t.labs.demoResult}`}
          </p>
        </form>
      </Panel>

      <Panel>
        <h3 className="mb-4 text-lg font-semibold">{t.labs.clone.mine}</h3>
        {data.clones.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t.labs.clone.none}</p>
        ) : (
          <ul className="space-y-2">
            {data.clones.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-muted/50 py-1 pl-4 pr-1 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <Mic className="h-4 w-4 shrink-0 text-cyan" aria-hidden />
                  <span className="truncate">{c.name}</span>
                  {live && !c.live && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {t.labs.clone.demoBadge}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">{f.date(c.createdAt)}</span>
                  <button
                    type="button"
                    onClick={() => deleteClone(c.id)}
                    aria-label={`${t.labs.clone.deleteClone}: ${c.name}`}
                    className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          {f.num(data.clones.length)} / {MAX_CLONES}
        </p>
      </Panel>

      {step >= 0 && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-md animate-in fade-in"
          role="dialog"
          aria-modal="true"
          aria-label={t.labs.tabs.clone}
        >
          <div className="glass glow-border w-full max-w-md rounded-3xl p-8">
            <div className="mb-6 flex items-center justify-between">
              <h4 className="text-lg font-semibold">{t.labs.tabs.clone}</h4>
              {step === 3 && (
                <button
                  onClick={() => setStep(-1)}
                  aria-label={t.close}
                  className="grid h-11 w-11 place-items-center"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
            <ol className="space-y-4">
              {t.labs.clone.steps.map((s, i) => (
                <li key={s} className="flex items-center gap-3">
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-full text-xs ${i < step || step === 3 ? "bg-gradient-brand text-primary-foreground" : i === step ? "border border-cyan text-cyan" : "border border-border text-muted-foreground"}`}
                  >
                    {i < step || step === 3 ? (
                      <Check className="h-4 w-4" />
                    ) : i === step ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className={i <= step ? "" : "text-muted-foreground"}>{s}</span>
                </li>
              ))}
            </ol>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-gradient-brand transition-all duration-700"
                style={{ width: `${((step + 1) / 4) * 100}%` }}
              />
            </div>
            {step === 3 && !error && (
              <div className="mt-6 text-center">
                <p className="mb-3 font-semibold text-gradient">{t.labs.clone.done}</p>
                <div className="flex justify-center overflow-hidden">
                  <Waveform playing bars={30} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Locked() {
  const { t } = useI18n();
  return (
    <Panel className="flex flex-col items-center gap-4 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
        <Lock className="h-6 w-6" />
      </span>
      <p className="max-w-md text-muted-foreground">{t.labs.locked}</p>
      <Link to="/pricing" hash="media-packages" className={btnPrimary}>
        {t.labs.seePackages}
      </Link>
    </Panel>
  );
}

/** Hazırlanan videoların kontrol aralığı. */
const VIDEO_POLL_MS = 8_000;

export function MediaStudio({ type }: { type: MediaType }) {
  const { t } = useI18n();
  const f = useFormat();
  const { data, generate, deleteGeneration, checkVideo } = useApp();
  const isVideo = type === "video";
  const copy = isVideo ? t.labs.video : t.labs.image;
  const [prompt, setPrompt] = useState(copy.placeholder);
  const [count, setCount] = useState(isVideo ? 1 : 2);
  const [style, setStyle] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<
    "insufficient" | "empty" | "failed" | "providerFailed" | "contentRejected" | "limit" | null
  >(null);
  const config = useStudioConfig();
  // FAL_KEY varsa görsel ve video gerçektir; yoksa örnek görseller.
  const live = config.data?.[isVideo ? "video" : "image"] === "live";

  const now = clock();
  const hasPass = balance(data.grants, "media", now) > 0;
  const cost = mediaCost(type, count);
  const history = data.generations.filter((g) => g.type === type);

  // Hazırlanan videolar sayfa açıkken düzenli kontrol edilir (bitince ya da iade olunca güncellenir).
  const pendingIds = history
    .filter((g) => g.status === "pending")
    .map((g) => g.id)
    .join(",");
  const check = useRef(checkVideo);
  useEffect(() => {
    check.current = checkVideo;
  });
  useEffect(() => {
    if (!pendingIds) return;
    const tick = () => {
      if (!document.hidden) for (const id of pendingIds.split(",")) void check.current(id);
    };
    tick();
    const timer = window.setInterval(tick, VIDEO_POLL_MS);
    return () => window.clearInterval(timer);
  }, [pendingIds]);

  if (!hasPass && history.length === 0) return <Locked />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return setError("empty");
    setError(null);
    setBusy(true);
    const text = prompt.trim();
    const res = await generate(
      isVideo ? { type: "video", text, styleIndex: style } : { type: "image", text, count },
    );
    setBusy(false);
    if (res.ok) return;
    setError(
      res.error === "insufficient" ||
        res.error === "providerFailed" ||
        res.error === "contentRejected" ||
        res.error === "limit"
        ? res.error
        : "failed",
    );
  };

  /** Video stili sunucuda sıra numarasıyla saklanır; ad seçili dile göre gösterilir. */
  const styleName = (s?: string) => (s === undefined ? undefined : t.labs.video.styles[Number(s)]);

  return (
    <div className="space-y-6">
      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div>
              <label htmlFor={`${type}-prompt`} className="mb-1.5 block text-sm font-medium">
                {copy.prompt}
              </label>
              <input
                id={`${type}-prompt`}
                className={field}
                value={prompt}
                maxLength={400}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            {!isVideo && (
              <div>
                <label htmlFor="image-count" className="mb-1.5 block text-sm font-medium">
                  {t.labs.image.count}
                </label>
                <select
                  id="image-count"
                  className={field}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  {[1, 2, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {isVideo && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">{t.labs.video.style}</legend>
              <div className="flex flex-wrap gap-2">
                {t.labs.video.styles.map((s, i) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => setStyle(i)}
                    aria-pressed={style === i}
                    className={`min-h-11 rounded-full border px-4 text-sm transition ${style === i ? "border-magenta bg-magenta/15 text-magenta" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {error === "insufficient" && <Insufficient />}
          {error === "empty" && (
            <p role="alert" className="text-sm text-destructive">
              {t.auth.errors.required}
            </p>
          )}
          {(error === "failed" ||
            error === "providerFailed" ||
            error === "contentRejected" ||
            error === "limit") && (
            <p role="alert" className="text-sm text-destructive">
              {
                {
                  failed: t.labs.failed,
                  providerFailed: t.labs.mediaFailed,
                  contentRejected: t.labs.contentRejected,
                  limit: t.labs.video.tooMany,
                }[error]
              }
            </p>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={busy || !hasPass} className={btnPrimary}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isVideo ? (
                <Film className="h-4 w-4" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
              {busy ? t.labs.working : copy.submit}
            </button>
            <span className="text-sm text-muted-foreground">{t.labs.cost(f.num(cost))}</span>
          </div>
          {!live && <p className="text-xs text-muted-foreground">{t.labs.demoResult}</p>}
        </form>
      </Panel>

      {!hasPass && <Locked />}

      <Panel>
        <h3 className="mb-4 text-lg font-semibold">{t.labs.history}</h3>
        {busy && (
          <div
            className={`mb-4 grid gap-3 ${isVideo ? "sm:grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}
          >
            {Array.from({ length: count }).map((_, i) => (
              <div
                key={i}
                className={`shimmer rounded-xl ${isVideo ? "aspect-video" : "aspect-square"}`}
              />
            ))}
          </div>
        )}
        {history.length === 0 && !busy ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{copy.empty}</p>
        ) : (
          <ul className="space-y-6">
            {history.map((g) => (
              <li key={g.id}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm">
                    <span className="font-medium">{g.text}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {styleName(g.style) ? `${styleName(g.style)} · ` : ""}
                      {f.dateTime(g.createdAt)} · {f.num(g.cost)} {t.labs.creditsShort}
                    </span>
                  </p>
                  {g.status !== "pending" && (
                    <button
                      onClick={() => deleteGeneration(g.id)}
                      aria-label={t.labs.delete}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div
                  className={`grid gap-3 ${isVideo ? "sm:grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}
                >
                  {g.status === "pending" && (
                    <p
                      role="status"
                      className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground"
                    >
                      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                      {t.labs.video.pending}
                    </p>
                  )}
                  {g.status === "failed" && (
                    <p className="flex aspect-video items-center justify-center rounded-xl border border-destructive/40 p-4 text-center text-sm text-destructive">
                      {t.labs.video.failedRefund(f.num(g.cost))}
                    </p>
                  )}
                  {isVideo &&
                    g.fileUrls?.map((url) => (
                      <div key={url}>
                        <video
                          controls
                          preload="metadata"
                          src={url}
                          aria-label={g.text}
                          className="aspect-video w-full rounded-xl bg-muted"
                        />
                        <a
                          href={`${url}?download=1`}
                          download
                          className="mt-1 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition hover:text-cyan"
                        >
                          <Download className="h-4 w-4" aria-hidden />
                          {t.labs.video.download}
                        </a>
                      </div>
                    ))}
                  {!isVideo &&
                    g.fileUrls?.map((url, i) => (
                      <div key={url} className="group relative overflow-hidden rounded-xl">
                        <img
                          src={url}
                          alt={g.text}
                          loading="lazy"
                          className="aspect-square h-full w-full object-cover animate-in fade-in zoom-in-95"
                        />
                        <a
                          href={`${url}?download=1`}
                          download
                          aria-label={`${t.labs.downloadImage} ${i + 1}`}
                          className="absolute bottom-2 right-2 grid h-11 w-11 place-items-center rounded-full bg-background/80 text-foreground opacity-90 transition hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Download className="h-4 w-4" aria-hidden />
                        </a>
                      </div>
                    ))}
                  {!g.fileUrls &&
                    !g.status &&
                    (g.images ?? [0]).map((idx, i) => (
                      <div
                        key={i}
                        className={`group relative overflow-hidden rounded-xl ${isVideo ? "aspect-video" : "aspect-square"}`}
                      >
                        <img
                          src={gens[idx]}
                          alt={g.text}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-700 group-hover:scale-110 animate-in fade-in zoom-in-95"
                        />
                        {isVideo && (
                          <span className="absolute inset-0 grid place-items-center bg-background/20">
                            <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-brand text-primary-foreground shadow-glow">
                              <Play className="h-6 w-6" />
                            </span>
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  AudioLines,
  Clapperboard,
  Copy,
  Film,
  ImageIcon,
  Loader2,
  Mic,
  Sparkles,
  UserRound,
} from "lucide-react";

import { EditBanner } from "@/components/labs/generation-ui";
import { clock } from "@/lib/clock";
import { IMAGE_COUNTS, MAX_TTS_CHARS, balance, mediaCost, ttsCost } from "@/lib/credits";
import { useFormat, useI18n } from "@/lib/i18n";
import { splitForSpeech } from "@/lib/speech-text";
import { useApp, type Generation } from "@/lib/store";
import { useStudioConfig } from "@/lib/studio-config";
import type { GenerateInput } from "@/lib/types";
import {
  DEFAULT_VOICE_SETTINGS,
  isDefaultVoiceSettings,
  normalizeVoiceSettings,
  type VoiceSettings,
} from "@/lib/voice-settings";
import { speak, stockVoices, stopSpeaking, type Voice } from "@/lib/voices";

import { TOOLS, useActionError, useVoices, type Tool } from "./hooks";
import { VoiceSettingsControl } from "./voice-settings";

/** Son kullanılan ses ayarları bu tarayıcıda hatırlanır (yalnız kolaylık). */
const SETTINGS_KEY = "trai.voice-settings";

function loadSettings(): VoiceSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw
      ? normalizeVoiceSettings(JSON.parse(raw) as Partial<VoiceSettings>)
      : DEFAULT_VOICE_SETTINGS;
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

const toolIcons = { tts: Mic, clone: AudioLines, image: ImageIcon, video: Film };
const MAX_PROMPT = 400;
const chip =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-3 text-sm focus-within:ring-2 focus-within:ring-ring";

/**
 * Stüdyonun alttaki yazma kutusu: araç seçimi, metin/istem, araca göre seçenek
 * (ses, adet, stil), maliyet ve gönder. Ctrl/Cmd + Enter gönderir. Düzeltmede
 * kaydın girdisi kutuya gelir; üretilen yeni sürüm eski kaydın projesinde ve
 * adıyla kalır.
 */
export function Composer({
  tool,
  onTool,
  projectId,
  editing,
  onCancelEdit,
  onBusy,
  focusSignal,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  projectId?: string | undefined;
  editing: Generation | null;
  onCancelEdit: () => void;
  onBusy: (type: Generation["type"] | null) => void;
  /** Değişince metin alanına odaklanılır (ör. boş akıştaki öneriden). */
  focusSignal: number;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const { data, generate } = useApp();
  const config = useStudioConfig();
  const { voices, live: ttsLive, loading } = useVoices();
  const actionError = useActionError();
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [count, setCount] = useState(2);
  const [style, setStyle] = useState(0);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; packages?: boolean } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      stopSpeaking();
      audioRef.current?.pause();
    },
    [],
  );

  useEffect(() => setSettings(loadSettings()), []);
  const changeSettings = (next: VoiceSettings) => {
    setSettings(next);
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Depolama kapalıysa ayar yalnız bu sayfada kalır.
    }
  };

  // Seçili ses listede yoksa (ilk yükleme, kip değişimi, silinen klon) ilk sese geçilir.
  useEffect(() => {
    if (voices.length && !voices.some((v) => v.id === voiceId)) setVoiceId(voices[0]!.id);
  }, [voices, voiceId]);

  // Düzeltme: kaydın metni ve ayarları kutuya gelir.
  useEffect(() => {
    if (!editing) return;
    setText(editing.text);
    if (editing.type === "tts") {
      if (editing.voiceId) setVoiceId(editing.voiceId);
      setSettings(normalizeVoiceSettings(editing.voiceSettings));
    }
    if (editing.type === "image") {
      const n = editing.fileUrls?.length || editing.images?.length;
      if (n && (IMAGE_COUNTS as readonly number[]).includes(n)) setCount(n);
    }
    if (editing.type === "video") setStyle(Number(editing.style ?? 0) || 0);
    setError(null);
    textRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (focusSignal) textRef.current?.focus();
  }, [focusSignal]);

  // Metin alanı içeriğe göre uzar (en fazla 15 satır kadar).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text, tool]);

  const media = tool === "image" || tool === "video";
  const hasPass = balance(data.grants, "media", clock()) > 0;
  const live = tool === "tts" ? ttsLive : media ? config.data?.[tool] === "live" : false;
  const serviceDown = tool === "tts" && ttsLive && !loading && voices.length === 0;
  const cost =
    tool === "tts"
      ? ttsCost(text)
      : tool === "image"
        ? mediaCost("image", count)
        : mediaCost("video", 1);

  const voiceLabel = (v: Voice) => {
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

  /** Üretilen sesi hemen dinletir; tarayıcı engellerse kullanıcı karttan dinler. */
  const play = (g: Generation) => {
    if (g.audioUrl) {
      audioRef.current?.pause();
      audioRef.current = new Audio(g.audioUrl);
      void audioRef.current.play().catch(() => undefined);
      return;
    }
    speak(
      g.text,
      voices.find((v) => v.id === g.voiceId) ?? stockVoices[0]!,
      () => undefined,
      g.voiceSettings?.speed ?? 1,
    );
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || tool === "clone") return;
    const clean = text.trim();
    if (!clean) {
      setError({ text: tool === "tts" ? t.labs.tts.emptyText : t.auth.errors.required });
      return textRef.current?.focus();
    }
    if (media && !hasPass) return setError({ text: t.studio.needsPass, packages: true });
    setError(null);
    setBusy(true);
    onBusy(tool);
    const meta = { projectId: editing ? editing.projectId : projectId, title: editing?.title };
    const input: GenerateInput =
      tool === "tts"
        ? {
            type: "tts",
            text: clean,
            voiceId,
            settings: isDefaultVoiceSettings(settings) ? undefined : settings,
            ...meta,
          }
        : tool === "image"
          ? { type: "image", text: clean, count, ...meta }
          : { type: "video", text: clean, styleIndex: style, ...meta };
    const res = await generate(input);
    setBusy(false);
    onBusy(null);
    if (!res.ok) {
      return setError({
        text: actionError(res, tool),
        packages: res.error === "insufficient",
      });
    }
    setText("");
    onCancelEdit();
    // Uzun metin arka planda seslendirilir; bitince kartta dinlenir.
    if (res.generation.type === "tts" && res.generation.status !== "pending") play(res.generation);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const costText = t.studio.credits(f.num(cost));
  // Tek istek sınırını aşan metin kaç parçada seslendirilecek (canlı kipte gösterilir).
  const parts = useMemo(() => (tool === "tts" ? splitForSpeech(text).length : 0), [tool, text]);

  return (
    <div className="px-4 pb-4 sm:px-6">
      <form
        onSubmit={(e) => void submit(e)}
        className="mx-auto max-w-4xl rounded-3xl border border-input bg-popover/90 shadow-glow backdrop-blur-xl"
      >
        {editing && (
          <div className="px-3 pt-3">
            <EditBanner g={editing} onCancel={onCancelEdit} />
          </div>
        )}
        {error && (
          <p role="alert" className="mx-4 mt-3 text-sm text-destructive">
            {error.text}{" "}
            {error.packages && (
              <Link to="/pricing" hash="media-packages" className="font-semibold underline">
                {t.labs.seePackages}
              </Link>
            )}
          </p>
        )}
        {tool === "clone" ? (
          <p className="px-4 pt-4 text-sm text-muted-foreground">{t.studio.cloneHint}</p>
        ) : (
          <>
            <label htmlFor="studio-input" className="sr-only">
              {t.studio.placeholder[tool]}
            </label>
            <textarea
              id="studio-input"
              ref={textRef}
              rows={2}
              maxLength={tool === "tts" ? MAX_TTS_CHARS : MAX_PROMPT}
              value={text}
              placeholder={t.studio.placeholder[tool]}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              className="block max-h-60 w-full resize-none bg-transparent px-4 pb-1 pt-4 text-sm outline-none placeholder:text-muted-foreground/70"
            />
            {tool === "tts" && (
              <div className="flex flex-wrap items-baseline justify-end gap-x-3 px-4 text-[11px] text-muted-foreground">
                {ttsLive && parts > 1 && (
                  <p className="mr-auto text-cyan">{t.studio.longNote(f.num(parts))}</p>
                )}
                <p>{t.studio.chars(f.num([...text].length), f.num(MAX_TTS_CHARS))}</p>
              </div>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 p-2.5">
          <div
            role="group"
            aria-label={t.studio.tools}
            className="inline-flex rounded-full bg-muted p-1"
          >
            {TOOLS.map((k) => {
              const I = toolIcons[k];
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={tool === k}
                  onClick={() => onTool(k)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tool === k ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <I className="h-4 w-4" aria-hidden />
                  {t.studio.tool[k]}
                </button>
              );
            })}
          </div>
          {tool === "tts" && (
            <label className={chip}>
              <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="sr-only">{t.labs.tts.voice}</span>
              <select
                value={voiceId}
                disabled={loading || serviceDown}
                onChange={(e) => setVoiceId(e.target.value)}
                className="max-w-[10rem] bg-transparent outline-none [&>option]:bg-popover"
              >
                {loading && <option value="">{t.loading}</option>}
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {voiceLabel(v)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tool === "tts" && (
            <VoiceSettingsControl value={settings} onChange={changeSettings} live={ttsLive} />
          )}
          {tool === "image" && (
            <label className={chip}>
              <Copy className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="sr-only">{t.labs.image.count}</span>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="bg-transparent outline-none [&>option]:bg-popover"
              >
                {IMAGE_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {t.studio.images(f.num(n))}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tool === "video" && (
            <label className={chip}>
              <Clapperboard className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="sr-only">{t.labs.video.style}</span>
              <select
                value={style}
                onChange={(e) => setStyle(Number(e.target.value))}
                className="bg-transparent outline-none [&>option]:bg-popover"
              >
                {t.labs.video.styles.map((s, i) => (
                  <option key={s} value={i}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tool !== "clone" && (
            <>
              <span className="ml-auto text-xs text-muted-foreground">{costText}</span>
              <button
                type="submit"
                disabled={busy || serviceDown || (tool === "tts" && !voiceId)}
                title={t.studio.sendHint}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-brand px-5 font-semibold text-primary-foreground shadow-glow transition hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden />
                )}
                {busy ? t.studio.working : t.studio.send[tool]}
              </button>
            </>
          )}
        </div>
        {tool !== "clone" &&
          (serviceDown || (!live && !config.isPending) || (media && !hasPass)) && (
            <p className="px-4 pb-3 text-xs text-muted-foreground">
              {serviceDown
                ? t.labs.tts.serviceDown
                : media && !hasPass
                  ? t.studio.needsPass
                  : t.labs.demoResult}
            </p>
          )}
      </form>
    </div>
  );
}

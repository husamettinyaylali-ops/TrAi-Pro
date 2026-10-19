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
  AudioWaveform,
  Captions,
  Clapperboard,
  Copy,
  Film,
  ImageIcon,
  Languages,
  Loader2,
  Mic,
  Repeat,
  Sparkles,
  Timer,
  UserRound,
} from "lucide-react";

import { EditBanner } from "@/components/labs/generation-ui";
import { clock } from "@/lib/clock";
import {
  IMAGE_COUNTS,
  MAX_TTS_CHARS,
  STT_LANGUAGES,
  balance,
  mediaCost,
  sfxCost,
  sttCost,
  ttsCost,
} from "@/lib/credits";
import { useFormat, useI18n } from "@/lib/i18n";
import { SFX_DURATIONS } from "@/lib/sound-effects";
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
import { TranscribePicker, type PickedRecording } from "./transcribe-picker";
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

const toolIcons = {
  tts: Mic,
  clone: AudioLines,
  stt: Captions,
  sfx: AudioWaveform,
  image: ImageIcon,
  video: Film,
};
const MAX_PROMPT = 400;
const chip =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-3 text-sm focus-within:ring-2 focus-within:ring-ring";

/** Yazma kutusu içeriğine göre uzar (en çok 240 px). */
function fitHeight(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
}

/**
 * Stüdyonun alttaki yazma kutusu: araç seçimi, metin/istem, araca göre seçenek
 * (ses, adet, stil), maliyet ve gönder. Ctrl/Cmd + Enter gönderir. Düzeltmede
 * kaydın girdisi kutuya gelir; üretilen yeni sürüm eski kaydın projesinde ve
 * adıyla kalır. Sesten yazıda metin yerine dosya seçilir.
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
  const { data, generate, transcribe } = useApp();
  const config = useStudioConfig();
  const { voices, live: ttsLive, loading } = useVoices();
  const actionError = useActionError();
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [count, setCount] = useState(2);
  const [style, setStyle] = useState(0);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [recording, setRecording] = useState<PickedRecording | null>(null);
  const [language, setLanguage] = useState("");
  const [sfxDuration, setSfxDuration] = useState<number | null>(null);
  const [sfxLoop, setSfxLoop] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
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
    if (editing.type === "sfx") {
      setSfxDuration(editing.effect?.duration ?? null);
      setSfxLoop(editing.effect?.loop ?? false);
    }
    setError(null);
    textRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (focusSignal) textRef.current?.focus();
  }, [focusSignal]);

  // Dar ekranda araç çubuğu yatay kayar: seçili araç görünür alana getirilir.
  useEffect(() => {
    const bar = toolsRef.current;
    const active = bar?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!bar || !active || bar.scrollWidth <= bar.clientWidth) return;
    bar.scrollLeft = Math.max(0, active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2);
  }, [tool]);

  // Metin alanı içeriğe göre uzar (en fazla 15 satır kadar).
  useLayoutEffect(() => {
    if (textRef.current) fitHeight(textRef.current);
  }, [text, tool]);
  // Genişlik değişince (ilk yerleşim, kenar çubuğu, pencere) yükseklik yeniden ölçülür;
  // yoksa dar ilk ölçümde boş kutu yüksek kalır.
  useEffect(() => {
    const el = textRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitHeight(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tool]);

  const media = tool === "image" || tool === "video";
  const hasPass = balance(data.grants, "media", clock()) > 0;
  const live =
    tool === "tts"
      ? ttsLive
      : tool === "stt"
        ? config.data?.stt === true
        : tool === "sfx"
          ? config.data?.sfx === true
          : media
            ? config.data?.[tool] === "live"
            : false;
  const serviceDown = tool === "tts" && ttsLive && !loading && voices.length === 0;
  const cost =
    tool === "tts"
      ? ttsCost(text)
      : tool === "stt"
        ? recording
          ? sttCost(recording.seconds)
          : 0
        : tool === "sfx"
          ? sfxCost(sfxDuration)
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

  /** Sesten yazı: seçilen kaydı yükler; kredi süreye göre düşer, iş arka planda sürer. */
  const submitRecording = async () => {
    if (!recording) return setError({ text: t.studio.stt.pick });
    setError(null);
    setBusy(true);
    onBusy("stt");
    const form = new FormData();
    // Büyük dosyanın yalnız sesi (WAV) gider; adı özgün dosyanınkidir.
    const { file, upload } = recording;
    form.append("file", upload, upload === file ? file.name : "kayit.wav");
    form.append("name", file.name);
    if (language) form.append("language", language);
    if (projectId) form.append("projectId", projectId);
    const res = await transcribe(form);
    setBusy(false);
    onBusy(null);
    if (!res.ok) {
      return setError({
        text: actionError(res, "stt"),
        packages: res.error === "insufficient",
      });
    }
    setRecording(null);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || tool === "clone") return;
    if (tool === "stt") return submitRecording();
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
        : tool === "sfx"
          ? { type: "sfx", text: clean, duration: sfxDuration, loop: sfxLoop, ...meta }
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
    // Uzun metin arka planda seslendirilir; bitince kartta dinlenir. Efekt hemen çalınır.
    const g = res.generation;
    if ((g.type === "tts" || g.type === "sfx") && g.status !== "pending") play(g);
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
              <Link
                to="/pricing"
                hash={media ? "media-packages" : "voice-packages"}
                className="font-semibold underline"
              >
                {t.labs.seePackages}
              </Link>
            )}
          </p>
        )}
        {tool === "clone" ? (
          <p className="px-4 pt-4 text-sm text-muted-foreground">{t.studio.cloneHint}</p>
        ) : tool === "stt" ? (
          <TranscribePicker value={recording} onChange={setRecording} disabled={busy} />
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
            ref={toolsRef}
            role="group"
            aria-label={t.studio.tools}
            className="relative flex max-w-full overflow-x-auto rounded-full bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {TOOLS.map((k) => {
              const I = toolIcons[k];
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={tool === k}
                  onClick={() => onTool(k)}
                  title={t.studio.tool[k]}
                  className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 sm:min-h-9 sm:min-w-9 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3 ${tool === k ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <I className="h-4 w-4" aria-hidden />
                  {/* Dar ekranda yalnız seçili aracın adı görünür; diğerleri simge (ad ekran okuyucuda). */}
                  <span className={tool === k ? "" : "sr-only sm:not-sr-only"}>
                    {t.studio.tool[k]}
                  </span>
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
          {tool === "stt" && (
            <label className={chip}>
              <Languages className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="sr-only">{t.studio.stt.language}</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="max-w-[10rem] bg-transparent outline-none [&>option]:bg-popover"
              >
                <option value="">{t.studio.stt.auto}</option>
                {STT_LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {f.language(code)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tool === "sfx" && (
            <>
              <label className={chip}>
                <Timer className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span className="sr-only">{t.studio.sfx.duration}</span>
                <select
                  value={sfxDuration ?? ""}
                  onChange={(e) => setSfxDuration(e.target.value ? Number(e.target.value) : null)}
                  className="bg-transparent outline-none [&>option]:bg-popover"
                >
                  {/* Düzenlenen kaydın listede olmayan süresi (ör. kırpılmış) de seçilebilir kalır. */}
                  {[
                    ...SFX_DURATIONS,
                    ...((SFX_DURATIONS as readonly (number | null)[]).includes(sfxDuration)
                      ? []
                      : [sfxDuration]),
                  ].map((d) => (
                    <option key={d ?? "auto"} value={d ?? ""}>
                      {d === null ? t.studio.sfx.auto : t.studio.sfx.seconds(f.num(d))}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${chip} cursor-pointer`} title={t.studio.sfx.loopHint}>
                <input
                  type="checkbox"
                  checked={sfxLoop}
                  onChange={(e) => setSfxLoop(e.target.checked)}
                  className="h-4 w-4 accent-violet"
                />
                <Repeat className="h-4 w-4 text-muted-foreground" aria-hidden />
                {t.studio.sfx.loop}
              </label>
            </>
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
              <span className="ml-auto text-xs text-muted-foreground">
                {tool === "stt" && !recording ? "" : costText}
              </span>
              <button
                type="submit"
                disabled={
                  busy ||
                  serviceDown ||
                  (tool === "tts" && !voiceId) ||
                  (tool === "stt" && (!recording || !live)) ||
                  (tool === "sfx" && !live)
                }
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
                : tool === "stt"
                  ? t.studio.stt.unavailable
                  : tool === "sfx"
                    ? t.studio.sfx.unavailable
                    : media && !hasPass
                      ? t.studio.needsPass
                      : t.labs.demoResult}
            </p>
          )}
      </form>
    </div>
  );
}

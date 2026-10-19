import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, RefreshCw, Save, Square, X } from "lucide-react";

import {
  ADJUST_FADE_SECONDS,
  ADJUST_GAIN_RANGE,
  ADJUST_SPEED_RANGE,
  ADJUST_SPEED_STEP,
  NO_ADJUST,
  gainFromDb,
  isNoAdjust,
  type AudioAdjust,
} from "@/lib/audio-adjust";
import { ttsCost } from "@/lib/credits";
import { useFormat, useI18n } from "@/lib/i18n";
import { useApp, type Generation } from "@/lib/store";
import { useStudioConfig } from "@/lib/studio-config";
import {
  isDefaultVoiceSettings,
  normalizeVoiceSettings,
  type VoiceSettings,
} from "@/lib/voice-settings";
import type { Voice } from "@/lib/voices";

import { useActionError } from "./hooks";
import { VoicePicker } from "./voice-picker";
import { VoiceSettingsFields } from "./voice-settings";

const btn =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm transition hover:border-cyan hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const primary =
  "inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-brand px-5 text-sm font-semibold text-primary-foreground transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60";

/**
 * Ayarın tarayıcıda önizlemesi: hız oynatma hızıyla (perde korunur), ses
 * düzeyi ve yumuşak geçiş Web Audio kazancıyla. Sunucudaki sonuçla aynı
 * duyulur; kaydetmeden önce denemek içindir.
 */
function useAdjustPreview(url: string | undefined) {
  const ref = useRef<{ audio: HTMLAudioElement; ctx: AudioContext | null } | null>(null);
  const [playing, setPlaying] = useState(false);

  const stop = useCallback(() => {
    const cur = ref.current;
    ref.current = null;
    cur?.audio.pause();
    void cur?.ctx?.close().catch(() => {});
    setPlaying(false);
  }, []);
  useEffect(() => stop, [stop]);

  const play = (a: AudioAdjust) => {
    stop();
    if (!url) return;
    const audio = new Audio(url);
    audio.preservesPitch = true;
    audio.playbackRate = a.speed;
    let ctx: AudioContext | null = null;
    const level = gainFromDb(a.gainDb);
    if (typeof AudioContext !== "undefined" && (a.gainDb > 0 || a.fade)) {
      ctx = new AudioContext();
      const gain = ctx.createGain();
      ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
      const now = ctx.currentTime;
      if (a.fade) {
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(level, now + ADJUST_FADE_SECONDS);
        const c = ctx;
        audio.addEventListener("loadedmetadata", () => {
          const at = c.currentTime + Math.max(0, audio.duration / a.speed - ADJUST_FADE_SECONDS);
          gain.gain.setValueAtTime(level, at);
          gain.gain.linearRampToValueAtTime(0, at + ADJUST_FADE_SECONDS);
        });
      } else {
        gain.gain.value = level;
      }
    } else {
      audio.volume = Math.min(1, level);
    }
    ref.current = { audio, ctx };
    setPlaying(true);
    audio.addEventListener("ended", () => {
      if (ref.current?.audio === audio) stop();
    });
    void audio.play()?.catch(() => {
      if (ref.current?.audio === audio) stop();
    });
  };

  return { playing, play, stop };
}

/**
 * Kartın "Ayarla" paneli. Ücretsiz kısım mevcut sesi yeniden seslendirmeden
 * işler (hız, ses düzeyi, yumuşak geçiş; yeni sürüm). Seslendirmede ayrıca
 * aynı metni başka ses ya da ayarlarla yeniden seslendirme (kredi harcar).
 */
export function AdjustPanel({
  g,
  voices,
  id,
  onClose,
}: {
  g: Generation;
  voices: Voice[];
  id: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const c = t.studio.adjustPanel;
  const f = useFormat();
  const { adjustAudio, generate } = useApp();
  const config = useStudioConfig();
  const actionError = useActionError();
  const preview = useAdjustPreview(g.audioUrl);
  const [adjust, setAdjust] = useState<AudioAdjust>(NO_ADJUST);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [freeError, setFreeError] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState(g.voiceId ?? voices[0]?.id ?? "");
  const [settings, setSettings] = useState<VoiceSettings>(() =>
    normalizeVoiceSettings(g.voiceSettings),
  );
  const [busy, setBusy] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const live = config.data?.tts === "live";
  const ffmpeg = config.data?.compose.available === true;
  const unchanged = isNoAdjust(adjust);
  const speedText = `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(adjust.speed)}x`;
  const gainText = c.gainValue(`${adjust.gainDb > 0 ? "+" : ""}${f.num(adjust.gainDb)}`);

  // Panel açılınca akışta görünür alana gelir (kart ekranın altındaysa).
  useEffect(() => {
    panelRef.current?.scrollIntoView?.({ block: "start" });
  }, []);

  // Seçili ses listede yoksa (silinmiş klon, kip değişimi) ilk sese geçilir.
  useEffect(() => {
    if (voices.length && !voices.some((v) => v.id === voiceId)) setVoiceId(voices[0]!.id);
  }, [voices, voiceId]);

  const change = (next: Partial<AudioAdjust>) => {
    preview.stop();
    setSaved(false);
    setFreeError(null);
    setAdjust((a) => ({ ...a, ...next }));
  };

  const save = async () => {
    preview.stop();
    setSaving(true);
    setFreeError(null);
    const res = await adjustAudio({ id: g.id, ...adjust });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setAdjust(NO_ADJUST);
      return;
    }
    setFreeError(
      res.error === "tooManyAttempts" && "retryAfterMinutes" in res
        ? t.auth.errors.tooManyAttempts(res.retryAfterMinutes)
        : res.error === "network"
          ? t.auth.errors.network
          : res.error === "unavailable"
            ? c.unavailable
            : res.error === "notFound"
              ? t.editor.errors.notFound
              : c.failed,
    );
  };

  const regenerate = async () => {
    setBusy(true);
    setRegenError(null);
    const res = await generate({
      type: "tts",
      text: g.text,
      voiceId,
      settings: isDefaultVoiceSettings(settings) ? undefined : settings,
      projectId: g.projectId,
      title: g.title,
    });
    setBusy(false);
    if (!res.ok) return setRegenError(actionError(res, "tts"));
    onClose();
  };

  return (
    <section
      ref={panelRef}
      id={id}
      aria-label={c.title}
      className="mt-3 space-y-4 rounded-2xl border border-border bg-background/40 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{c.title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={c.close}
          className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div role="group" aria-labelledby={`${id}-free`} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 id={`${id}-free`} className="text-sm font-semibold">
            {c.free}
          </h4>
          <span className="rounded-full bg-cyan/15 px-2 py-0.5 text-xs text-cyan">
            {c.freeBadge}
          </span>
        </div>
        {!g.audioUrl ? (
          <p className="text-sm text-muted-foreground">{c.demo}</p>
        ) : !ffmpeg && !config.isPending ? (
          <p className="text-sm text-muted-foreground">{c.unavailable}</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{c.freeHint}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <label htmlFor={`${id}-speed`} className="font-medium">
                    {c.speed}
                  </label>
                  <output htmlFor={`${id}-speed`} className="tabular-nums text-muted-foreground">
                    {speedText}
                  </output>
                </div>
                <input
                  id={`${id}-speed`}
                  type="range"
                  min={ADJUST_SPEED_RANGE[0]}
                  max={ADJUST_SPEED_RANGE[1]}
                  step={ADJUST_SPEED_STEP}
                  value={adjust.speed}
                  onChange={(e) => change({ speed: Number(Number(e.target.value).toFixed(2)) })}
                  className="mt-1 h-6 w-full accent-violet"
                />
              </div>
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <label htmlFor={`${id}-gain`} className="font-medium">
                    {c.gain}
                  </label>
                  <output htmlFor={`${id}-gain`} className="tabular-nums text-muted-foreground">
                    {gainText}
                  </output>
                </div>
                <input
                  id={`${id}-gain`}
                  type="range"
                  min={ADJUST_GAIN_RANGE[0]}
                  max={ADJUST_GAIN_RANGE[1]}
                  step={1}
                  value={adjust.gainDb}
                  onChange={(e) => change({ gainDb: Math.round(Number(e.target.value)) })}
                  className="mt-1 h-6 w-full accent-violet"
                />
              </div>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={adjust.fade}
                onChange={(e) => change({ fade: e.target.checked })}
                className="h-4 w-4 accent-violet"
              />
              {c.fade}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => (preview.playing ? preview.stop() : preview.play(adjust))}
                className={btn}
              >
                {preview.playing ? (
                  <Square className="h-4 w-4" aria-hidden />
                ) : (
                  <Play className="h-4 w-4" aria-hidden />
                )}
                {preview.playing ? c.stopPreview : c.preview}
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={unchanged || saving}
                className={btn}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-4 w-4" aria-hidden />
                )}
                {saving ? c.saving : c.save}
              </button>
            </div>
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {saved ? c.saved : unchanged ? c.unchanged : ""}
            </p>
            {freeError && (
              <p role="alert" className="text-sm text-destructive">
                {freeError}
              </p>
            )}
          </>
        )}
      </div>

      {g.type === "tts" && (
        <div
          role="group"
          aria-labelledby={`${id}-regen`}
          className="space-y-3 border-t border-border pt-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h4 id={`${id}-regen`} className="text-sm font-semibold">
              {c.regen}
            </h4>
            <span className="rounded-full bg-magenta/15 px-2 py-0.5 text-xs text-magenta">
              {c.regenBadge}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{c.regenHint}</p>
          <VoicePicker voices={voices} value={voiceId} onChange={setVoiceId} live={live} />
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <VoiceSettingsFields value={settings} onChange={setSettings} idPrefix={`${id}-voice`} />
          </div>
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={busy || !voiceId}
            className={primary}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            {busy ? c.working : c.regenSubmit(f.num(ttsCost(g.text)))}
          </button>
          {regenError && (
            <p role="alert" className="text-sm text-destructive">
              {regenError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { speak, stopSpeaking, type Voice } from "@/lib/voices";

/** Sesin künyesi: tür (klon, kadın, erkek) ve dil. */
export function useVoiceTags() {
  const { t } = useI18n();
  return (v: Voice) => {
    const kind = v.cloned
      ? t.labs.tts.cloned
      : v.gender === "male"
        ? t.labs.tts.male
        : v.gender === "female"
          ? t.labs.tts.female
          : null;
    const lang = v.lang === "multi" ? t.labs.tts.multilingual : v.lang;
    return [kind, lang].filter(Boolean).join(" · ");
  };
}

/**
 * Ses örneği oynatıcı: aynı anda tek örnek çalar. Gerçek kipte sunucudaki
 * örnek dosya (ilk dinlemede bir kez seslendirilir), demo kipte tarayıcı sesi.
 */
export function useVoicePreview(live: boolean) {
  const { t, lang } = useI18n();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<{ id: string; phase: "loading" | "playing" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    stopSpeaking();
    setState(null);
  }, []);
  useEffect(() => stop, [stop]);

  const toggle = (v: Voice) => {
    const same = state?.id === v.id;
    stop();
    setError(null);
    if (same) return;
    if (!live) {
      setState({ id: v.id, phase: "playing" });
      speak(t.studio.voicePicker.sample, v, () => setState((s) => (s?.id === v.id ? null : s)));
      return;
    }
    const a = new Audio(`/media/voice-preview/${encodeURIComponent(v.id)}?lang=${lang}`);
    audio.current = a;
    setState({ id: v.id, phase: "loading" });
    const fail = () => {
      if (audio.current !== a) return;
      audio.current = null;
      setState(null);
      setError(t.studio.voicePicker.failed);
    };
    a.addEventListener("playing", () => {
      if (audio.current === a) setState({ id: v.id, phase: "playing" });
    });
    a.addEventListener("ended", () => {
      if (audio.current !== a) return;
      audio.current = null;
      setState(null);
    });
    a.addEventListener("error", fail);
    // Durdurulan örneğin play() reddi hata sayılmaz (audio.current değişmiştir).
    void a.play()?.catch(fail);
  };

  return { state, error, toggle, stop };
}

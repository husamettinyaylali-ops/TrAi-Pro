import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import type { Generation } from "@/lib/types";

export const smallBtn =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm transition hover:border-cyan hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Düzenleyicide açılamayan kaydın nedeni; açılabilirse null. Gerçek dosyası
 * olan seslendirme, yazıya dökülen kayıt ve görsel düzenlenir (demo üretimde
 * dosya yok); video henüz yok.
 */
export function editorBlock(g: Generation): "pending" | "failed" | "demo" | "unsupported" | null {
  if (g.status === "pending") return "pending";
  if (g.status === "failed") return "failed";
  if (g.type === "video") return "unsupported";
  if (g.type === "tts" || g.type === "stt" ? !g.audioUrl : !g.fileUrls?.length) return "demo";
  return null;
}

/** Süre "dakika:saniye,onda" biçiminde (ör. 1:07,4). */
export function useClock() {
  const { locale } = useI18n();
  const sec = new Intl.NumberFormat(locale, {
    minimumIntegerDigits: 2,
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return (ms: number) => {
    const tenths = Math.floor(Math.max(0, ms) / 100);
    const m = Math.floor(tenths / 600);
    return `${m}:${sec.format((tenths - m * 600) / 10)}`;
  };
}

/** Saniye, bir ondalıkla (ör. 6,9). */
export function useSeconds() {
  const { locale } = useI18n();
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (ms: number) => nf.format(Math.floor(Math.max(0, ms) / 100) / 10);
}

/** Düzenleyici hatalarını kullanıcı metnine çevirir. */
export function useEditError() {
  const { t } = useI18n();
  return (res: { error: string; retryAfterMinutes?: number }) =>
    res.error === "tooManyAttempts" && res.retryAfterMinutes
      ? t.auth.errors.tooManyAttempts(res.retryAfterMinutes)
      : res.error === "network"
        ? t.auth.errors.network
        : res.error === "invalidInput"
          ? t.editor.errors.invalidInput
          : res.error === "notFound"
            ? t.editor.errors.notFound
            : t.editor.errors.failed;
}

/** Seslerin süreleri oynatıcı üst verisinden (yalnız süre için küçük bir istek); liste sabit (memo) verilmeli. */
export function useAudioDurations(items: Generation[]) {
  const [durations, setDurations] = useState<Record<string, number>>({});
  useEffect(() => {
    const players = items.flatMap((g) => {
      if (!g.audioUrl) return [];
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => {
        const ms = Math.round(a.duration * 1000);
        if (Number.isFinite(ms)) setDurations((d) => ({ ...d, [g.id]: ms }));
      };
      a.src = g.audioUrl;
      return [a];
    });
    return () => players.forEach((a) => a.removeAttribute("src"));
  }, [items]);
  return durations;
}

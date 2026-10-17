import { useI18n } from "@/lib/i18n";
import type { Generation } from "@/lib/types";

export const smallBtn =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm transition hover:border-cyan hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Düzenleyicide açılamayan kaydın nedeni; açılabilirse null. Yalnız gerçek
 * dosyası olan seslendirme düzenlenir (demo üretimde dosya yok).
 */
export function editorBlock(g: Generation): "pending" | "failed" | "demo" | "unsupported" | null {
  if (g.status === "pending") return "pending";
  if (g.status === "failed") return "failed";
  if (g.type !== "tts") return "unsupported";
  if (!g.audioUrl) return "demo";
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

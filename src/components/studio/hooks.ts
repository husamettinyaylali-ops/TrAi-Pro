import { useEffect, useRef } from "react";

import { clock } from "@/lib/clock";
import { IMAGE_COUNTS } from "@/lib/credits";
import { useI18n } from "@/lib/i18n";
import { useApp, type Generation } from "@/lib/store";
import { useStudioConfig } from "@/lib/studio-config";
import type { GenerateInput, GenerationType } from "@/lib/types";
import { stockVoices, type Voice } from "@/lib/voices";

/** Stüdyo araçları (yazma kutusundaki seçim; ?tab= ile aynı). */
export const TOOLS = ["tts", "clone", "image", "video"] as const;
export type Tool = (typeof TOOLS)[number];

/**
 * Canlı kipte: sağlayıcının hazır sesleri ve kullanıcının canlı klonları.
 * Demo kipte: örnek sesler ve tüm klonlar. Yapılandırma yüklenirken liste boştur.
 */
export function useVoices(): { voices: Voice[]; live: boolean; loading: boolean } {
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

/** Sunucudan dönen hata sonucunu kullanıcı metnine çevirir (sınır metni üretim türüne göre). */
export function useActionError() {
  const { t } = useI18n();
  return (res: { error: string; retryAfterMinutes?: number }, type?: GenerationType) => {
    if (res.error === "tooManyAttempts" && res.retryAfterMinutes) {
      return t.auth.errors.tooManyAttempts(res.retryAfterMinutes);
    }
    if (res.error === "insufficient") return t.labs.insufficient;
    if (res.error === "providerFailed") return t.labs.providerFailed;
    if (res.error === "contentRejected") return t.labs.contentRejected;
    if (res.error === "limit") return type === "tts" ? t.labs.tts.tooMany : t.labs.video.tooMany;
    if (res.error === "network") return t.auth.errors.network;
    return t.labs.failed;
  };
}

/** Hazırlanan videoların kontrol aralığı. */
export const VIDEO_POLL_MS = 8_000;
/** Arka planda seslendirilen uzun metnin kontrol aralığı (ilerleme gösterilir). */
export const SPEECH_POLL_MS = 3_000;

function usePolling(ids: string, ms: number) {
  const { checkGeneration } = useApp();
  const check = useRef(checkGeneration);
  useEffect(() => {
    check.current = checkGeneration;
  });
  useEffect(() => {
    if (!ids) return;
    const tick = () => {
      if (!document.hidden) for (const id of ids.split(",")) void check.current(id);
    };
    tick();
    const timer = window.setInterval(tick, ms);
    return () => window.clearInterval(timer);
  }, [ids, ms]);
}

/**
 * Hazırlanan videolar ve uzun seslendirmeler sayfa açıkken düzenli kontrol
 * edilir (bitince ya da iade olunca güncellenir).
 */
export function usePendingPolling(items: Generation[]) {
  // Sağlayıcıdaki video seyrek, bu sunucudaki işler (uzun seslendirme, kısa video) sık sorulur.
  const pending = (local: boolean) =>
    items
      .filter((g) => g.status === "pending" && (g.type === "tts" || g.edit === "compose") === local)
      .map((g) => g.id)
      .join(",");
  usePolling(pending(false), VIDEO_POLL_MS);
  usePolling(pending(true), SPEECH_POLL_MS);
}

/** Yerel takvim günü (akıştaki gün ayırıcıları için). */
export const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Gün ayırıcı etiketi: bugün, dün ya da tarih. */
export function useDayLabel() {
  const { t, locale } = useI18n();
  return (iso: string) => {
    const now = clock();
    const yesterday = new Date(now.getTime() - 86_400_000);
    if (dayKey(iso) === dayKey(now.toISOString())) return t.studio.today;
    if (dayKey(iso) === dayKey(yesterday.toISOString())) return t.studio.yesterday;
    return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(iso));
  };
}

/**
 * "Yeniden üret": kaydın girdisi aynı ayarlarla (ses, adet, stil) ve aynı
 * projede, aynı adla. Sesi bilinmeyen eski kayıt için null.
 */
export function regenerateInput(g: Generation): GenerateInput | null {
  // Birleştirilmiş ses ve sesten oluşturulan video tek bir istemden üretilmedi; yeniden üretilmez.
  if (g.edit === "merge" || g.edit === "compose") return null;
  const meta = { projectId: g.projectId, title: g.title };
  if (g.type === "tts") {
    return g.voiceId
      ? { type: "tts", text: g.text, voiceId: g.voiceId, settings: g.voiceSettings, ...meta }
      : null;
  }
  if (g.type === "image") {
    const n = g.fileUrls?.length || g.images?.length || 1;
    const count = (IMAGE_COUNTS as readonly number[]).includes(n) ? n : 1;
    return { type: "image", text: g.text, count, ...meta };
  }
  return { type: "video", text: g.text, styleIndex: Number(g.style ?? 0) || 0, ...meta };
}

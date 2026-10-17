import { resolveAppUrl } from "@/lib/app-url";

import { detectFfmpeg, ffmpegRunner } from "./compose.server";
import { getDb } from "./db.server";
import { getMailer } from "./email.server";
import { env, isProduction } from "./env.server";
import { fileStorage } from "./file-storage.server";
import { imageProvider } from "./image.server";
import {
  clonedProviderIds,
  type ImageDeps,
  type ReceiptContext,
  type SpeechDeps,
  type VideoDeps,
} from "./services.server";
import { sttProvider, type TranscribeDeps } from "./transcribe.server";
import { cachedVoices, publicVoices, ttsProvider, voiceAllowList } from "./tts.server";
import { videoProvider } from "./video.server";

/**
 * Ücretli servislerin bağımlılıkları; anahtar yoksa null (demo kip). Stüdyo
 * (src/api/functions.ts) ve geliştirici API'si (public-api.server.ts) aynı
 * yardımcıları kullanır.
 */

/** ElevenLabs bağlıysa gerçek seslendirme bağımlılıkları. */
export function speechDeps(): SpeechDeps | null {
  const tts = ttsProvider();
  if (!tts) return null;
  return {
    tts,
    storage: fileStorage(),
    catalog: async () =>
      publicVoices(
        await cachedVoices(tts),
        await clonedProviderIds(await getDb()),
        voiceAllowList(),
      ),
  };
}

/** ElevenLabs bağlı ve sunucuda ffmpeg varsa sesten yazıya bağımlılıkları. */
export async function transcribeDeps(): Promise<TranscribeDeps | null> {
  const stt = sttProvider();
  if (!stt || !(await detectFfmpeg())) return null;
  return { stt, storage: fileStorage(), run: ffmpegRunner() };
}

/** fal.ai bağlıysa gerçek görsel üretimi bağımlılıkları. */
export function imageDeps(): ImageDeps | null {
  const images = imageProvider();
  return images ? { images, storage: fileStorage() } : null;
}

/** fal.ai bağlıysa video bağımlılıkları; yayında (PUBLIC_URL varken) iş bitince /webhooks/fal'a haber verilir. */
export function videoDeps(): VideoDeps | null {
  const video = videoProvider();
  if (!video) return null;
  const base = env("PUBLIC_URL");
  return {
    video,
    storage: fileStorage(),
    webhookUrl: base ? `${base.replace(/\/$/, "")}/webhooks/fal` : null,
  };
}

/** Makbuz e-postası bağlamı; yayında PUBLIC_URL yoksa bağlantı kurulamaz ve null döner. */
export function receiptContext(requestUrl: string): ReceiptContext | null {
  const appUrl = resolveAppUrl(env("PUBLIC_URL"), requestUrl, isProduction());
  return appUrl ? { mailer: getMailer(), appUrl } : null;
}

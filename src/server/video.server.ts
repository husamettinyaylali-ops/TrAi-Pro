import { env } from "./env.server";

export const FAL_QUEUE = "https://queue.fal.run";
/** Kling 1.6 standart, metinden 5 saniyelik video; FAL_VIDEO_MODEL ile değiştirilebilir. */
export const DEFAULT_VIDEO_MODEL = "fal-ai/kling-video/v1.6/standard/text-to-video";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

/** Sağlayıcıdaki iş; durum ve sonuç adresleri gönderim yanıtından gelir. */
export interface VideoJob {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string | null;
}

export type VideoCheck =
  { state: "pending" } | { state: "done"; video: Uint8Array } | { state: "failed" };

/** Video üretim servisi; testlerde sahte uygulama verilir. */
export interface VideoProvider {
  submit(input: { prompt: string; webhookUrl: string | null }): Promise<VideoJob>;
  /** Geçici hatada (ağ, 5xx) hata fırlatır; iş beklemede kalır. */
  check(job: VideoJob): Promise<VideoCheck>;
  cancel(job: VideoJob): Promise<void>;
}

/** Stüdyodaki stil seçimleri (sıra numarasıyla saklanır) modele ipucu olarak eklenir. */
const STYLE_HINTS = [
  "cinematic film look, dramatic lighting, shallow depth of field",
  "anime style animation, vibrant colors",
  "3D animated render, soft global illumination",
  "documentary footage, natural light, handheld camera",
] as const;

export const VIDEO_STYLE_COUNT = STYLE_HINTS.length;

export function stylePrompt(text: string, styleIndex: number): string {
  const hint = STYLE_HINTS[styleIndex];
  return hint ? `${text}. Style: ${hint}.` : text;
}

const isQueueUrl = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith(`${FAL_QUEUE}/`);

/**
 * fal.ai kuyruk API'si: iş gönderilir, durum sorgulanır, tamamlanınca video
 * indirilir. Durum ve sonuç adresleri yalnız fal.ai kuyruk alan adından kabul
 * edilir. Hata gövdeleri loglanmaz (istem metnini yansıtabilir).
 */
export function falVideoProvider(
  cfg: { key: string; model: string },
  fetchImpl: typeof fetch = fetch,
): VideoProvider {
  const auth = { authorization: `Key ${cfg.key}` };

  async function download(url: unknown): Promise<Uint8Array> {
    if (typeof url !== "string" || !url.startsWith("https://")) {
      throw new Error("Video adresi geçersiz");
    }
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS * 3) });
    if (!res.ok) throw new Error(`Video indirilemedi (${res.status})`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_VIDEO_BYTES) throw new Error("Video çok büyük");
    const data = new Uint8Array(await res.arrayBuffer());
    if (!data.byteLength || data.byteLength > MAX_VIDEO_BYTES)
      throw new Error("Video boyutu geçersiz");
    return data;
  }

  return {
    async submit({ prompt, webhookUrl }) {
      const query = webhookUrl ? `?fal_webhook=${encodeURIComponent(webhookUrl)}` : "";
      const res = await fetchImpl(`${FAL_QUEUE}/${cfg.model}${query}`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ prompt, duration: "5", aspect_ratio: "16:9" }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`fal.ai video işi gönderilemedi (${res.status})`);
      const body = (await res.json()) as Record<string, unknown>;
      const requestId = body["request_id"];
      if (
        typeof requestId !== "string" ||
        !isQueueUrl(body["status_url"]) ||
        !isQueueUrl(body["response_url"])
      ) {
        throw new Error("fal.ai kuyruk yanıtı beklenmedik");
      }
      return {
        requestId,
        statusUrl: body["status_url"],
        responseUrl: body["response_url"],
        cancelUrl: isQueueUrl(body["cancel_url"]) ? body["cancel_url"] : null,
      };
    },

    async check(job) {
      const status = await fetchImpl(job.statusUrl, {
        headers: auth,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!status.ok) throw new Error(`fal.ai iş durumu alınamadı (${status.status})`);
      const s = (await status.json()) as { status?: string };
      if (s.status !== "COMPLETED") return { state: "pending" };

      const res = await fetchImpl(job.responseUrl, {
        headers: auth,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 4xx: iş başarısız (ör. içerik kuralı); 5xx: geçici, tekrar denenir.
      if (res.status >= 400 && res.status < 500) return { state: "failed" };
      if (!res.ok) throw new Error(`fal.ai sonucu alınamadı (${res.status})`);
      const body = (await res.json()) as { video?: { url?: unknown } };
      if (!body.video) return { state: "failed" };
      return { state: "done", video: await download(body.video.url) };
    },

    async cancel(job) {
      if (!job.cancelUrl) return;
      await fetchImpl(job.cancelUrl, {
        method: "PUT",
        headers: auth,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    },
  };
}

/** FAL_KEY yoksa video üretimi demo kipte kalır. */
export function videoProvider(): VideoProvider | null {
  const key = env("FAL_KEY");
  if (!key) return null;
  return falVideoProvider({ key, model: env("FAL_VIDEO_MODEL") ?? DEFAULT_VIDEO_MODEL });
}

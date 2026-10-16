import { env } from "./env.server";

export const FAL_RUN = "https://fal.run";
/** Hızlı ve ucuz varsayılan model; FAL_IMAGE_MODEL ile değiştirilebilir. */
export const DEFAULT_IMAGE_MODEL = "fal-ai/flux/schnell";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 90_000;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export interface GeneratedImage {
  data: Uint8Array;
  contentType: ImageType;
}

/** Sağlayıcının güvenlik filtresi isteği ya da tüm çıktıları reddetti; kredi düşülmez. */
export class ContentRejected extends Error {
  constructor() {
    super("İçerik güvenlik filtresine takıldı");
  }
}

/** Görsel üretim servisi; testlerde sahte uygulama verilir. */
export interface ImageProvider {
  /** Filtreye takılan görseller ayıklanır; hiçbiri kalmazsa ContentRejected fırlatır. */
  generate(input: { prompt: string; count: number }): Promise<GeneratedImage[]>;
}

const TYPES: Record<string, ImageType> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
};

export const extensionOf = (type: ImageType) =>
  type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";

/** "data:image/jpeg;base64,..." biçimindeki görseli çözer. */
export function decodeDataUri(uri: string): GeneratedImage | null {
  const m = /^data:([a-z/]+);base64,([A-Za-z0-9+/=]+)$/.exec(uri);
  const type = m && TYPES[m[1]!];
  if (!m || !type) return null;
  const data = new Uint8Array(Buffer.from(m[2]!, "base64"));
  if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) return null;
  return { data, contentType: type };
}

interface FalImage {
  url?: string;
  content_type?: string;
}

/**
 * fal.ai görsel modeli (varsayılan Flux schnell). Görseller sync_mode ile yanıtın
 * içinde gelir; yine de bağlantı dönerse yalnız https üzerinden ve boyut sınırıyla
 * indirilir. Hata gövdeleri loglanmaz (istem metnini yansıtabilir).
 */
export function falImageProvider(
  cfg: { key: string; model: string },
  fetchImpl: typeof fetch = fetch,
): ImageProvider {
  async function download(img: FalImage): Promise<GeneratedImage | null> {
    if (!img.url) return null;
    if (img.url.startsWith("data:")) return decodeDataUri(img.url);
    if (!img.url.startsWith("https://")) return null;
    const res = await fetchImpl(img.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Görsel indirilemedi (${res.status})`);
    const type = TYPES[(res.headers.get("content-type") ?? img.content_type ?? "").split(";")[0]!];
    if (!type) throw new Error("Beklenmeyen görsel türü");
    const data = new Uint8Array(await res.arrayBuffer());
    if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES)
      throw new Error("Görsel boyutu geçersiz");
    return { data, contentType: type };
  }

  return {
    async generate({ prompt, count }) {
      const res = await fetchImpl(`${FAL_RUN}/${cfg.model}`, {
        method: "POST",
        headers: { authorization: `Key ${cfg.key}`, "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          num_images: count,
          image_size: "square_hd",
          output_format: "jpeg",
          enable_safety_checker: true,
          sync_mode: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`fal.ai görsel üretimi başarısız (${res.status})`);
      const body = (await res.json()) as { images?: FalImage[]; has_nsfw_concepts?: boolean[] };
      const flagged = body.has_nsfw_concepts ?? [];
      const kept = (body.images ?? []).filter((_, i) => !flagged[i]);
      if (!kept.length) {
        if (flagged.some(Boolean)) throw new ContentRejected();
        throw new Error("fal.ai görsel döndürmedi");
      }
      const images = (await Promise.all(kept.map(download))).filter(
        (x): x is GeneratedImage => x !== null,
      );
      if (!images.length) throw new Error("fal.ai görselleri okunamadı");
      return images.slice(0, count);
    },
  };
}

/** FAL_KEY yoksa görsel üretimi demo kipte kalır. */
export function imageProvider(): ImageProvider | null {
  const key = env("FAL_KEY");
  if (!key) return null;
  return falImageProvider({ key, model: env("FAL_IMAGE_MODEL") ?? DEFAULT_IMAGE_MODEL });
}

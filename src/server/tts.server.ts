import type { VoiceSettings } from "@/lib/voice-settings";

import { env } from "./env.server";

export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const DEFAULT_TTS_MODEL = "eleven_multilingual_v2";

export interface ProviderVoice {
  id: string;
  name: string;
  gender: "female" | "male" | null;
  /** ElevenLabs kategorisi: "premade", "professional", "generated", "cloned" … */
  category: string;
}

export interface CloneFile {
  name: string;
  type: string;
  data: Uint8Array;
}

/** Ses üretim servisi. Testlerde sahte uygulama verilir. */
export interface TtsProvider {
  listVoices(): Promise<ProviderVoice[]>;
  /** MP3 döner. Ayar verilmezse sağlayıcının ses için kayıtlı ayarları kullanılır. */
  synthesize(voiceId: string, text: string, settings?: VoiceSettings): Promise<Uint8Array>;
  /** Sağlayıcıdaki yeni sesin kimliğini döner. */
  cloneVoice(input: { name: string; description: string; file: CloneFile }): Promise<string>;
  deleteVoice(voiceId: string): Promise<void>;
}

export class TtsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TtsError";
  }
}

export function elevenLabsProvider(opts: {
  apiKey: string;
  model?: string | undefined;
  fetchImpl?: typeof fetch;
}): TtsProvider {
  const f = opts.fetchImpl ?? fetch;
  const model = opts.model ?? DEFAULT_TTS_MODEL;
  const headers = { "xi-api-key": opts.apiKey };

  async function check(res: Response, what: string) {
    if (res.ok) return;
    // Yanıt gövdesi loglanmaz; sağlayıcı hata ayrıntısında girdi metnini yansıtabilir.
    throw new TtsError(`ElevenLabs ${what} başarısız (${res.status})`, res.status);
  }

  return {
    async listVoices() {
      const res = await f(`${ELEVENLABS_API}/v1/voices`, { headers });
      await check(res, "ses listesi");
      const body = (await res.json()) as {
        voices?: {
          voice_id: string;
          name: string;
          category?: string;
          labels?: { gender?: string };
        }[];
      };
      return (body.voices ?? []).map((v) => ({
        id: v.voice_id,
        name: v.name,
        gender:
          v.labels?.gender === "male" ? "male" : v.labels?.gender === "female" ? "female" : null,
        category: v.category ?? "unknown",
      }));
    },

    async synthesize(voiceId, text, settings) {
      const res = await f(
        `${ELEVENLABS_API}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", accept: "audio/mpeg" },
          body: JSON.stringify({
            text,
            model_id: model,
            ...(settings && {
              voice_settings: {
                stability: settings.stability,
                similarity_boost: settings.similarity,
                style: settings.style,
                speed: settings.speed,
                use_speaker_boost: true,
              },
            }),
          }),
        },
      );
      await check(res, "seslendirme");
      return new Uint8Array(await res.arrayBuffer());
    },

    async cloneVoice({ name, description, file }) {
      const form = new FormData();
      form.append("name", name);
      form.append("description", description);
      form.append("remove_background_noise", "true");
      // Kopya: Blob, SharedArrayBuffer'a bağlı olabilecek bir görünümü kabul etmez.
      form.append("files", new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
      const res = await f(`${ELEVENLABS_API}/v1/voices/add`, {
        method: "POST",
        headers,
        body: form,
      });
      await check(res, "ses klonlama");
      const body = (await res.json()) as { voice_id?: unknown };
      if (typeof body.voice_id !== "string") throw new TtsError("ElevenLabs voice_id dönmedi", 502);
      return body.voice_id;
    },

    async deleteVoice(voiceId) {
      const res = await f(`${ELEVENLABS_API}/v1/voices/${encodeURIComponent(voiceId)}`, {
        method: "DELETE",
        headers,
      });
      // Zaten silinmişse sorun değil.
      if (res.status !== 404) await check(res, "ses silme");
    },
  };
}

/** ELEVENLABS_API_KEY yoksa null: Stüdyo demo modunda çalışır. */
export function ttsProvider(): TtsProvider | null {
  const apiKey = env("ELEVENLABS_API_KEY");
  return apiKey ? elevenLabsProvider({ apiKey, model: env("ELEVENLABS_MODEL") }) : null;
}

/**
 * Herkese sunulacak hazır sesler. Hesaptaki kullanıcı klonları ("cloned") ve
 * veritabanındaki klon kimlikleri ayıklanır; ELEVENLABS_VOICE_IDS verilmişse
 * yalnız o sesler listelenir.
 */
export function publicVoices(
  all: ProviderVoice[],
  clonedIds: Set<string>,
  allowList: string[] | null,
): ProviderVoice[] {
  return all.filter(
    (v) =>
      v.category !== "cloned" &&
      !clonedIds.has(v.id) &&
      (allowList === null || allowList.includes(v.id)),
  );
}

export function voiceAllowList(): string[] | null {
  const raw = env("ELEVENLABS_VOICE_IDS");
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? ids : null;
}

let cache: { at: number; voices: ProviderVoice[] } | null = null;
const CACHE_MS = 10 * 60_000;

/** Sağlayıcının ses listesi 10 dakika önbellekte tutulur. */
export async function cachedVoices(
  provider: TtsProvider,
  now = Date.now(),
): Promise<ProviderVoice[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.voices;
  const voices = await provider.listVoices();
  cache = { at: now, voices };
  return voices;
}

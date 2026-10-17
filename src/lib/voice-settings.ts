/**
 * Seslendirme ayarları (ElevenLabs voice_settings karşılıkları):
 * hız 0,7–1,2; kararlılık, benzerlik ve stil 0–1. Kredi maliyetini etkilemez.
 */
export interface VoiceSettings {
  speed: number;
  stability: number;
  /** ElevenLabs'te similarity_boost. */
  similarity: number;
  style: number;
}

export type VoiceSettingKey = keyof VoiceSettings;

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  speed: 1,
  stability: 0.5,
  similarity: 0.75,
  style: 0,
};

export const VOICE_SETTING_RANGES: Record<VoiceSettingKey, readonly [number, number]> = {
  speed: [0.7, 1.2],
  stability: [0, 1],
  similarity: [0, 1],
  style: [0, 1],
};

export const VOICE_SETTING_STEP = 0.05;

const KEYS = Object.keys(DEFAULT_VOICE_SETTINGS) as VoiceSettingKey[];

/** Aralık dışındaki değer kırpılır, 0,05 adımına yuvarlanır; verilmeyen değer varsayılandır. */
export function normalizeVoiceSettings(
  raw: { [K in VoiceSettingKey]?: number | undefined } | null | undefined,
): VoiceSettings {
  const out = { ...DEFAULT_VOICE_SETTINGS };
  for (const k of KEYS) {
    const v = raw?.[k];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const [min, max] = VOICE_SETTING_RANGES[k];
    const stepped = Math.round(v / VOICE_SETTING_STEP) * VOICE_SETTING_STEP;
    out[k] = Number(Math.min(max, Math.max(min, stepped)).toFixed(2));
  }
  return out;
}

export const isDefaultVoiceSettings = (s: VoiceSettings) =>
  KEYS.every((k) => s[k] === DEFAULT_VOICE_SETTINGS[k]);

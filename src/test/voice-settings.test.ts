import { describe, expect, it } from "vitest";

import { regenerateInput } from "@/components/studio/hooks";
import {
  DEFAULT_VOICE_SETTINGS,
  isDefaultVoiceSettings,
  normalizeVoiceSettings,
} from "@/lib/voice-settings";

describe("ses ayarları", () => {
  it("aralığa kırpılır, 0,05 adımına yuvarlanır; eksik ya da bozuk değer varsayılandır", () => {
    expect(normalizeVoiceSettings({ speed: 0.2, stability: 1.7, similarity: 0.512 })).toEqual({
      speed: 0.7,
      stability: 1,
      similarity: 0.5,
      style: 0,
    });
    expect(normalizeVoiceSettings({ speed: Number.NaN })).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(normalizeVoiceSettings(undefined)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(isDefaultVoiceSettings(normalizeVoiceSettings({ speed: 1.02 }))).toBe(true);
    expect(isDefaultVoiceSettings(normalizeVoiceSettings({ speed: 1.05 }))).toBe(false);
  });

  it("yeniden üretim kaydın ayarlarını kullanır", () => {
    const voiceSettings = { speed: 1.1, stability: 0.4, similarity: 0.75, style: 0 };
    expect(
      regenerateInput({
        id: "g",
        type: "tts",
        text: "Merhaba",
        voiceId: "defne",
        voiceSettings,
        cost: 7,
        createdAt: "2026-10-17T09:00:00Z",
      }),
    ).toMatchObject({ type: "tts", settings: voiceSettings });
  });
});

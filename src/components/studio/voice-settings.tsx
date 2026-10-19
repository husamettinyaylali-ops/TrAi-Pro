import { SlidersHorizontal } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";
import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_SETTING_RANGES,
  VOICE_SETTING_STEP,
  isDefaultVoiceSettings,
  type VoiceSettingKey,
  type VoiceSettings,
} from "@/lib/voice-settings";

const KEYS: VoiceSettingKey[] = ["speed", "stability", "similarity", "style"];

/** Ayar değerinin gösterimi: hız "1,10x", diğerleri yüzde. */
function useSettingFormat() {
  const { locale } = useI18n();
  return (k: VoiceSettingKey, v: number) =>
    k === "speed"
      ? `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}x`
      : new Intl.NumberFormat(locale, { style: "percent" }).format(v);
}

/**
 * Hız, kararlılık, benzerlik ve stil kaydırıcıları. Aynı sayfada birden çok
 * kez kullanılabilsin diye alan kimlikleri `idPrefix` ile ayrılır.
 */
export function VoiceSettingsFields({
  value,
  onChange,
  idPrefix = "voice",
}: {
  value: VoiceSettings;
  onChange: (next: VoiceSettings) => void;
  idPrefix?: string;
}) {
  const { t } = useI18n();
  const c = t.studio.voiceSettings;
  const format = useSettingFormat();
  const labels = {
    speed: [c.speed, c.speedHint],
    stability: [c.stability, c.stabilityHint],
    similarity: [c.similarity, c.similarityHint],
    style: [c.style, c.styleHint],
  } as const;
  return (
    <>
      {KEYS.map((k) => {
        const [min, max] = VOICE_SETTING_RANGES[k];
        const [label, hint] = labels[k];
        const id = `${idPrefix}-${k}`;
        return (
          <div key={k}>
            <div className="flex items-baseline justify-between text-sm">
              <label htmlFor={id} className="font-medium">
                {label}
              </label>
              <output htmlFor={id} className="tabular-nums text-muted-foreground">
                {format(k, value[k])}
              </output>
            </div>
            <input
              id={id}
              type="range"
              min={min}
              max={max}
              step={VOICE_SETTING_STEP}
              value={value[k]}
              aria-describedby={`${id}-hint`}
              onChange={(e) =>
                onChange({ ...value, [k]: Number(Number(e.target.value).toFixed(2)) })
              }
              className="mt-1 h-6 w-full accent-violet"
            />
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              {hint}
            </p>
          </div>
        );
      })}
    </>
  );
}

/**
 * Yazma kutusundaki "Ses ayarları": hız, kararlılık, benzerlik ve stil
 * kaydırıcıları. Varsayılandan farklıysa düğmede işaret görünür.
 */
export function VoiceSettingsControl({
  value,
  onChange,
  live,
}: {
  value: VoiceSettings;
  onChange: (next: VoiceSettings) => void;
  /** Gerçek servis bağlı değilse yalnız hızın uygulandığı söylenir. */
  live: boolean;
}) {
  const { t } = useI18n();
  const c = t.studio.voiceSettings;
  const format = useSettingFormat();
  const custom = !isDefaultVoiceSettings(value);

  return (
    <Popover>
      <PopoverTrigger
        aria-label={custom ? `${c.open} (${c.custom})` : c.open}
        className="relative inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-3 text-sm transition hover:border-cyan hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="hidden sm:inline">{custom ? format("speed", value.speed) : c.open}</span>
        {custom && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-cyan" aria-hidden />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 space-y-4">
        <p className="font-semibold">{c.open}</p>
        <VoiceSettingsFields value={value} onChange={onChange} />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          {!live && <p className="text-xs text-muted-foreground">{c.demoNote}</p>}
          <button
            type="button"
            disabled={!custom}
            onClick={() => onChange(DEFAULT_VOICE_SETTINGS)}
            className="ml-auto inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-cyan hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            {c.reset}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

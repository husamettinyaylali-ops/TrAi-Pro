import { useState } from "react";
import { Check, ChevronDown, Loader2, Play, Search, Square, UserRound } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";
import type { Voice } from "@/lib/voices";

import { useVoicePreview, useVoiceTags } from "./voice-preview";

type Filter = "all" | "female" | "male" | "clones";
const FILTERS: Filter[] = ["all", "female", "male", "clones"];

const matches = (v: Voice, f: Filter) =>
  f === "all" ||
  (f === "clones"
    ? Boolean(v.cloned)
    : !v.cloned && v.gender === (f === "female" ? "female" : "male"));

/**
 * Seslendiren seçici: ses listesi (arama ve tür süzgeci), her seste dinle
 * düğmesi. Ses seçilince liste kapanır, çalan örnek durur.
 */
export function VoicePicker({
  voices,
  value,
  onChange,
  live,
  loading,
  disabled,
}: {
  voices: Voice[];
  value: string;
  onChange: (id: string) => void;
  /** Gerçek ses servisi bağlı mı (örnek sunucudan mı, tarayıcıdan mı). */
  live: boolean;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const c = t.studio.voicePicker;
  const tags = useVoiceTags();
  const preview = useVoicePreview(live);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const current = voices.find((v) => v.id === value);
  const fold = (s: string) => s.toLocaleLowerCase(locale);
  const filters = FILTERS.filter((f) => f === "all" || voices.some((v) => matches(v, f)));
  const shown = voices.filter(
    (v) => matches(v, filter) && fold(v.name).includes(fold(query.trim())),
  );
  const label = current ? [current.name, tags(current)].filter(Boolean).join(" · ") : "";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) preview.stop();
      }}
    >
      <PopoverTrigger
        disabled={disabled || loading || !voices.length}
        aria-label={c.choose(label)}
        title={label}
        className="inline-flex min-h-11 max-w-[14rem] items-center gap-2 rounded-full border border-border px-3 text-sm transition hover:border-cyan hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{loading ? t.loading : (current?.name ?? "—")}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 space-y-2 p-2">
        {voices.length > 6 && (
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="sr-only">{c.search}</span>
            <input
              type="search"
              value={query}
              placeholder={c.search}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
          </label>
        )}
        {filters.length > 2 && (
          <div role="group" aria-label={c.filters} className="flex flex-wrap gap-1">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`min-h-9 rounded-full border px-3 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === f ? "border-cyan bg-cyan/15 text-cyan" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {c[f]}
              </button>
            ))}
          </div>
        )}
        <div role="radiogroup" aria-label={c.list} className="max-h-72 space-y-0.5 overflow-y-auto">
          {shown.map((v) => {
            const selected = v.id === value;
            const playing = preview.state?.id === v.id;
            return (
              <div
                key={v.id}
                className={`flex items-center gap-1 rounded-xl pr-1 ${selected ? "bg-cyan/10" : "hover:bg-foreground/5"}`}
              >
                <button
                  type="button"
                  onClick={() => preview.toggle(v)}
                  aria-label={playing ? c.stop(v.name) : c.listen(v.name)}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {playing && preview.state?.phase === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : playing ? (
                    <Square className="h-4 w-4 text-cyan" aria-hidden />
                  ) : (
                    <Play className="h-4 w-4" aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    onChange(v.id);
                    preview.stop();
                    setOpen(false);
                  }}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{v.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        tags(v),
                        playing
                          ? preview.state?.phase === "loading"
                            ? c.loading
                            : c.playing
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-cyan" aria-hidden />}
                </button>
              </div>
            );
          })}
          {!shown.length && <p className="px-2 py-3 text-sm text-muted-foreground">{c.empty}</p>}
        </div>
        {preview.error && (
          <p role="alert" className="px-1 text-xs text-destructive">
            {preview.error}
          </p>
        )}
        <p className="px-1 text-xs text-muted-foreground">{live ? c.note : c.demoNote}</p>
      </PopoverContent>
    </Popover>
  );
}

import { useRef, useState, type DragEvent } from "react";
import { FileAudio, Loader2, Upload } from "lucide-react";

import { useClock } from "@/components/editor/utils";
import { PrepareFailure, prepareUpload, type PreparedUpload } from "@/lib/audio-upload";
import { useFormat, useI18n } from "@/lib/i18n";

/** Seçilen dosya ve tarayıcıda hazırlanan yüklemesi. */
export interface PickedRecording extends PreparedUpload {
  file: File;
}

/**
 * Sesten yazıya: ses ya da video dosyası seçilir (düğme ya da sürükle-bırak),
 * tarayıcıda sesi çözülüp süresi ölçülür. Hazır olunca `onChange` çağrılır;
 * dosya okunamazsa nedeni gösterilir.
 */
export function TranscribePicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedRecording | null;
  onChange: (next: PickedRecording | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const s = t.studio.stt;
  const f = useFormat();
  const clock = useClock();
  const input = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // Hızlı art arda seçimde yalnız son dosyanın sonucu kullanılır.
  const latest = useRef(0);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const run = ++latest.current;
    setError(null);
    setPreparing(true);
    onChange(null);
    try {
      const prepared = await prepareUpload(file);
      if (run === latest.current) onChange({ ...prepared, file });
    } catch (err) {
      if (run !== latest.current) return;
      setError(err instanceof PrepareFailure ? s.errors[err.code] : s.errors.unreadable);
    } finally {
      if (run === latest.current) setPreparing(false);
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) void pick(e.dataTransfer.files[0]);
  };

  return (
    <div className="px-3 pt-3">
      <input
        ref={input}
        id="stt-file"
        type="file"
        accept="audio/*,video/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {value && !preparing ? (
        <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3">
          <FileAudio className="h-5 w-5 shrink-0 text-cyan" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{value.file.name}</p>
            <p className="text-xs text-muted-foreground">
              {s.ready(clock(value.seconds * 1000), f.bytes(value.file.size))}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => input.current?.click()}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-cyan transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {s.change}
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={`rounded-2xl border border-dashed p-4 text-center transition ${over ? "border-cyan bg-cyan/10" : "border-border"}`}
        >
          {preparing ? (
            <p role="status" className="flex min-h-11 items-center justify-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {s.preparing}
            </p>
          ) : (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={() => input.current?.click()}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:border-cyan hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Upload className="h-4 w-4" aria-hidden />
                {s.pick}
              </button>
              <span className="ml-2 hidden text-sm text-muted-foreground sm:inline">{s.drop}</span>
            </>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {s.formats} {s.cost}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 px-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

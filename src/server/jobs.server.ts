/**
 * Bu süreçte arka planda çalışan işler: video oluşturma (ffmpeg) ve yazıya
 * dökme. Listede olmayan bekleyen kayıt yarım kalmıştır (sunucu yeniden
 * başladı) ve başarısız sayılır. Geliştirmede modül yeniden yüklense de
 * kaybolmasın diye global nesnede durur. Bağımlılığı yoktur: hem services hem
 * editor okur.
 */
export interface ComposeJob {
  /** 0–100. */
  percent: number;
  /** ffmpeg'i durdurur (üretim silindi). */
  cancel: () => void;
  cancelled: boolean;
}

export const composeJobs: Map<string, ComposeJob> = ((
  globalThis as { __traiComposeJobs?: Map<string, ComposeJob> }
).__traiComposeJobs ??= new Map());

/** Bu süreçte arka planda yazıya dökülen kayıtlar (sesten yazıya). */
export interface TranscribeJob {
  /** Üretim silindi: sonuç yazılmaz. */
  cancelled: boolean;
}

export const transcribeJobs: Map<string, TranscribeJob> = ((
  globalThis as { __traiTranscribeJobs?: Map<string, TranscribeJob> }
).__traiTranscribeJobs ??= new Map());

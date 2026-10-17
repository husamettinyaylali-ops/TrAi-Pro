/**
 * Bu süreçte arka planda çalışan video oluşturma işleri (ffmpeg). Listede
 * olmayan bekleyen kayıt yarım kalmıştır (sunucu yeniden başladı) ve
 * başarısız sayılır. Geliştirmede modül yeniden yüklense de kaybolmasın diye
 * global nesnede durur. Bağımlılığı yoktur: hem services hem editor okur.
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

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { env } from "./env.server";

/**
 * Üretilen dosyaların (ses, altyazı, görsel, video) deposu. Anahtar biçimi
 * `<kullanıcı>/<dosya>.<uzantı>`; hesap silinince kullanıcı öneki toptan silinir.
 * Yayın ortamına göre (ör. R2/S3) değiştirilebilir.
 */
export interface FileStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
  /** Bir kullanıcının tüm dosyaları (hesap silme). */
  removePrefix(prefix: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9-]+(\/[A-Za-z0-9-]+)*(\.(mp3|jpg|png|webp|mp4|json))?$/;

/** Anahtar yalnız kendi ürettiğimiz biçimde olabilir; dizin dışına çıkış engellenir. */
function pathFor(root: string, key: string): string {
  if (!KEY_RE.test(key)) throw new Error(`Geçersiz dosya anahtarı: ${key}`);
  const full = resolve(root, key);
  if (!full.startsWith(resolve(root) + sep)) throw new Error("Depo dışına erişim");
  return full;
}

export function localFileStorage(root: string): FileStorage {
  return {
    async put(key, data) {
      const p = pathFor(root, key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    },
    async read(key) {
      try {
        return new Uint8Array(await readFile(pathFor(root, key)));
      } catch {
        return null;
      }
    },
    async remove(key) {
      await rm(pathFor(root, key), { force: true });
    },
    async removePrefix(prefix) {
      await rm(pathFor(root, prefix), { recursive: true, force: true });
    },
  };
}

/** MEDIA_DIR (eski adıyla AUDIO_DIR) yoksa data/media. */
export function fileStorage(): FileStorage {
  return localFileStorage(env("MEDIA_DIR") ?? env("AUDIO_DIR") ?? join("data", "media"));
}

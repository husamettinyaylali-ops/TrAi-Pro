let loaded = false;

/**
 * Sunucu ortam değişkeni. Geliştirmede Vite, `.env` dosyasını sunucu tarafına
 * yüklemediği için dosya ilk okumada bir kez yüklenir; mevcut değişkenler ezilmez.
 */
export function env(name: string): string | undefined {
  if (!loaded) {
    loaded = true;
    try {
      process.loadEnvFile(".env");
    } catch {
      // .env yoksa yalnız süreç ortamı kullanılır.
    }
  }
  return process.env[name] || undefined;
}

export const isProduction = () => process.env["NODE_ENV"] === "production";

let loaded = false;

export const isProduction = () => process.env["NODE_ENV"] === "production";

function loadEnvFile() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env yoksa yalnız süreç ortamı kullanılır.
  }
}

/**
 * Sunucu ortam değişkeni. Vite, `.env` dosyasını sunucu tarafına yüklemediği için
 * dosya burada okunur; mevcut değişkenler ezilmez. Geliştirmede eksik bir değişken
 * sorulduğunda dosya yeniden okunur: `.env`'ye sonradan eklenen değer (ör. Google
 * anahtarları) sunucu yeniden başlatılmadan devreye girer. Var olan bir değeri
 * değiştirmek yine yeniden başlatma ister.
 */
export function env(name: string): string | undefined {
  if (!loaded) {
    loaded = true;
    loadEnvFile();
  } else if (!process.env[name] && !isProduction()) {
    loadEnvFile();
  }
  return process.env[name] || undefined;
}

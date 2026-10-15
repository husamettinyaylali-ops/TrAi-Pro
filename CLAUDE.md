# TrAi Pro — geliştirici ve kodlama ajanı yönergeleri

Kredi tabanlı yapay zeka ses, video ve görsel platformu. Yapı ve kapsam için `README.md`'ye bakın.

## Kurallar

- **Metinler** yalnız `src/lib/i18n.tsx` içinde, hem `tr` hem `en` olarak yazılır. Bileşende sabit kullanıcı metni olmaz. `en` sözlüğü `Dict` tipine bağlıdır; eksik anahtar tip hatası verir.
- **Renkler** yalnız `src/styles.css` token'larından gelir (`--violet`, `--cyan`, `--magenta`, `bg-background`, `text-muted-foreground` …). Bileşende ham hex veya `rgb()` yazılmaz. Yeni token hem koyu (`:root`) hem açık (`html.light`) temada tanımlanır.
- **İş mantığı** (kredi, maliyet, süre) `src/lib/credits.ts` içinde saf fonksiyondur ve önce testi yazılır. Bileşen hesap yapmaz, bu fonksiyonları çağırır.
- **"Şimdi"** yalnız `clock()` (`src/lib/clock.ts`) ile alınır; servis fonksiyonları `now` parametresi alır, testlerde sabit tarih verilir.
- **Yetki sunucuda kontrol edilir.** Her korumalı sunucu fonksiyonu (`src/api/functions.ts`) önce oturumu doğrular; istemcide gizlemek güvenlik değildir. Kullanıcı yalnız kendi kayıtlarına erişir (sorgularda `userId` koşulu).
- **İstemciye güvenilmez:** maliyet, fiyat, paket içeriği ve bakiye sunucuda hesaplanır; istemciden gelen girdi `zod` ile doğrulanır. Kredi düşümü ile kayıt tek transaction'dadır.
- **Sunucu kodu** `src/server/*.server.ts` içinde yaşar ve istemci koduna import edilemez (TanStack Start import koruması `**/server/**`'ı engeller). İstemcinin çağırdığı RPC'ler `src/api/functions.ts`'tedir; iş mantığı orada değil servis katmanındadır (`services.server.ts`), çünkü servisler veritabanıyla doğrudan test edilir.
- **Gizli veriler düz metin saklanmaz:** şifre scrypt özeti, oturum token'ının SHA-256 özeti saklanır. Oturum çerezi `httpOnly` + `sameSite=lax`, üretimde `secure`.
- **Şema değişikliği** → `npm run db:generate`, üretilen `drizzle/` migration'ı commit edilir. Elle migration düzenlenmez. Tabloyu yeniden kuran migration'ları (ör. sütunu boş bırakılabilir yapmak) commit'ten önce dolu bir veritabanı kopyasında satır sayısını karşılaştırarak dene.
- **Deneme sınırı:** şifreyle giriş ve kayıt `signInLimited` / `registerLimited` üzerinden geçer; sınırlar `src/lib/rate-limit.ts`'te. Yeni bir kimlik doğrulama yolu (ör. şifre sıfırlama) eklenirse aynı sınır mekanizması kullanılır. İstemci IP'si X-Forwarded-For'dan yalnız `TRUST_PROXY=on` iken okunur.
- **Ortam değişkenleri** yalnız `env()` (`src/server/env.server.ts`) ile okunur; geliştirmede `.env` oradan yüklenir.
- **Dış kimlik (Google):** hesaplar `oauth_accounts` ile bağlanır. Aynı e-postalı şifreli hesap otomatik bağlanmaz (önceden ele geçirme riski). Sunucu rotaları (`src/routes/auth/…`) yalnız `server.handlers` içerir ve tam sayfa bağlantıyla (`<a href>`) açılır.
- **Paket ve fiyatlar** yalnız `src/lib/packages.ts` içinde değişir.
- **Yönlendirme** parametreleri `safeRedirect()` ile süzülür; dış adrese yönlendirme yapılmaz.
- **Erişilebilirlik:** dokunma hedefi en az 44 px (`min-h-11`), görünür odak halkası, simge düğmelerde `aria-label`, durum yalnız renkle verilmez.
- **Mobil:** 375 px genişlikte yatay taşma olmamalı. Grid'lerde mobil sütun `grid-cols-[minmax(0,1fr)]` olarak sınırlandırılır.
- **Gizli bilgiler** (API anahtarları, ödeme anahtarları) koda yazılmaz; `.env` (git'e girmez) ve sunucu tarafında kullanılır.

## Çalışma biçimi

- Değişiklikten sonra: `npx tsc --noEmit`, `npm test`, `npm run lint`.
- Ekranı tarayıcıda açık/koyu tema, TR/EN ve 375/768/1280 genişlikte kontrol et.
- Conventional Commits, Türkçe özet: `feat(labs): …`, `fix(payment): …`.
- Satır sonu LF'dir (`.gitattributes`); biçim `prettier` ile korunur.

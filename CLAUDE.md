# TrAi Pro — geliştirici ve kodlama ajanı yönergeleri

Kredi tabanlı yapay zeka ses, video ve görsel platformu. Yapı ve kapsam için `README.md`'ye bakın.

## Kurallar

- **Metinler** yalnız `src/lib/i18n.tsx` içinde, hem `tr` hem `en` olarak yazılır. Bileşende sabit kullanıcı metni olmaz. `en` sözlüğü `Dict` tipine bağlıdır; eksik anahtar tip hatası verir.
- **Renkler** yalnız `src/styles.css` token'larından gelir (`--violet`, `--cyan`, `--magenta`, `bg-background`, `text-muted-foreground` …). Bileşende ham hex veya `rgb()` yazılmaz. Yeni token hem koyu (`:root`) hem açık (`html.light`) temada tanımlanır.
- **İş mantığı** (kredi, maliyet, süre) `src/lib/credits.ts` içinde saf fonksiyondur ve önce testi yazılır. Bileşen hesap yapmaz, bu fonksiyonları çağırır.
- **"Şimdi"** yalnız `clock()` (`src/lib/store.tsx`) ile alınır; testlerde sabit tarih verilir.
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

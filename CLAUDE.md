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
- **Hesap silme** (`deleteAccount`) kişisel tabloları açıkça siler; mali kayıtlar (`orders`, `wallet_entries`, `payment_intents`) silinmez, yasal saklama için kullanıcı satırı anonimleştirilir (ad boş, e-posta `deletedEmail(id)`, şifre yok, `deleted_at` dolu). Kullanıcıya bağlı **yeni bir tablo** eklenirse kişisel mi mali mi olduğuna karar verilir, kişiselse silme listesine eklenir ve "hesap silme" testi güncellenir. Saklama süresi dolan anonim kayıtların temizliği henüz yok.
- **Yönetim** (`/admin`): her yönetim sunucu fonksiyonu önce `requireAdmin()` çağırır (oturum + `ADMIN_EMAILS` + doğrulanmış e-posta + silinmemiş hesap). İstemcideki `admin` bayrağı yalnız menü içindir. Bakiyeyi değiştiren her yönetici işlemi aynı transaction'da `admin_actions`'a gerekçesiyle yazılır (elle tamamlama `completeTopUpIn` ile); yönetici kendi hesabında işlem yapamaz. Elle girilen işlem kimliği `normalizeProviderRef()` ile otomatik akışın biçimine getirilir (aynı ödeme iki yoldan yazılmasın). `admin_actions` denetim kaydıdır, güncellenmez ve silinmez.
- **Demo notu** (`DemoNote`) yalnız gerçekten demo olan kısımda gösterilir (gerçek yöntem/servis bağlıyken kullanıcıyı yanıltmasın).
- **E-posta:** gönderim `Mailer` arayüzüyle yapılır (`src/server/email.server.ts`); servisler `MailContext` alır, testlerde `memoryMailer()` kullanılır. E-postadaki bağlantılar yalnız `resolveAppUrl()` ile kurulur (yayında `PUBLIC_URL`; Host başlığı sahtelenebilir). Doğrulama ve sıfırlama token'ları tek kullanımlık ve süreli, veritabanında yalnız SHA-256 özetleri durur. Şablonlarda kullanıcıdan gelen her değer HTML kaçışından geçer; e-posta istemcileri CSS değişkenini desteklemediği için şablonlar renksizdir (token kuralının bilinçli istisnası).
- **Ücretli dış servisler** (ElevenLabs vb.) bir arayüz arkasındadır (`TtsProvider`); testlerde sahte uygulama verilir, gerçek servise istek gitmez. Kredi yalnız servis başarılı olduktan sonra, tek transaction'da düşülür (`chargeAndRecord`). Servis bağlıyken demo üretim yoluna düşülmez (sahte çıktıya kredi düşmesin). Sağlayıcı hata gövdeleri loglanmaz (girdi metnini yansıtabilir).
- **Ses klonu** kullanıcının izin onayı olmadan açılmaz; onay zamanı `consent_at`'e yazılır. Hazır ses listesinden kullanıcı klonları ayıklanır (`publicVoices`). Klon ya da hesap silinince sağlayıcıdaki ses ve depodaki dosyalar da silinir.
- **Kullanıcı dosyaları** (`/media/...`) yalnız sahibine sunulur; başkasının kaydı için 404 döner.
- **Bakiye** yalnız defter kayıtlarıyla değişir (`wallet_entries`, değiştirilmez). Bakiyeye yükleme yalnız `completeTopUp()` ile yazılır (idempotent; işlem kimliği yöntem başına benzersiz); paket alımı `purchasePackage()` ile bakiyeden, tek transaction'da.
- **Kripto ödemeler** sağlayıcıdan doğrulanır (USDT: zincir, `claimUsdtTopUp`; Binance Pay: imzalı geçmiş, `claimBinanceTopUp`). Eşleşme benzersiz tutar ve talep zamanıyla yapılır; yalnız işlem kimliğine ya da kullanıcının beyanına güvenen bir doğrulama yazılmaz. Bakiyeye ödenen tutar (sente aşağı) yazılır (`creditCents`). Bir talebin tutarı, ödemesi gelebileceği sürece başka talebe verilmez (`createTopUp`).
- **PayPal**: sipariş tutarı ve talep kimliği yalnız sunucuda belirlenir. Tahsilattan önce sipariş okunup talep sahibi, tutar ve geçerlilik denetlenir; tahsil edilen para, talep geçersiz kalmış olsa da `creditPaypalCapture()` ile bakiyeye yazılır (webhook da aynı fonksiyonu kullanır). Webhook yalnız imzası PayPal'da doğrulanırsa işlenir.
- **Binance API anahtarı** yalnız okuma izniyle kullanılır; geçmiş sorgusu ağır olduğu için önbellekli paylaşılan okuyucu (`sharedIncoming`) dışında çağrılmaz.
- **Ödeme alıcı bilgileri** (cüzdan adresi, Binance kimliği, PayPal hesabı) yalnız `.env`'den gelir; koda yazılmaz. Başka bir sitenin ekran görüntüsündeki alıcı bilgileri asla kullanılmaz.
- **Deneme kredisi** yalnız `markEmailVerified()` ile tanımlanır (doğrulama, şifre sıfırlama ya da Google); tekrar çağrılması zararsızdır.
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

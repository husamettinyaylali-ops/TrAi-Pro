# TrAi Pro

Yapay zeka ses, video ve görsel servislerini tek hesapta sunan, kredi tabanlı web sitesi. Synthwave temalı arayüz; Türkçe (varsayılan) ve İngilizce, açık ve koyu tema.

## Sayfalar

| Yol | İçerik |
| --- | --- |
| `/` | Hero, Ses AI kredi paketleri, Video & Görsel paketleri |
| `/pricing` | Paketler, kredi harcama tablosu, SSS |
| `/sign-in`, `/sign-up` | Giriş ve kayıt (`?redirect=` ile dönüş) |
| `/labs` | Stüdyo: Metinden Ses, Ses Klonlama, Görsel, Video (`?tab=`) |
| `/payment` | Paket ve ödeme yöntemi seçimi (`?package=`) |
| `/payment-history` | Siparişler ve kalan krediler |
| `/account` | Hesabım: ad, şifre, Google bağlantısı, diğer oturumları kapatma, hesabı silme |
| `/forgot-password`, `/reset-password` | Şifremi unuttum: e-postayla sıfırlama bağlantısı ve yeni şifre |
| `/verify-email` | E-posta doğrulama bağlantısının açıldığı sayfa |
| `/terms-of-service`, `/privacy-policy`, `/refund-policy`, `/acceptable-use-policy` | Yasal şablon metinler |

## Durum

**Hazır:** Hesaplar, oturumlar, krediler, siparişler ve üretim geçmişi sunucuda, SQLite veritabanında tutulur (Drizzle ORM + libSQL). Şifreler scrypt ile özetlenir; oturum `httpOnly` çerezle taşınır, veritabanında yalnız token özeti durur. Kredi maliyeti sunucuda hesaplanır ve tek transaction içinde düşülür. E-posta/şifreye ek olarak Google ile giriş ve kayıt vardır (aşağıdaki kuruluma bakın). Kaba kuvvete karşı deneme sınırı uygulanır: aynı e-postaya 15 dakikada 5, aynı IP'den 15 dakikada 20 başarısız şifre denemesi; aynı IP'den saatte 5 kayıt (`src/lib/rate-limit.ts`). Proxy arkasında `TRUST_PROXY=on` ayarlanmalıdır. Hesap sayfasında şifre değişince diğer cihazlardaki oturumlar kapanır; şifreyle açılmış hesaba Google kullanıcının kendi isteğiyle bağlanabilir; hesap silme e-posta onayı (şifreli hesapta şifre de) ister ve kullanıcının tüm verisini siler. Kayıtta doğrulama e-postası gider; **5.000 deneme kredisi e-posta doğrulanınca** tanımlanır (Google ile açılan hesaplar doğrulanmış sayılır). Şifremi unuttum bağlantısı 1 saat, doğrulama bağlantısı 24 saat geçerlidir; ikisi de tek kullanımlıktır ve veritabanında yalnız özetleri durur. Şifre değişince "şifren değiştirildi" bildirimi gider.

**Ödeme modeli (genaipro.io ile aynı):** Kullanıcı önce USD bakiye yükler (en az $5), paketleri bakiyeden alır. Bakiye, değiştirilemez bir defterde tutulur (`wallet_entries`): yükleme artı, alım eksi kayıt; düzeltme yeni kayıtla yapılır. Bakiye yükleme talepleri (`payment_intents`) 1 saat geçerlidir; kripto yöntemlerinde ödemeyi kullanıcıya bağlamak için kuruşuna kadar benzersiz tutar atanır (ör. 10,0347 USDT). Sağlayıcı işlem kimliği benzersizdir, aynı ödeme iki kez bakiyeye yazılamaz. Yöntemler: USDT (BEP20), Binance Pay, PayPal/kart; her biri kendi aşamasında bağlanır. Geliştirmede (üretimde yalnız `DEMO_PAYMENTS=on` ile) "Demo bakiye" yöntemi gerçek ödeme almadan bakiye yükler.

**Demo olan kısımlar:**

- Ödeme: gerçek yöntemler bağlanana kadar yalnız demo bakiye yüklemesi vardır.
- Üretim: seslendirme önizlemesi tarayıcının konuşma sentezini, görsel/video sonuçları örnek görselleri kullanır. Yapay zeka API'leri henüz bağlı değil.
- Ses klonlama: yüklenen dosya saklanmaz; yalnız klon adı kaydedilir.

## Geliştirme

Node.js 22+ gerekir.

```sh
npm i
npm run dev          # http://localhost:8080 — ilk açılışta data/trai-pro.db oluşur ve migration'lar uygulanır
npm test             # vitest (sunucu testleri geçici SQLite dosyalarıyla çalışır)
npm run lint
npx tsc --noEmit
npm run build
npm run db:generate  # şema değişince yeni migration üretir (drizzle/)
npm run db:studio    # veritabanını tarayıcıda incele
```

Ortam değişkenleri için `.env.example` dosyasına bakın. Hiçbiri zorunlu değildir; varsayılan veritabanı `data/trai-pro.db`'dir. Geliştirmede `.env`'ye yeni eklenen değerler sunucu yeniden başlatılmadan okunur; var olan bir değeri değiştirdiyseniz sunucuyu yeniden başlatın.

## Ses üretimi (ElevenLabs) kurulumu

1. [elevenlabs.io](https://elevenlabs.io)'da hesap açın; ses klonlama için en az Starter planı gerekir.
2. **Settings → API Keys**'ten bir anahtar oluşturup `.env`'e `ELEVENLABS_API_KEY` olarak yazın.
3. İsteğe bağlı: **Voices** bölümünden Türkçe için beğendiğiniz hazır sesleri hesabınıza ekleyin ve kimliklerini `ELEVENLABS_VOICE_IDS`'e virgülle yazın; boşsa hesaptaki tüm hazır sesler listelenir.

Anahtar yokken Stüdyo demo kipinde çalışır: seslendirme tarayıcının konuşma sentezini kullanır. Anahtar varken:

- Ses `eleven_multilingual_v2` ile üretilir, MP3 olarak `data/audio/<kullanıcı>/` altında saklanır ve `/media/audio/:id` adresinden yalnız sahibine sunulur (dinleme ve indirme).
- Kredi yalnız başarıda düşer; servis hata verirse kredi düşülmez. Bir kullanıcı dakikada en fazla 20 seslendirme yapabilir.
- Ses klonu, kullanıcının yüklediği kayıtla (en fazla 10 MB) ElevenLabs'te açılır; izin onayı zamanıyla kaydedilir. Klon ya da hesap silinince ElevenLabs'teki ses ve kullanıcının ses dosyaları da silinir.
- **Maliyet:** ElevenLabs karakter başına ücretlendirir; sitedeki kredi fiyatlarınız (`src/lib/packages.ts`) bu maliyeti karşılayacak şekilde ayarlanmalı.
- Cloudflare gibi dosya sistemi olmayan bir ortamda `AudioStorage` arayüzü bir nesne deposuyla (ör. R2/S3) değiştirilmelidir (`src/server/audio-storage.server.ts`).

## E-posta (SMTP) kurulumu

1. Bir SMTP sağlayıcısı seçin: kurumsal e-posta sunucunuz, Google Workspace/Gmail, Yandex, Resend, SendGrid, Brevo vb. Toplu gönderim için işlemsel e-posta servisleri (Resend, SendGrid, Brevo) daha iyi teslim edilir.
2. `.env` dosyasına `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` ve `EMAIL_FROM` yazın (açıklamalar `.env.example`'da).
3. Gönderen alan adınızda sağlayıcının istediği SPF ve DKIM kayıtlarını ekleyin; yoksa e-postalar gereksiz klasörüne düşebilir.
4. Yayında `PUBLIC_URL` zorunludur: bağlantılar yalnız bu adresten kurulur, istekteki `Host` başlığına güvenilmez.

SMTP ayarlı değilken geliştirmede e-postalar gönderilmez, `data/outbox/` klasörüne `.html` ve `.txt` olarak yazılır (klasör git'e girmez); bağlantılar oradan açılıp denenebilir.

## Google ile giriş kurulumu

1. [Google Cloud Console](https://console.cloud.google.com/)'da bir proje seçin ya da oluşturun.
2. **APIs & Services → OAuth consent screen**: uygulama adı (TrAi Pro), destek e-postası; kapsamlar `openid`, `email`, `profile`. Test aşamasında kendi Google hesabınızı "test user" olarak ekleyin.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → türü **Web application**.
   - Authorized JavaScript origins: `http://localhost:8080`
   - Authorized redirect URIs: `http://localhost:8080/auth/google/callback`
   - Yayında bunlara gerçek alan adınızı da ekleyin (`https://alanadiniz/auth/google/callback`) ve `PUBLIC_URL`'yi ayarlayın.
4. Verilen Client ID ve Client secret'ı `.env` dosyasına `GOOGLE_CLIENT_ID` ve `GOOGLE_CLIENT_SECRET` olarak yazın, sunucuyu yeniden başlatın.

Akış: `/auth/google` → Google onay ekranı → `/auth/google/callback`. PKCE ve `state` doğrulaması yapılır; ara değerler 10 dakikalık `httpOnly` çerezlerde tutulur. İlk Google girişinde hesap açılır ve deneme kredisi tanımlanır. Aynı e-postayla şifreli bir hesap varsa otomatik bağlanmaz (o hesabı e-postayı doğrulamadan başkası açmış olabilir); kullanıcıya şifresiyle girmesi söylenir.

## Veritabanı ve yayın

- Şema: `src/server/schema.server.ts`. Değişiklikten sonra `npm run db:generate` ile migration üretilir ve `drizzle/` klasörüyle birlikte commit edilir. Migration'lar sunucu ilk veritabanı bağlantısında otomatik uygulanır.
- Varsayılan derleme hedefi Cloudflare Workers'tır (`npm run build`). Workers'ta yerel SQLite dosyası çalışmaz; orada uzak bir libSQL veritabanı (ör. Turso, `DATABASE_URL` + `DATABASE_AUTH_TOKEN`) ve `@libsql/client/web` sürücüsü gerekir. Node sunucusunda (VPS) yerel dosya olduğu gibi çalışır. Postgres'e geçişte şema `drizzle-orm/pg-core` ile yeniden tanımlanır; servis katmanı büyük ölçüde aynı kalır.

## Yapı

- `src/routes/` — dosya tabanlı rotalar (TanStack Start). `routeTree.gen.ts` otomatik üretilir.
- `src/lib/credits.ts` — kredi hesapları (saf fonksiyonlar, `src/test/credits.test.ts` ile korunur)
- `src/lib/packages.ts` — paket fiyatları, kayıt bonusu, iletişim bilgileri
- `src/lib/i18n.tsx` — tüm arayüz metinleri (TR/EN)
- `src/lib/store.tsx` — istemci durumu: oturum ve kullanıcı verisini sunucudan çeker (React Query)
- `src/lib/types.ts` — istemci ve sunucunun paylaştığı tipler
- `src/api/functions.ts` — istemcinin çağırdığı sunucu fonksiyonları (oturum çerezi, yetki kontrolü)
- `src/server/*.server.ts` — yalnız sunucuda çalışan kod: veritabanı, şema, şifre, oturum, servisler. İstemci koduna import edilemez.
- `src/components/site/` — site iskeleti, paket kartları, giriş formu, yasal sayfa
- `src/components/labs/` — stüdyo araçları
- `src/styles.css` — renk token'ları (koyu varsayılan, `html.light` açık tema)

Proje [Lovable](https://lovable.dev) ile başlatıldı; özgün Lovable deposu `lovable` uzak adıyla duruyor.

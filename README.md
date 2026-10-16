# TrAi Pro

Yapay zeka ses, video ve görsel servislerini tek hesapta sunan, kredi tabanlı web sitesi. Synthwave temalı arayüz; Türkçe (varsayılan) ve İngilizce, açık ve koyu tema.

## Sayfalar

| Yol                                                                                | İçerik                                                                        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/`                                                                                | Hero, Ses AI kredi paketleri, Video & Görsel paketleri                        |
| `/pricing`                                                                         | Paketler, kredi harcama tablosu, SSS                                          |
| `/sign-in`, `/sign-up`                                                             | Giriş ve kayıt (`?redirect=` ile dönüş)                                       |
| `/labs`                                                                            | Stüdyo: solda projeler, akış, yazma kutusu (`?tab=`, `?project=`)             |
| `/projects`, `/projects/:id`                                                       | Projeler: not, projedeki üretimler, tümünü ZIP olarak indirme                 |
| `/payment`                                                                         | Paket ve ödeme yöntemi seçimi (`?package=`)                                   |
| `/payment-history`                                                                 | Siparişler ve kalan krediler                                                  |
| `/account`                                                                         | Hesabım: ad, şifre, Google bağlantısı, diğer oturumları kapatma, hesabı silme |
| `/forgot-password`, `/reset-password`                                              | Şifremi unuttum: e-postayla sıfırlama bağlantısı ve yeni şifre                |
| `/verify-email`                                                                    | E-posta doğrulama bağlantısının açıldığı sayfa                                |
| `/api-docs`                                                                        | Geliştirici API belgeleri (herkese açık); API anahtarları Hesabım'da          |
| `/admin`                                                                           | Yönetim: özet, kullanıcı/ödeme arama, bakiye düzeltme, elle tamamlama, kayıt  |
| `/terms-of-service`, `/privacy-policy`, `/refund-policy`, `/acceptable-use-policy` | Yasal şablon metinler                                                         |

## Durum

**Hazır:** Hesaplar, oturumlar, krediler, siparişler ve üretim geçmişi sunucuda, SQLite veritabanında tutulur (Drizzle ORM + libSQL). Şifreler scrypt ile özetlenir; oturum `httpOnly` çerezle taşınır, veritabanında yalnız token özeti durur. Kredi maliyeti sunucuda hesaplanır ve tek transaction içinde düşülür. E-posta/şifreye ek olarak Google ile giriş ve kayıt vardır (aşağıdaki kuruluma bakın). Kaba kuvvete karşı deneme sınırı uygulanır: aynı e-postaya 15 dakikada 5, aynı IP'den 15 dakikada 20 başarısız şifre denemesi; aynı IP'den saatte 5 kayıt (`src/lib/rate-limit.ts`). Proxy arkasında `TRUST_PROXY=on` ayarlanmalıdır. Hesap sayfasında şifre değişince diğer cihazlardaki oturumlar kapanır; şifreyle açılmış hesaba Google kullanıcının kendi isteğiyle bağlanabilir; hesap silme e-posta onayı (şifreli hesapta şifre de) ister; kişisel veriler (oturumlar, krediler, üretimler, ses klonları, Google bağlantısı) silinir, ödeme ve sipariş kayıtları yasal saklama için ad ve e-posta olmadan tutulur (`users.deleted_at`). Aynı e-postayla yeniden kayıt olunabilir. Kayıtta doğrulama e-postası gider; **5.000 deneme kredisi e-posta doğrulanınca** tanımlanır (Google ile açılan hesaplar doğrulanmış sayılır). Şifremi unuttum bağlantısı 1 saat, doğrulama bağlantısı 24 saat geçerlidir; ikisi de tek kullanımlıktır ve veritabanında yalnız özetleri durur. Şifre değişince "şifren değiştirildi" bildirimi gider.

**Ödeme modeli (genaipro.io ile aynı):** Kullanıcı önce USD bakiye yükler (en az $5), paketleri bakiyeden alır. Bakiye, değiştirilemez bir defterde tutulur (`wallet_entries`): yükleme artı, alım eksi kayıt; düzeltme yeni kayıtla yapılır. Bakiye yükleme talepleri (`payment_intents`) 1 saat geçerlidir; kripto yöntemlerinde ödemeyi kullanıcıya bağlamak için kuruşuna kadar benzersiz tutar atanır (ör. 10,0347 USDT). Sağlayıcı işlem kimliği benzersizdir, aynı ödeme iki kez bakiyeye yazılamaz. Yöntemler: USDT (BEP20), Binance Pay, PayPal/kart. Geliştirmede (üretimde yalnız `DEMO_PAYMENTS=on` ile) "Demo bakiye" yöntemi gerçek ödeme almadan bakiye yükler.

**Anahtara bağlı ya da demo olan kısımlar:**

- Ödeme: her yöntem kendi anahtarları `.env`'e yazılınca açılır (aşağıdaki kurulumlar). Hiçbiri açık değilse geliştirmede yalnız demo bakiye vardır ve ödeme sayfası bunu belirtir.
- Seslendirme ve ses klonlama: `ELEVENLABS_API_KEY` varsa gerçek; yoksa seslendirme tarayıcının konuşma sentezini kullanır, klonda yalnız ad kaydedilir.
- Görsel: `FAL_KEY` varsa gerçek (fal.ai); yoksa örnek görseller.
- Video: `FAL_KEY` varsa gerçek (fal.ai, Kling); yoksa örnek görseller. Stüdyo, hangi kısımların demo olduğunu belirtir.

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

Ortam değişkenleri için `.env.example` dosyasına bakın. Hiçbiri zorunlu değildir; varsayılan veritabanı `data/trai-pro.db`'dir. Geliştirmede `.env`'ye yeni eklenen değerler sunucu yeniden başlatılmadan okunur; var olan bir değeri değiştirdiyseniz (`.env`'de boş duran bir anahtarı doldurmak dahil) sunucuyu yeniden başlatın.

## USDT (BEP20) ile bakiye yükleme

1. `.env`'e kendi BSC cüzdan adresinizi `USDT_BEP20_ADDRESS` olarak yazın (borsa yatırma adresi değil, kontrolünüzdeki bir cüzdan önerilir).
2. Kullanıcı tutar seçer; ona 1 saat geçerli, kuruşuna kadar benzersiz bir tutar (ör. 10,0347 USDT), adres ve QR gösterilir.
3. Kullanıcı gönderdikten sonra işlem kimliğini (tx hash) yapıştırır. Sunucu BSC düğümünden işlemi doğrular: başarılı mı, USDT sözleşmesi mi (`0x55d3…7955`), alıcı sizin adresiniz mi, tutar o kullanıcının bekleyen benzersiz tutarıyla aynı mı, yeterli onay (varsayılan 12 blok) var mı ve talepten sonra mı yapılmış. Hepsi tutarsa bakiye yüklenir; aynı işlem ikinci kez kullanılamaz.

Zincir herkese açık olduğu için eşleşme yalnız işlem kimliğine değil benzersiz tutara dayanır: adresinizi izleyen biri başkasının işlemini kendi hesabına yazdıramaz. Farklı tutar gönderen ya da süresi dolduktan sonra ödeyen kullanıcı otomatik eşleşmez; yönetim panelinden çözülür (süresi dolan talep elle tamamlanır, farklı tutar bakiye düzeltmesiyle yazılır).

## Binance Pay ile bakiye yükleme

1. Binance'te **API Management**'tan bir API anahtarı oluşturun. Yalnız **Enable Reading** izni verin (çekim ve işlem izinleri gerekmez), mümkünse sunucunuzun IP adresiyle kısıtlayın.
2. `.env`'e kendi Binance kimliğinizi (Pay ID) `BINANCE_PAY_ID`, anahtarı `BINANCE_API_KEY` ve `BINANCE_API_SECRET` olarak yazın. Üçü de dolu olduğunda yöntem ödeme sayfasında görünür.
3. Kullanıcı tutar seçer; ona 1 saat geçerli, 2 ondalıklı benzersiz bir tutar (ör. 10,37 USDT) ve Binance kimliğiniz gösterilir. Binance uygulamasında Pay > Gönder ile bu tutarı gönderir ve "Ödemeyi yaptım" düğmesine basar; sayfa açık kaldıkça 30 saniyede bir kendiliğinden kontrol edilir.
4. Sunucu Binance Pay geçmişini (`GET /sapi/v1/pay/transactions`, imzalı) okur ve hesabınıza gelen C2C USDT ödemeleri arasında kullanıcının bekleyen tutarını, talepten sonra yapılmış ve daha önce kullanılmamış işlemi arar. Bulursa bakiye yüklenir.

Binance geçmişi ödeme notunu döndürmediği için eşleşme yalnız benzersiz tutar ve zamanla yapılır; Binance uygulamasında güvenle girilebilen 2 ondalık kullanılır. Geçmiş sorgusu ağır olduğundan liste 20 saniye önbellekte tutulur ve kullanıcılar arasında paylaşılır. USDT dışında bir para birimiyle ya da farklı tutarla yapılan ödeme otomatik eşleşmez; yönetim panelinden çözülür.

## PayPal ve kartla bakiye yükleme

1. [developer.paypal.com](https://developer.paypal.com)'da **Apps & Credentials** altında bir REST uygulaması oluşturun. Önce **Sandbox** sekmesindeki bilgilerle deneyin.
2. `.env`'e `PAYPAL_CLIENT_ID` ve `PAYPAL_CLIENT_SECRET` yazın. `PAYPAL_ENV` boşken sandbox kullanılır; canlıya geçerken **Live** bilgilerini yazıp `PAYPAL_ENV=live` yapın.
3. Kullanıcı tutar seçer ve PayPal düğmesiyle PayPal hesabından ya da "Banka/Kredi kartı" seçeneğiyle kartla öder. Sipariş sunucuda talep tutarıyla açılır (`custom_id` = talep kimliği); kullanıcı onaylayınca sunucu siparişi okur, talep bu kullanıcının mı, tutar aynı mı ve talep hâlâ geçerli mi diye bakar, sonra tahsil edip bakiyeye yazar. Tutmazsa tahsil edilmez, kullanıcıdan para alınmaz.
4. (Önerilir) **Webhooks** bölümünde `https://<alan-adınız>/webhooks/paypal` adresine `PAYMENT.CAPTURE.COMPLETED` olayını ekleyin ve verilen kimliği `PAYPAL_WEBHOOK_ID` olarak yazın. İncelemeye düşüp sonradan tamamlanan ödemeler böylece kendiliğinden bakiyeye yazılır. Webhook imzası PayPal'ın doğrulama API'siyle denetlenir.

Sandbox'ta deneme için **Sandbox accounts**'taki kişisel test hesabıyla ya da PayPal'ın test kartlarıyla ödeyin.

## Video üretimi (fal.ai, Kling)

Görselle aynı `FAL_KEY` kullanılır; model varsayılan olarak Kling 1.6 standart (metinden 5 saniyelik, 16:9 video) ve `FAL_VIDEO_MODEL` ile değiştirilebilir. Bir video **15 kredi**dir (`src/lib/credits.ts`).

- Video birkaç dakika sürdüğü için iş fal.ai kuyruğuna gönderilir ve kredi o anda düşülür (bekleme sırasında başka harcamada kullanılmasın). Hangi paketten kaç kredi düşüldüğü kayda yazılır.
- Stüdyo sayfası açıkken bekleyen videolar 8 saniyede bir kontrol edilir. Yayında (`PUBLIC_URL` varken) fal.ai iş bitince `/webhooks/fal` adresine de haber verir; kullanıcı sayfadan ayrılsa da video tamamlanır. Webhook gövdesine güvenilmez: yalnız hangi işin kontrol edileceğini söyler, sonuç kendi anahtarımızla fal.ai'den okunur.
- İş başarısız olursa ya da 1 saati aşarsa (iş iptal edilir) kredi düşüldüğü paketlere bir kez iade edilir.
- Biten video `data/media/<kullanıcı>/` altında saklanır ve `/media/file/:id/0` adresinden yalnız sahibine sunulur (oynatma ve indirme).
- Bir kullanıcı aynı anda en fazla 3 video hazırlatabilir ve saatte en fazla 10 video isteği gönderebilir.
- **Maliyet:** Kling 1.6 standart fal.ai'de 5 saniyelik video başına yaklaşık 0,25 $'dır; 15 kredi Video & Görsel paketlerinde yaklaşık 0,40–0,45 $ eder. Güncel fiyatı fal.ai'den kontrol edin; model değişirse kredi maliyetini de gözden geçirin.

## Stüdyo, projeler ve üretimlerin düzeltilmesi

- **Stüdyo düzeni** (`/labs`), yapay zeka uygulamalarındaki gibi: solda projeler (yeni proje, arama, "Tüm üretimler", krediler; dar ekranda soldan açılan çekmece), ortada seçili projenin akışı (sohbet gibi en yenisi altta, gün ayırıcılı, en üstte daha eski üretimler), altta sabit yazma kutusu (araç: Ses, Klon, Görsel, Video; araca göre ses, adet ya da stil; maliyet; Ctrl/Cmd + Enter gönderir). Araç `?tab=`, proje `?project=` ile adreste tutulur. Klon aracında ana alanda ses klonları yönetilir.
- **Proje:** kullanıcının çalışma alanı (ad, serbest not; kullanıcı başına en fazla 100). Seçiliyken yeni üretimler o projeye kaydedilir ve akış yalnız onu gösterir; "Tüm üretimler" her kaydı projesiyle gösterir. Üst çubukta proje notu, tümünü indir (ZIP) ve projeyi aç vardır.
- **Her üretim kartında** doğrudan: _İndir_ (demo üretimde nedenini söyleyerek kapalı), _Düzenle_ (metin/istem, ses, adet ya da stil yazma kutusuna gelir; üretince yeni sürüm kaydedilir, eskisi silinmez ve kredi yeniden harcanır; yeni sürüm eski kaydın projesinde ve adıyla kalır), _Yeniden üret_ (aynı ayarlarla, tek tıkla), _Metni kopyala_, _Taşı_; menüde _Yeniden adlandır_ ve _Sil_.
- **Proje sayfası** (`/projects/:id`): ad ve not düzenleme, projedeki üretimler (türe göre süzülür; dinleme, önizleme, indirme, menü), stüdyoda açma ve silme. Proje silinince üretimler silinmez, projesiz kalır.
- **Tümünü indir (ZIP)** (`/media/project/:id`, yalnız sahibine): gerçek dosyalar tür klasörlerinde (`ses/`, `gorsel/`, `video/`; `?lang=en` ile İngilizce), sonda proje notu, metinler ve dosya listesini içeren `icerik.txt`. Dosyalar sıkıştırılmadan akış olarak eklenir (medya zaten sıkıştırılmıştır; bellekte bir anda tek dosya durur); en fazla 300 üretim, 4 GB'a yaklaşınca kalan dosyalar atlanıp listede belirtilir. Kullanıcı başına saatte 20 arşiv.

## Ödeme makbuzları

Bakiye yüklemesi tamamlanınca (kullanıcının kendi doğrulaması, PayPal webhook'u ya da yönetici elle tamamlaması) ve bakiyeden paket alınınca kullanıcıya makbuz e-postası gider: yöntem, yazılan tutar, güncel bakiye, işlem numarası; pakette kredi, son kullanma ve kalan bakiye. Makbuz talep anındaki dilde gider ve her ödeme için bir kez gönderilir (`payment_intents.receipt_sent_at`). Demo yüklemeye ve silinmiş hesaba gönderilmez; e-posta gönderilemezse ödeme etkilenmez, loglanır.

## Bakiyeye yazılan tutar

Kripto yöntemlerde benzersizlik için eklenen kuruşlar kullanıcıda kalır: bakiyeye, ödenen tutar sente aşağı yuvarlanarak yazılır (10,37 USDT → $10,37; 10,0347 USDT → $10,03). Bir talebin tutarı, o talebe ödeme gelebileceği sürece (talep beklerken, kullanıcı yeni tutar istediğinde ve süresi dolduktan sonraki 5 dakika) başka bir kullanıcıya verilmez.

## Geliştirici API'si

Kullanıcılar Hesabım sayfasından API anahtarı oluşturur (en fazla 5 etkin anahtar, e-postası doğrulanmış hesap) ve `/api/v1` uç noktalarını `Authorization: Bearer trai_…` başlığıyla çağırır. Belgeler: `/api-docs`.

- Uç noktalar: `GET me`, `GET voices`, `POST tts`, `POST images`, `POST videos` (202, kuyruk), `GET generations/:id`, `GET generations/:id/files/:sıra`.
- Kredi, fiyat, sınır ve "hata/redde kredi düşmez" kuralları stüdyoyla aynı servis fonksiyonlarından geçer. Ek olarak anahtar başına dakikada 120 istek.
- Anahtarın kendisi saklanmaz (SHA-256 özeti); kullanıcı oluştururken bir kez görür. İptal edilen anahtar ve silinen hesabın anahtarları kabul edilmez.
- Hatalar `{"error":{"code","message"}}` biçiminde, uygun HTTP durumuyla döner; ilgili servis bu sunucuda açık değilse 503.
- API sunucudan sunucuya kullanım içindir; CORS açık değildir.

## Yönetim paneli

`.env`'e `ADMIN_EMAILS` (virgülle ayrılmış e-postalar) yazın. Bu adreslerle açılmış ve e-postası doğrulanmış hesaplar kullanıcı menüsünde **Yönetim** bağlantısını görür (`/admin`). Yetki her istekte sunucuda denetlenir; listeden çıkarılan adres hemen yetkisini kaybeder.

- **Kurulum durumu:** her servis (site adresi, e-posta, ses, görsel/video, Google, USDT, Binance Pay, PayPal, yedek) için hazır / eksik / dikkat / kullanılmıyor durumu, eksik anahtarların adları, gizli olmayan bilgiler (gönderen, model, Google yönlendirme adresi, kısaltılmış alıcı adresi) ve yayına özel uyarılar (demo bakiye açık, PayPal sandbox, webhook kimliği ya da yedek klasörü yok). Anahtar değerleri hiç gösterilmez. **Bağlantıyı test et** ücretsiz bir istekle anahtarın çalıştığını doğrular (ses listesi, var olmayan iş sorgusu, geçersiz kodla token, son blok, kısa geçmiş, PayPal erişim anahtarı); e-posta testi yöneticinin kendi adresine gider. Yönetici başına 10 dakikada 30 test. Kurulumda önce `ADMIN_EMAILS`'e kendi adresinizi yazıp o adresle hesap açın; diğer anahtarları buradan tek tek doğrulayabilirsiniz.
- **Özet:** aktif ve silinmiş hesaplar, toplam kullanıcı bakiyesi (kullanıcılara borç), son 24 saatin gerçek yüklemeleri, bekleyen ödeme talepleri.
- **Kullanıcı arama:** e-posta, ad ya da kullanıcı kimliğiyle. Ayrıntıda bakiye defteri, ödeme talepleri (sağlayıcı işlem kimliğiyle), paket alımları ve o kullanıcıdaki yönetici işlemleri görünür.
- **Ödeme talebi arama:** tutar başı (ör. `10.37`), sağlayıcı işlem kimliği, talep kimliği ya da e-postayla. Sahibi belli olmayan bir ödemeyi tutarından bulup kullanıcıya gitmek için.
- **Elle tamamlama:** ödemesi sağlayıcıda (BscScan, Binance, PayPal) doğrulanmış ama otomatik eşleşmemiş talep (ör. süresi dolduktan sonra ödenmiş) işlem kimliği ve gerekçeyle tamamlanır; bakiyeye talebin tutarı yazılır. İşlem kimliği otomatik akışın biçimine getirilir, bu yüzden aynı ödeme hem elle hem kullanıcının kendi doğrulamasıyla iki kez yazılamaz.
- **Bakiye düzeltme:** farklı tutar gönderilen ya da yanlış yazılan ödemeler için. Deftere "Düzeltme" kaydı düşer; gerekçe zorunludur, bakiye eksiye düşürülemez, yönetici kendi bakiyesini düzeltemez. Her işlem `admin_actions` tablosuna kim, ne zaman, ne kadar ve neden bilgisiyle yazılır; bu kayıt değiştirilmez ve hesap silinince de kalır.

## Ses üretimi (ElevenLabs) kurulumu

1. [elevenlabs.io](https://elevenlabs.io)'da hesap açın; ses klonlama için en az Starter planı gerekir.
2. **Settings → API Keys**'ten bir anahtar oluşturup `.env`'e `ELEVENLABS_API_KEY` olarak yazın.
3. İsteğe bağlı: **Voices** bölümünden Türkçe için beğendiğiniz hazır sesleri hesabınıza ekleyin ve kimliklerini `ELEVENLABS_VOICE_IDS`'e virgülle yazın; boşsa hesaptaki tüm hazır sesler listelenir.

Anahtar yokken Stüdyo demo kipinde çalışır: seslendirme tarayıcının konuşma sentezini kullanır. Anahtar varken:

- Ses `eleven_multilingual_v2` ile üretilir, MP3 olarak `data/media/<kullanıcı>/` altında saklanır ve `/media/audio/:id` adresinden yalnız sahibine sunulur (dinleme ve indirme).
- Kredi yalnız başarıda düşer; servis hata verirse kredi düşülmez. Bir kullanıcı dakikada en fazla 20 seslendirme yapabilir.
- Ses klonu, kullanıcının yüklediği kayıtla (en fazla 10 MB) ElevenLabs'te açılır; izin onayı zamanıyla kaydedilir. Klon ya da hesap silinince ElevenLabs'teki ses ve kullanıcının ses dosyaları da silinir.
- **Maliyet:** ElevenLabs karakter başına ücretlendirir; sitedeki kredi fiyatlarınız (`src/lib/packages.ts`) bu maliyeti karşılayacak şekilde ayarlanmalı.
- Cloudflare gibi dosya sistemi olmayan bir ortamda `FileStorage` arayüzü bir nesne deposuyla (ör. R2/S3) değiştirilmelidir (`src/server/file-storage.server.ts`).

## Görsel üretimi (fal.ai) kurulumu

1. [fal.ai](https://fal.ai)'de hesap açın, bakiye yükleyin ve **Keys** bölümünden bir API anahtarı oluşturun.
2. `.env`'e `FAL_KEY` olarak yazın. Model varsayılan olarak `fal-ai/flux/schnell`'dir (hızlı ve ucuz); daha yüksek kalite için `FAL_IMAGE_MODEL`'e ör. `fal-ai/flux/dev` yazabilirsiniz.

Anahtar yokken görsel stüdyosu demo kipinde örnek görseller gösterir. Anahtar varken:

- Görseller 1024×1024 JPEG olarak üretilir, `data/media/<kullanıcı>/` altında saklanır ve `/media/file/:id/:sıra` adresinden yalnız sahibine sunulur (görüntüleme ve indirme).
- Sağlayıcının güvenlik filtresi açıktır. Filtreye takılan görseller ayıklanır; kredi yalnız teslim edilen görsel kadar düşer. Hepsi takılırsa ya da servis hata verirse kredi düşülmez.
- Bir kullanıcı 10 dakikada en fazla 30 görsel isteği gönderebilir.
- **Maliyet:** fal.ai görsel başına (megapiksel başına) ücretlendirir; Flux schnell görsel başına birkaç sent mertebesindedir. Güncel fiyatı fal.ai'den kontrol edip Video & Görsel paket fiyatlarını (`src/lib/packages.ts`) buna göre ayarlayın.

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
- Derleme hedefi Node sunucusudur (`vite.config.ts` → Nitro `node-server`): `npm run build` → `npm start` (`node .output/server/index.mjs`, port `PORT`, varsayılan 3000). Sunucu tek dosyada paketlenir; SQLite'ın yerel modülü `.output/server/node_modules` altına alınır, bu yüzden derleme hedef işletim sisteminde yapılmalıdır (Docker imajı bunu Linux'ta yapar). Migration'lar açılışta çalışma klasöründeki `drizzle/`'dan uygulanır.
- Postgres'e geçişte şema `drizzle-orm/pg-core` ile yeniden tanımlanır; servis katmanı büyük ölçüde aynı kalır.

## Yayın (VPS)

Gereken: Docker ve Docker Compose kurulu bir Linux sunucu (2 GB RAM yeterli), sunucuya yönlendirilmiş bir alan adı (A kaydı), açık 80 ve 443 portları.

1. Depoyu sunucuya klonlayın; `.env.example`'ı `.env` olarak kopyalayıp doldurun. Yayında en az şunlar gerekir:
   - `DOMAIN` (ör. `trai.example.com`) ve `PUBLIC_URL=https://<DOMAIN>`: e-posta bağlantıları, webhook adresleri ve Google dönüş adresi bundan kurulur.
   - SMTP (`SMTP_*`, `EMAIL_FROM`): doğrulama ve şifre sıfırlama e-postaları için.
   - `ADMIN_EMAILS`, kullandığınız servislerin anahtarları (Google, ElevenLabs, fal.ai, ödeme yöntemleri).
2. `docker compose up -d --build`. Caddy alan adı için HTTPS sertifikasını kendisi alır; uygulama yalnız Caddy üzerinden erişilebilir.
3. Kontrol: `https://<DOMAIN>/health` → `{"status":"ok"}`; `docker compose logs -f app`.
4. Dış servis panellerine yayın adreslerini yazın:
   - Google OAuth yetkili yönlendirme URI'si: `https://<DOMAIN>/auth/google/callback`
   - PayPal webhook: `https://<DOMAIN>/webhooks/paypal` (`PAYMENT.CAPTURE.COMPLETED`) → `PAYPAL_WEBHOOK_ID`
   - fal.ai video webhook'u ayrıca ayar istemez; `PUBLIC_URL` varken her işle birlikte gönderilir (`/webhooks/fal`).

**Veri ve yedek:** Veritabanı, üretilen dosyalar ve yedekler `trai-data` Docker biriminde (`/data`) durur; imaj yenilense de korunur. Uygulama her gün `VACUUM INTO` ile tutarlı bir veritabanı yedeği alır (`/data/backups`, son 7 gün). Aynı günlük bakım süresi dolmuş oturumları siler ve hesabı silinmiş kullanıcıların anonim ödeme/sipariş kayıtlarını saklama süresi (`RETENTION_YEARS`, varsayılan 10 yıl; `off` kapatır) dolunca temizler. Yedekleri ve dosyaları sunucu dışına da kopyalayın, ör. her gece:

```sh
docker run --rm -v trai-pro_trai-data:/data -v "$PWD/yedek":/yedek alpine \
  tar czf /yedek/trai-data-$(date +%F).tgz -C /data backups media
```

**Güncelleme:** `git pull && docker compose up -d --build`. Migration'lar açılışta uygulanır; tabloyu yeniden kuran bir migration varsa önce yedek alın.

**Geri yükleme:** uygulamayı durdurun (`docker compose stop app`), yedeği birimde `/data/trai-pro.db` olarak kopyalayın, yeniden başlatın.

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

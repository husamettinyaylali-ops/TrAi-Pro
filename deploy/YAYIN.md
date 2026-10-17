# Yayına çıkış

Boş bir sunucudan canlı siteye adım adım. Kurulum betiği (`deploy/kurulum.sh`) Docker'ı, güvenlik duvarını, `.env`'in temel ayarlarını ve uygulamayı kurar; geri kalan iş servis anahtarlarını girip denemektir.

## 0. Hazırlık

- [ ] **Sunucu (VPS):** Ubuntu 24.04 LTS (22.04 ya da Debian 12 de olur), en az 2 vCPU, 4 GB bellek, 40 GB disk. 2 GB bellekte de çalışır (betik takas alanı açar) ama kısa video oluşturucu işlemci ve bellek ister.
- [ ] **Alan adı:** DNS'te bir `A` kaydı sunucunun IP adresine yönlenmeli (ör. `trai.ornek.com → 203.0.113.10`). Kayıt yayılmadan HTTPS sertifikası alınamaz.
- [ ] **E-posta (SMTP):** alan adınızdan gönderen bir hesap; sağlayıcının SPF ve DKIM kayıtları DNS'e eklenmiş olmalı (yoksa e-postalar spam'e düşer).
- [ ] **Servis anahtarları** (sonra da girilebilir): ElevenLabs, fal.ai, Google girişi, ödeme yöntemleri. Her birinin açıklaması `.env.example`'da.
- [ ] Sunucu sağlayıcısının panelinde ayrı bir güvenlik duvarı varsa **22, 80 ve 443** portlarını açın.

## 1. Sunucuya bağlanıp kodu indirme

Depo özel olduğu için sunucuya yalnız okuma izni olan bir **deploy key** verilir:

```sh
ssh root@SUNUCU_IP
apt-get update && apt-get install -y git
ssh-keygen -t ed25519 -f ~/.ssh/trai_deploy -N "" -C trai-sunucu
cat ~/.ssh/trai_deploy.pub
```

Çıkan satırı GitHub'da deponun **Settings → Deploy keys → Add deploy key** bölümüne ekleyin ("Allow write access" işaretlemeyin). Sonra:

```sh
printf 'Host github.com\n  IdentityFile ~/.ssh/trai_deploy\n' >> ~/.ssh/config
git clone git@github.com:husamettinyaylali-ops/TrAi-Pro.git /opt/trai-pro
cd /opt/trai-pro
```

## 2. Kurulum

```sh
sudo bash deploy/kurulum.sh
```

Betik sırayla:

1. Sistemi denetler (Ubuntu/Debian, root).
2. Bellek 3 GB'ın altındaysa 2 GB takas alanı açar.
3. Docker'ı resmî Docker deposundan kurar (kuruluysa atlar).
4. Güvenlik duvarını (ufw) açar: SSH, 80, 443. Kendi güvenlik duvarınızı kullanıyorsanız `--guvenlik-duvari-yok`.
5. `.env` yoksa `.env.example`'dan oluşturur ve alan adı, yönetici e-postası ve SMTP bilgilerini sorar (şifre ekranda görünmez). `PUBLIC_URL`'i alan adından yazar, `.env`'i yalnız root okuyabilir yapar. `DEMO_PAYMENTS=on` ise durur.
6. Alan adının bu sunucuya yönlendiğini kontrol eder.
7. Uygulamayı derleyip başlatır (ilk derleme birkaç dakika), sağlık kontrolünü ve HTTPS'i bekler.

Betik tekrar çalıştırılabilir. `.env`'i önceden doldurduysanız `--evet` ile soru sormaz.

## 3. İlk giriş ve servisler

1. `https://ALANADI` adresinde `ADMIN_EMAILS`'teki e-postayla hesap açın; doğrulama e-postasındaki bağlantıyı açın (gelmiyorsa SMTP ayarına bakın).
2. `https://ALANADI/admin` → **Kurulum durumu**: kırmızı ya da sarı maddeleri giderin; her servisi **Bağlantıyı test et** ile deneyin (e-posta testi size bir ileti gönderir).
3. Anahtar eklemek ya da değiştirmek için `.env`'i düzenleyip uygulamayı yeniden başlatın (derleme gerekmez):

   ```sh
   cd /opt/trai-pro && nano .env && docker compose up -d
   ```

4. Dış servis panellerine yayın adreslerini yazın:
   - Google OAuth yetkili yönlendirme adresi: `https://ALANADI/auth/google/callback`
   - PayPal webhook: `https://ALANADI/webhooks/paypal` (olay: `PAYMENT.CAPTURE.COMPLETED`) → verdiği kimliği `PAYPAL_WEBHOOK_ID`'ye yazın; gerçek ödeme için `PAYPAL_ENV=live`.
   - fal.ai video webhook'u ayar istemez (`PUBLIC_URL`'den kurulur).

## 4. Duman testi

Kendi bilgisayarınızda (Node 18+), depo klasöründe:

```sh
node deploy/duman-testi.mjs https://ALANADI
```

Sağlık, HTTPS yönlendirmesi, güvenlik başlıkları, herkese açık sayfalar, site haritası ve kişisel dosyaların kapalılığı denenir. Hesabım → **API anahtarları**'ndan bir anahtar oluşturup servisleri de deneyin:

```sh
node deploy/duman-testi.mjs https://ALANADI --anahtar trai_…          # krediler, ses listesi
node deploy/duman-testi.mjs https://ALANADI --anahtar trai_… --uret   # gerçek seslendirme, sesten yazı ve görsel (~10 + 1 kredi)
node deploy/duman-testi.mjs https://ALANADI --anahtar trai_… --video  # ayrıca bir video (15 kredi, birkaç dakika)
```

Başarısız kontrol varsa yanında nedeni yazar; sunucuda `docker compose logs --tail 100 app` ayrıntıyı gösterir.

## 5. Canlıya çıkış kontrol listesi

- [ ] Duman testi temiz (`--uret` dahil).
- [ ] Kurulum durumunda kırmızı madde yok; **Yedek** hazır.
- [ ] Yeni hesap: doğrulama e-postası geliyor, deneme kredisi tanımlanıyor; şifre sıfırlama e-postası geliyor.
- [ ] Google ile giriş (kullanılıyorsa).
- [ ] Stüdyo: seslendirme ve altyazı, uzun metin, ses klonu, sesten yazı (kısa bir video dosyasıyla), görsel, video, düzenleyici, kısa video oluşturucu.
- [ ] Her ödeme yöntemiyle küçük gerçek bir ödeme (ör. 1 $): bakiyeye yazılıyor, makbuz e-postası geliyor, paket alınabiliyor.
- [ ] `DEMO_PAYMENTS` boş; PayPal `live`.
- [ ] Fiyatlar (`src/lib/packages.ts`) servis maliyetlerini karşılıyor.
- [ ] Yasal metinler avukat tarafından gözden geçirildi; şirket bilgileri doğru.
- [ ] Yedekler sunucu dışına da kopyalanıyor (README, "Veri ve yedek").

## 6. Güncelleme

```sh
cd /opt/trai-pro && sudo bash deploy/guncelle.sh
```

Kodu çeker, yeni imajı uygulama çalışırken derler, veritabanını `yedek/<zaman>/` klasörüne yedekler (son 10 tutulur), uygulamayı yeniden başlatır ve sağlığını bekler. Kesinti birkaç saniyedir.

## Sorun giderme

- **HTTPS açılmıyor:** `A` kaydı bu sunucuyu mu gösteriyor (`getent hosts ALANADI`), 80 ve 443 açık mı? `docker compose logs caddy`.
- **502 / site açılmıyor:** `docker compose ps`, `docker compose logs --tail 100 app`.
- **E-posta gitmiyor:** Kurulum durumunda e-posta testi; port 587 (STARTTLS) ya da 465 (TLS); SPF/DKIM.
- **Önceki sürüme dönme:**

  ```sh
  git log --oneline -5                 # dönülecek sürümü seçin
  git checkout <sürüm> && docker compose up -d --build
  ```

  Veritabanını da geri almak gerekirse (güncellemeden önceki yedek):

  ```sh
  docker compose stop app
  docker compose run --rm --no-deps --user root -v "$PWD/yedek/<zaman>:/yedek" --entrypoint sh app \
    -c 'rm -f /data/trai-pro.db-wal /data/trai-pro.db-shm && cp /yedek/trai-pro.db* /data/ && chown node:node /data/trai-pro.db*'
  docker compose up -d
  ```

  Sorun giderilince `git checkout main` ile ana dala dönün; `guncelle.sh` yalnız ana dalda çalışır.

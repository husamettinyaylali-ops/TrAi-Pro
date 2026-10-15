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
| `/terms-of-service`, `/privacy-policy`, `/refund-policy`, `/acceptable-use-policy` | Yasal şablon metinler |

## Durum: demo modu

Arka uç henüz yok. Hesap, kredi, sipariş ve üretim geçmişi tarayıcının `localStorage` alanında tutulur; gerçek ödeme alınmaz, şifre saklanmaz. Seslendirme önizlemesi tarayıcının konuşma sentezini, görsel/video sonuçları örnek görselleri kullanır. Yayına almak için gereken bağlantılar:

- Kimlik doğrulama (sunucu tarafı oturum)
- Ödeme sağlayıcısı (ör. iyzico, Stripe)
- Ses, görsel ve video üretimi için yapay zeka API'leri
- Kredi ve siparişlerin sunucuda tutulması

## Geliştirme

Node.js 22+ gerekir.

```sh
npm i
npm run dev        # http://localhost:8080
npm test           # vitest
npm run lint
npx tsc --noEmit
npm run build
```

## Yapı

- `src/routes/` — dosya tabanlı rotalar (TanStack Start). `routeTree.gen.ts` otomatik üretilir.
- `src/lib/credits.ts` — kredi hesapları (saf fonksiyonlar, `src/test/credits.test.ts` ile korunur)
- `src/lib/packages.ts` — paket fiyatları, kayıt bonusu, iletişim bilgileri
- `src/lib/i18n.tsx` — tüm arayüz metinleri (TR/EN)
- `src/lib/store.tsx` — demo hesap ve kredi durumu
- `src/components/site/` — site iskeleti, paket kartları, giriş formu, yasal sayfa
- `src/components/labs/` — stüdyo araçları
- `src/styles.css` — renk token'ları (koyu varsayılan, `html.light` açık tema)

Proje [Lovable](https://lovable.dev) ile başlatıldı; özgün Lovable deposu `lovable` uzak adıyla duruyor.

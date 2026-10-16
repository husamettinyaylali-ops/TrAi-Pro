import type { Lang } from "./i18n";

export type LegalDoc = "terms" | "privacy" | "refund" | "acceptable";

interface Section {
  h: string;
  p: string;
}

export const legalUpdated = "2026-10-16";

// Şablon metinlerdir; yayından önce hukuk danışmanıyla gözden geçirilmelidir.
export const legalContent: Record<LegalDoc, Record<Lang, Section[]>> = {
  terms: {
    tr: [
      {
        h: "1. Hizmetin kapsamı",
        p: "TrAi Pro; metinden ses, ses klonlama, görsel ve video üretimi araçlarını kredi tabanlı olarak sunar. Araçlar web stüdyosundan ve geliştirici API'sinden kullanılabilir. Hizmetin özellikleri önceden duyurularak değiştirilebilir.",
      },
      {
        h: "2. Hesap",
        p: "Hesap oluştururken doğru bilgi vermek ve giriş bilgilerini korumak kullanıcının sorumluluğundadır. Hesap başkasına devredilemez. Deneme kredisi, e-posta adresi doğrulanan hesaba bir kez tanımlanır.",
      },
      {
        h: "3. Bakiye ve krediler",
        p: "Hizmet ön ödemelidir: hesaba USD bakiye yüklenir, kredi paketleri bu bakiyeden alınır. Bakiye ve krediler başka hesaba aktarılamaz. Krediler satın alınan paketin kullanım süresi boyunca geçerlidir; süresi dolan krediler iade edilmez ve başka pakete aktarılmaz.",
      },
      {
        h: "4. API kullanımı",
        p: "API anahtarları kişiye özeldir ve gizli tutulmalıdır; bir anahtarla yapılan tüm işlemlerden hesap sahibi sorumludur. Sızdığından şüphelenilen anahtar Hesabım sayfasından iptal edilmelidir. Kötüye kullanılan anahtarlar uyarı yapılmadan iptal edilebilir.",
      },
      {
        h: "5. Üretilen içerik",
        p: "Kabul Edilebilir Kullanım Politikası'na uygun olarak üretilen içeriklerin kullanım hakkı kullanıcıya aittir. Kullanıcı, girdiği metin ve yüklediği dosyalar üzerinde gerekli haklara sahip olduğunu kabul eder.",
      },
      {
        h: "6. Sorumluluğun sınırı",
        p: "Hizmet olduğu gibi sunulur. Yapay zeka çıktıları hata içerebilir; yayından önce kontrol etmek kullanıcının sorumluluğundadır.",
      },
    ],
    en: [
      {
        h: "1. Scope of service",
        p: "TrAi Pro offers text-to-speech, voice cloning, image and video generation tools on a credit basis, through the web Studio and the developer API. Features may change with prior notice.",
      },
      {
        h: "2. Account",
        p: "You are responsible for giving accurate information and keeping your sign-in details safe. Accounts can't be transferred. Trial credits are granted once, when the account's email address is verified.",
      },
      {
        h: "3. Balance and credits",
        p: "The service is prepaid: you top up a USD balance and buy credit packs from it. Balance and credits can't be transferred to another account. Credits are valid for the usage period of the purchased pack; expired credits are not refunded or transferred to another pack.",
      },
      {
        h: "4. API use",
        p: "API keys are personal and must be kept secret; the account holder is responsible for everything done with a key. Revoke a key on My Account if you suspect it leaked. Keys used abusively may be revoked without notice.",
      },
      {
        h: "5. Generated content",
        p: "Content generated in line with the Acceptable Use Policy is yours to use. You confirm you hold the necessary rights to the text you enter and the files you upload.",
      },
      {
        h: "6. Limitation of liability",
        p: "The service is provided as is. AI output may contain mistakes; reviewing it before publishing is your responsibility.",
      },
    ],
  },
  privacy: {
    tr: [
      {
        h: "1. Toplanan veriler",
        p: "Ad ve e-posta; Google ile girişte Google hesap kimliği; ödeme kayıtları (tutar, yöntem ve ödeme sağlayıcısının işlem kimliği; kart bilgileri bizde değil PayPal'da işlenir); araçlara girilen metin ve istemler, üretilen ses, görsel ve video dosyaları; güvenlik için oturum bilgisi ve IP adresi.",
      },
      {
        h: "2. Kullanım amacı",
        p: "Veriler hesabın yönetimi, ödemelerin ve kredilerin takibi, üretim isteklerinin işlenmesi, kötüye kullanımın önlenmesi ve destek talepleri için kullanılır; reklam amacıyla satılmaz ve paylaşılmaz.",
      },
      {
        h: "3. Hizmet sağlayıcılar",
        p: "Hizmeti sunmak için veriler yalnız ilgili işlem için şu sağlayıcılara iletilir: ElevenLabs (seslendirme metni ve ses klonu kayıtları), fal.ai (görsel ve video istemleri), PayPal (PayPal ve kartla ödeme), Binance (Binance Pay ödemeleri), Google (Google ile giriş) ve e-posta gönderim hizmeti. Bu sağlayıcıların bir kısmı yurt dışındadır.",
      },
      {
        h: "4. Ses örnekleri",
        p: "Ses klonlama için yüklenen kayıtlar sunucularımızda saklanmaz; yalnız klonu oluşturmak üzere ElevenLabs'e iletilir. Klonu ya da hesabı sildiğinde ElevenLabs'teki ses de silinir.",
      },
      {
        h: "5. Saklama ve güvenlik",
        p: "Bağlantılar HTTPS ile şifrelenir; şifreler ve oturum anahtarları geri döndürülemez özet olarak saklanır. Hesap silindiğinde kişisel veriler (üretimler ve dosyaları, ses klonları, oturumlar, API anahtarları) silinir; ödeme ve sipariş kayıtları yasal saklama süresince ad ve e-posta olmadan tutulur. Sunucudaki günlük veritabanı yedekleri 7 gün saklanır.",
      },
      {
        h: "6. Çerezler",
        p: "Yalnız oturumu sürdürmek için zorunlu bir çerez kullanılır; dil ve tema tercihi tarayıcında saklanır. Reklam ya da izleme çerezi kullanılmaz.",
      },
      {
        h: "7. Haklar",
        p: "KVKK ve GDPR kapsamındaki erişim, düzeltme ve silme taleplerini destek adresine iletebilirsiniz. Hesabı silme işlemini Hesabım sayfasından kendiniz de yapabilirsiniz.",
      },
    ],
    en: [
      {
        h: "1. Data we collect",
        p: "Name and email; your Google account ID if you sign in with Google; payment records (amount, method and the payment provider's transaction ID; card details are processed by PayPal, not by us); the text and prompts you enter and the audio, image and video files generated; session information and IP address for security.",
      },
      {
        h: "2. Purpose",
        p: "Data is used to manage your account, track payments and credits, process generation requests, prevent abuse and answer support requests; it is never sold or shared for advertising.",
      },
      {
        h: "3. Service providers",
        p: "To provide the service, data is sent only for the relevant operation to: ElevenLabs (speech text and voice clone recordings), fal.ai (image and video prompts), PayPal (PayPal and card payments), Binance (Binance Pay payments), Google (Google sign-in) and our email delivery service. Some of these providers are outside your country.",
      },
      {
        h: "4. Voice samples",
        p: "Recordings uploaded for voice cloning are not stored on our servers; they are sent to ElevenLabs only to create the clone. When you delete the clone or your account, the voice at ElevenLabs is deleted too.",
      },
      {
        h: "5. Retention and security",
        p: "Connections are encrypted with HTTPS; passwords and session keys are stored as irreversible hashes. When you delete your account, personal data (generations and their files, voice clones, sessions, API keys) is deleted; payment and order records are kept without your name or email for the legally required period. Daily database backups on the server are kept for 7 days.",
      },
      {
        h: "6. Cookies",
        p: "We use one essential cookie to keep you signed in; your language and theme preferences are stored in your browser. No advertising or tracking cookies are used.",
      },
      {
        h: "7. Your rights",
        p: "You can send access, correction and deletion requests under KVKK and GDPR to the support address. You can also delete your account yourself on My Account.",
      },
    ],
  },
  refund: {
    tr: [
      {
        h: "1. Kullanılmamış paketler",
        p: "Hiç kredisi harcanmamış paketler için satın alma tarihinden itibaren 7 gün içinde iade talep edilebilir; paket bedeli bakiyene geri yüklenir.",
      },
      {
        h: "2. Kısmen kullanılmış paketler",
        p: "Kredisi kısmen harcanmış veya süresi dolmuş paketler iade edilmez.",
      },
      {
        h: "3. Bakiye yüklemeleri",
        p: "Kripto ödemelerde yanlış ağa, yanlış tokene ya da yanlış adrese gönderilen tutarlar geri alınamaz. Farklı tutarla ya da talebin süresi dolduktan sonra yapılan ödemeler, işlem kimliğiyle destek adresine bildirildiğinde incelenir ve doğrulanan tutar bakiyene yazılır.",
      },
      {
        h: "4. Teknik hatalar",
        p: "Servis hatası ya da içerik filtresi nedeniyle tamamlanmayan seslendirme ve görsel üretimlerinde kredi düşülmez. Başarısız olan video işlerinin kredisi otomatik olarak iade edilir.",
      },
      {
        h: "5. Başvuru",
        p: "İade taleplerinizi sipariş tarihi ve hesap e-postanızla birlikte destek adresine iletin; talepler 5 iş günü içinde yanıtlanır.",
      },
    ],
    en: [
      {
        h: "1. Unused packs",
        p: "Packs with no credits spent can be refunded within 7 days of purchase; the pack price is returned to your balance.",
      },
      {
        h: "2. Partly used packs",
        p: "Packs with some credits spent, or expired packs, are not refundable.",
      },
      {
        h: "3. Balance top-ups",
        p: "For crypto payments, amounts sent on the wrong network, in the wrong token or to the wrong address can't be recovered. Payments sent with a different amount, or after the request expired, are reviewed when you report them to the support address with the transaction ID, and the verified amount is added to your balance.",
      },
      {
        h: "4. Technical errors",
        p: "No credits are used for speech and image generations that don't complete due to a service error or the content filter. Credits for failed video jobs are refunded automatically.",
      },
      {
        h: "5. How to apply",
        p: "Send refund requests with your order date and account email to the support address; requests are answered within 5 business days.",
      },
    ],
  },
  acceptable: {
    tr: [
      {
        h: "1. İzinsiz ses klonlama",
        p: "Sahibinin açık izni olmadan başka bir kişinin sesi klonlanamaz; kamu figürlerini taklit eden içerik üretilemez.",
      },
      {
        h: "2. Yanıltıcı içerik",
        p: "Dolandırıcılık, sahte kimlik, seçim manipülasyonu veya kişileri yanıltmaya yönelik içerik üretmek yasaktır.",
      },
      {
        h: "3. Zararlı içerik",
        p: "Nefret söylemi, taciz, şiddete teşvik, çocukları içeren cinsel içerik ve yasa dışı faaliyetler yasaktır.",
      },
      {
        h: "4. Fikri mülkiyet",
        p: "Telif hakkıyla korunan metin, görsel veya sesleri izinsiz kullanarak içerik üretmek yasaktır.",
      },
      {
        h: "5. Yaptırımlar",
        p: "Bu politikayı ihlal eden hesaplar uyarılmadan askıya alınabilir ve kalan kredileri iade edilmez.",
      },
    ],
    en: [
      {
        h: "1. Unauthorized voice cloning",
        p: "You may not clone another person's voice without their explicit permission or create content impersonating public figures.",
      },
      {
        h: "2. Deceptive content",
        p: "Content for fraud, fake identities, election manipulation or otherwise misleading people is prohibited.",
      },
      {
        h: "3. Harmful content",
        p: "Hate speech, harassment, incitement to violence, sexual content involving minors and illegal activity are prohibited.",
      },
      {
        h: "4. Intellectual property",
        p: "Generating content from copyrighted text, images or audio without permission is prohibited.",
      },
      {
        h: "5. Enforcement",
        p: "Accounts that violate this policy may be suspended without notice, and remaining credits are not refunded.",
      },
    ],
  },
};

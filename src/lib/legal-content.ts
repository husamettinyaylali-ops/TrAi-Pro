import type { Lang } from "./i18n";

export type LegalDoc = "terms" | "privacy" | "refund" | "acceptable";

interface Section {
  h: string;
  p: string;
}

export const legalUpdated = "2026-10-15";

// Şablon metinlerdir; yayından önce hukuk danışmanıyla gözden geçirilmelidir.
export const legalContent: Record<LegalDoc, Record<Lang, Section[]>> = {
  terms: {
    tr: [
      {
        h: "1. Hizmetin kapsamı",
        p: "TrAi Pro; metinden ses, ses klonlama, görsel ve video üretimi araçlarını kredi tabanlı olarak sunar. Hizmetin özellikleri önceden duyurularak değiştirilebilir.",
      },
      {
        h: "2. Hesap",
        p: "Hesap oluştururken doğru bilgi vermek ve giriş bilgilerini korumak kullanıcının sorumluluğundadır. Hesap başkasına devredilemez.",
      },
      {
        h: "3. Krediler",
        p: "Krediler satın alınan paketin kullanım süresi boyunca geçerlidir. Süresi dolan krediler iade edilmez ve başka pakete aktarılmaz.",
      },
      {
        h: "4. Üretilen içerik",
        p: "Kabul Edilebilir Kullanım Politikası'na uygun olarak üretilen içeriklerin kullanım hakkı kullanıcıya aittir. Kullanıcı, girdiği metin ve yüklediği dosyalar üzerinde gerekli haklara sahip olduğunu kabul eder.",
      },
      {
        h: "5. Sorumluluğun sınırı",
        p: "Hizmet olduğu gibi sunulur. Yapay zeka çıktıları hata içerebilir; yayından önce kontrol etmek kullanıcının sorumluluğundadır.",
      },
    ],
    en: [
      {
        h: "1. Scope of service",
        p: "TrAi Pro provides text-to-speech, voice cloning, image and video generation tools on a credit basis. Features may change with prior notice.",
      },
      {
        h: "2. Account",
        p: "You are responsible for providing accurate information and keeping your sign-in details safe. Accounts are not transferable.",
      },
      {
        h: "3. Credits",
        p: "Credits are valid for the usage period of the purchased pack. Expired credits are not refunded or transferred to another pack.",
      },
      {
        h: "4. Generated content",
        p: "You hold the usage rights to content generated in line with the Acceptable Use Policy. You confirm you hold the necessary rights to the text and files you provide.",
      },
      {
        h: "5. Limitation of liability",
        p: "The service is provided as is. AI output may contain errors; reviewing it before publishing is your responsibility.",
      },
    ],
  },
  privacy: {
    tr: [
      {
        h: "1. Toplanan veriler",
        p: "Ad, e-posta, ödeme kayıtları ile araçlara girilen metin ve yüklenen ses dosyaları hizmeti sunmak amacıyla işlenir.",
      },
      {
        h: "2. Kullanım amacı",
        p: "Veriler hesabın yönetimi, kredilerin takibi, üretim isteklerinin işlenmesi ve destek talepleri için kullanılır; reklam amacıyla satılmaz.",
      },
      {
        h: "3. Ses örnekleri",
        p: "Ses klonlama için yüklenen kayıtlar yalnız ilgili klonu üretmek için kullanılır ve kullanıcı klonu sildiğinde silinir.",
      },
      {
        h: "4. Saklama ve güvenlik",
        p: "Veriler aktarımda ve depolamada şifrelenir; yasal saklama süreleri dışında hesap silindiğinde kaldırılır.",
      },
      {
        h: "5. Haklar",
        p: "KVKK ve GDPR kapsamındaki erişim, düzeltme ve silme taleplerini destek adresine iletebilirsiniz.",
      },
    ],
    en: [
      {
        h: "1. Data we collect",
        p: "Name, email, payment records, and the text and audio files you submit to the tools are processed to provide the service.",
      },
      {
        h: "2. Purpose",
        p: "Data is used to manage your account, track credits, process generation requests and answer support requests; it is never sold for advertising.",
      },
      {
        h: "3. Voice samples",
        p: "Recordings uploaded for voice cloning are used only to create that clone and are deleted when you delete the clone.",
      },
      {
        h: "4. Retention and security",
        p: "Data is encrypted in transit and at rest, and removed when your account is deleted, except where law requires retention.",
      },
      {
        h: "5. Your rights",
        p: "You can send access, correction and deletion requests under KVKK and GDPR to the support address.",
      },
    ],
  },
  refund: {
    tr: [
      {
        h: "1. Kullanılmamış paketler",
        p: "Hiç kredisi harcanmamış paketler için satın alma tarihinden itibaren 7 gün içinde iade talep edilebilir.",
      },
      {
        h: "2. Kısmen kullanılmış paketler",
        p: "Kredisi kısmen harcanmış veya süresi dolmuş paketler iade edilmez.",
      },
      {
        h: "3. Teknik hatalar",
        p: "Sistem hatası nedeniyle başarısız olan üretimlerde harcanan krediler hesaba geri yüklenir.",
      },
      {
        h: "4. Başvuru",
        p: "İade taleplerinizi sipariş tarihi ve hesap e-postanızla birlikte destek adresine iletin; talepler 5 iş günü içinde yanıtlanır.",
      },
    ],
    en: [
      {
        h: "1. Unused packs",
        p: "Packs with no credits spent can be refunded within 7 days of purchase.",
      },
      {
        h: "2. Partly used packs",
        p: "Packs with some credits spent, or expired packs, are not refundable.",
      },
      {
        h: "3. Technical errors",
        p: "Credits spent on generations that fail due to a system error are returned to your account.",
      },
      {
        h: "4. How to apply",
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

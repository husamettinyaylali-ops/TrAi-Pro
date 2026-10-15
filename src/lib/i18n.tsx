import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "tr" | "en";

const tr = {
  nav: { voice: "Ses AI", media: "Video & Görsel", pricing: "Fiyatlandırma" },
  signIn: "Giriş Yap",
  signUp: "Kayıt Ol",
  signUpNow: "Hemen Kayıt Ol",
  signOut: "Çıkış Yap",
  openLabs: "Stüdyoya Git",
  menu: "Menü",
  close: "Kapat",
  account: "Hesabım",
  soon: "Yakında",
  theme: { toLight: "Açık temaya geç", toDark: "Koyu temaya geç" },
  demoNote:
    "Demo modu: ödemeler gerçek değildir; ses, görsel ve video sonuçları önizleme amaçlıdır.",
  loading: "Yükleniyor…",

  hero: {
    badge: "Yeni: Ses Klonlama v3 yayında",
    title: "Yapay Zeka ile İçerik Üretiminde Sınırları Aşın",
    sub: "1000+ gerçekçi yapay zeka sesi, ses klonlama, metinden video ve görsel üretimi. Abonelik yok; kredini al, kullandığın kadar öde.",
    tts: "Metinden Ses",
    ttsSample: "Merhaba! Ben TrAi Pro, içeriklerinize hayat veriyorum.",
    imgGen: "Görsel Üret",
    imgPrompt: "neon İstanbul, gün batımı, sinematik",
    generate: "Üret",
    generating: "Üretiliyor…",
  },

  packages: {
    voiceTitle: "Ses AI Kredi Paketleri",
    voiceSub: "Seslendirme hacmine göre bir paket seç; kredin 30 gün boyunca geçerli.",
    mediaTitle: "Video & Görsel AI Paketleri",
    mediaSub: "Yoğun üretim dönemleri için gün bazlı, esnek paketler.",
    credits: (n: string) => `${n} Kredi`,
    days: (n: number) => `${n} gün`,
    popular: "Popüler",
    creditAmount: "Kredi miktarı",
    usagePeriod: "Kullanım süresi",
    unitPrice: "Birim fiyat",
    perDollar: (n: string) => `1 $ ≈ ${n} kredi`,
    mediaName: "Video & Görsel AI",
    mediaIncludes: (n: string) => `Video veya görsel için ${n} kredi`,
    select: "Paketi Seç",
  },

  pricing: {
    title: "Fiyatlandırma",
    sub: "Abonelik yok, gizli ücret yok. Kredini al, süresi içinde dilediğin araçta kullan.",
    costTitle: "Krediler nasıl harcanır?",
    costRows: [
      ["Metinden ses", "1 karakter = 1 kredi"],
      ["Görsel üretimi", "Görsel başına 1 kredi"],
      ["Video üretimi", "Video başına 5 kredi"],
      ["Ses klonlama", "Ücretsiz, hesap başına 5 ses"],
    ] as [string, string][],
    faqTitle: "Sıkça Sorulan Sorular",
    faqs: [
      [
        "Kredilerin süresi dolunca ne olur?",
        "Her paketin kullanım süresi satın alma anından başlar. Süre bitince kalan krediler silinir; aynı anda birden fazla paketin olabilir ve sistem önce süresi en erken dolan paketten düşer.",
      ],
      [
        "Ses ve video kredileri birbirinin yerine geçer mi?",
        "Hayır. Ses AI kredileri yalnız seslendirmede, Video & Görsel kredileri yalnız video ve görsel üretiminde harcanır.",
      ],
      [
        "Ses klonlama için ne gerekir?",
        "En az 30 saniyelik temiz bir kayıt ve sesin sana ait olduğunu ya da sahibinden izin aldığını onaylaman yeterli.",
      ],
      [
        "Ürettiğim içerikleri ticari kullanabilir miyim?",
        "Evet. Kabul Edilebilir Kullanım Politikası'na uyduğun sürece ürettiğin içerikler senindir.",
      ],
    ] as [string, string][],
  },

  auth: {
    signInTitle: "Tekrar hoş geldin",
    signInSub: "Hesabına giriş yap ve üretmeye devam et.",
    signUpTitle: "Hesap oluştur",
    signUpSub: (n: string) =>
      `Kayıt ol ve e-postanı doğrula; ${n} deneme kredisi hesabına tanımlansın.`,
    name: "Ad Soyad",
    email: "E-posta",
    password: "Şifre",
    passwordHint: "En az 8 karakter",
    termsBefore: "",
    terms: "Kullanım Şartları",
    and: " ve ",
    privacy: "Gizlilik Politikası",
    termsAfter: "'nı okudum, kabul ediyorum.",
    noAccount: "Hesabın yok mu?",
    haveAccount: "Zaten hesabın var mı?",
    submitting: "Lütfen bekle…",
    forgot: "Şifremi unuttum",
    resetDone: "Şifren güncellendi. Yeni şifrenle giriş yap.",
    google: "Google ile devam et",
    or: "veya",
    googleTermsBefore: "Google ile devam ederek ",
    googleTermsAfter: "'nı kabul etmiş olursun.",
    errors: {
      required: "Bu alan zorunlu.",
      email: "Geçerli bir e-posta adresi gir.",
      password: "Şifre en az 8 karakter olmalı.",
      terms: "Devam etmek için şartları kabul et.",
      invalidCredentials: "E-posta veya şifre hatalı.",
      tooManyAttempts: (n: number) => `Çok fazla deneme yapıldı. ${n} dakika sonra tekrar dene.`,
      network: "Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.",
      googleUnavailable:
        "Google ile giriş şu an kullanılamıyor. E-posta ve şifreyle devam edebilirsin.",
      googleCancelled: "Google ile giriş iptal edildi.",
      googleFailed: "Google ile giriş tamamlanamadı. Tekrar dene.",
      googleUnverified: "Google hesabının e-posta adresi doğrulanmamış.",
      googleEmailInUse:
        "Bu e-posta adresiyle şifreli bir hesap var. E-posta ve şifrenle giriş yap.",
      googleAlreadyLinked: "Bu Google hesabı başka bir hesaba bağlı.",
      emailTaken: "Bu e-posta zaten kayıtlı. Giriş yapmayı dene.",
    },
  },

  labs: {
    title: "Stüdyo",
    sub: "Seslendir, sesini klonla, görsel ve video üret.",
    tabs: { tts: "Metinden Ses", clone: "Ses Klonlama", image: "Görsel", video: "Video" },
    voiceBalance: "Ses AI kredisi",
    mediaBalance: "Video & Görsel kredisi",
    expires: (d: string) => `Son kullanma: ${d}`,
    noPackage: "Aktif paket yok",
    buy: "Kredi Al",
    insufficient: "Bu işlem için yeterli kredin yok.",
    providerFailed: "Ses servisi şu an yanıt vermiyor; kredin düşülmedi. Biraz sonra tekrar dene.",
    failed: "İşlem tamamlanamadı. Tekrar dene.",
    seePackages: "Paketleri gör",
    cost: (n: string) => `${n} kredi harcanır`,
    creditsShort: "kr",
    history: "Geçmiş",
    delete: "Sil",
    demoResult: "Demo önizleme: gerçek üretim için bir yapay zeka API'si bağlanmalı.",
    tts: {
      text: "Metin",
      placeholder: "Seslendirmek istediğin metni yaz…",
      sample:
        "Teknoloji Masası'na hoş geldiniz. Bugün yapay zekanın içerik üretimini nasıl değiştirdiğini konuşacağız.",
      voice: "Ses",
      chars: (n: string, max: string) => `${n} / ${max} karakter`,
      submit: "Seslendir",
      working: "Seslendiriliyor…",
      play: "Dinle",
      stop: "Durdur",
      empty: "Henüz seslendirme yok. İlk sesini oluştur.",
      emptyText: "Seslendirmek için metin gir.",
      noSpeech: "Tarayıcın sesli önizlemeyi desteklemiyor.",
      cloned: "Klon",
      female: "Kadın",
      male: "Erkek",
      multilingual: "Çok dilli",
      download: "MP3 indir",
      serviceDown: "Ses servisine şu an ulaşılamıyor. Biraz sonra sayfayı yenile.",
      unknownVoice: "Ses",
    },
    clone: {
      name: "Ses adı",
      namePlaceholder: "ör. Benim sesim",
      file: "Ses örneği",
      fileHint: "MP3 veya WAV, en az 30 saniye, arka plan gürültüsü olmadan.",
      consent: "Bu ses bana ait ya da sahibinden açık izin aldım.",
      submit: "Sesi Klonla",
      steps: ["Yükleme", "Analiz", "Eğitim", "Hazır"],
      done: "Ses klonun hazır! Metinden Ses sekmesinde seçebilirsin.",
      limit: (n: number) => `En fazla ${n} klon oluşturabilirsin.`,
      mine: "Klonlanmış seslerin",
      none: "Henüz klonlanmış ses yok.",
      free: "Ses klonlama ücretsizdir.",
      tooBig: (mb: number) => `Dosya en fazla ${mb} MB olabilir.`,
      liveNote:
        "Sesin yapay zeka servisinde klonlanır ve yalnız senin hesabında kullanılır. Klonu sildiğinde serviste de silinir.",
      demoBadge: "Demo",
      deleteClone: "Klonu sil",
    },
    image: {
      prompt: "İstem",
      placeholder: "neon İstanbul, gün batımı, sinematik",
      count: "Adet",
      submit: "Görsel Üret",
      empty: "Henüz görsel yok.",
    },
    video: {
      prompt: "İstem",
      placeholder: "Boğaz'da süzülen fütüristik bir gemi",
      style: "Stil",
      styles: ["Sinematik", "Anime", "3D", "Belgesel"],
      submit: "Video Üret",
      empty: "Henüz video yok.",
    },
    working: "Üretiliyor…",
    locked: "Video ve görsel üretimi için aktif bir Video & Görsel paketi gerekir.",
  },

  payment: {
    title: "Ödeme",
    sub: "Paketini seç, ödeme yöntemini belirle ve kredilerin anında hesabına geçsin.",
    choose: "Paket",
    method: "Ödeme yöntemi",
    methods: { card: "Kredi / Banka Kartı", crypto: "Kripto (USDT)", bank: "Havale / EFT" },
    methodNote: "Ödemeyi tamamladığında güvenli ödeme sağlayıcısının sayfasına yönlendirilirsin.",
    summary: "Özet",
    total: "Toplam",
    pay: "Ödemeyi Tamamla",
    paying: "İşleniyor…",
    success: "Ödeme tamamlandı",
    successSub: (n: string, d: string) => `${n} kredi hesabına eklendi. Son kullanma: ${d}.`,
    goLabs: "Stüdyoya Git",
    goHistory: "Ödeme Geçmişi",
    pickFirst: "Devam etmek için bir paket seç.",
    failed: "Ödeme tamamlanamadı. Tekrar dene.",
    disabled: "Ödemeler şu an kapalı.",
  },

  history: {
    title: "Ödeme Geçmişi",
    sub: "Satın aldığın paketler ve kalan kredilerin.",
    cols: {
      date: "Tarih",
      pkg: "Paket",
      credits: "Kredi",
      amount: "Tutar",
      method: "Yöntem",
      status: "Durum",
      expires: "Son kullanma",
    },
    paid: "Ödendi",
    empty: "Henüz ödeme yok.",
    emptyCta: "Paketlere göz at",
  },

  email: {
    banner: (n: string) => `E-posta adresini doğrula; ${n} deneme kredisi hesabına tanımlansın.`,
    bannerSub:
      "Doğrulama bağlantısını e-postana gönderdik. Gelmediyse gereksiz klasörünü kontrol et.",
    resend: "Bağlantıyı tekrar gönder",
    resent: "Doğrulama e-postası gönderildi.",
    verified: "Doğrulandı",
    notVerified: "Doğrulanmadı",
    forgotTitle: "Şifreni sıfırla",
    forgotSub: "Hesabının e-posta adresini yaz; şifre sıfırlama bağlantısını gönderelim.",
    forgotSubmit: "Sıfırlama bağlantısı gönder",
    forgotSent:
      "Bu adresle kayıtlı bir hesap varsa sıfırlama bağlantısını gönderdik. Gelen kutunu ve gereksiz klasörünü kontrol et; bağlantı 1 saat geçerli.",
    resetTitle: "Yeni şifre belirle",
    resetSub: "Yeni şifreni yaz. Değişiklikten sonra tüm cihazlardaki oturumlar kapanır.",
    resetSubmit: "Şifreyi güncelle",
    requestNew: "Yeni bağlantı iste",
    verifyTitle: "E-posta doğrulama",
    verifying: "E-posta adresin doğrulanıyor…",
    verifyDone: (n: string) =>
      `E-posta adresin doğrulandı. ${n} deneme kredisi hesabına tanımlandı.`,
    backToSignIn: "Giriş sayfasına dön",
    errors: {
      invalidToken: "Bu bağlantı geçersiz ya da daha önce kullanılmış.",
      expiredToken: "Bu bağlantının süresi dolmuş.",
      invalidInput: "Şifre en az 8 karakter olmalı.",
      sendFailed: "E-posta gönderilemedi. Biraz sonra tekrar dene.",
      alreadyVerified: "E-posta adresin zaten doğrulanmış.",
    },
  },

  accountPage: {
    title: "Hesabım",
    sub: "Profilini, giriş yöntemlerini ve hesap güvenliğini yönet.",
    profile: "Profil",
    memberSince: (d: string) => `Üyelik tarihi: ${d}`,
    save: "Kaydet",
    saved: "Değişiklikler kaydedildi.",
    methods: "Giriş yöntemleri",
    password: "Şifre",
    passwordSet: "Tanımlı",
    passwordNone: "Tanımlı değil",
    google: "Google",
    googleLinked: "Bağlı",
    googleNotLinked: "Bağlı değil",
    googleLink: "Google hesabını bağla",
    googleUnlink: "Bağlantıyı kaldır",
    googleUnlinkHint:
      "Bağlantıyı kaldırmak için önce bir şifre belirle; yoksa hesabına giremezsin.",
    googleLinkedNow: "Google hesabın bağlandı. Artık Google ile de giriş yapabilirsin.",
    googleUnlinked: "Google bağlantısı kaldırıldı.",
    changePassword: "Şifreyi değiştir",
    setPassword: "Şifre belirle",
    setPasswordHint:
      "Hesabın Google ile açıldı. Şifre belirlersen e-posta ve şifreyle de giriş yapabilirsin.",
    currentPassword: "Mevcut şifre",
    newPassword: "Yeni şifre",
    passwordChanged: "Şifren güncellendi. Diğer cihazlardaki oturumlar kapatıldı.",
    sessions: "Oturumlar",
    sessionsSub: "Bu cihaz dışındaki tüm cihazlarda oturumu kapatır.",
    signOutOthers: "Diğer cihazlardan çıkış yap",
    signedOutOthers: "Diğer cihazlardaki oturumlar kapatıldı.",
    danger: "Hesabı sil",
    dangerSub:
      "Hesabın, kredilerin, siparişlerin ve üretim geçmişin kalıcı olarak silinir. Bu işlem geri alınamaz.",
    confirmEmail: "Onaylamak için e-posta adresini yaz",
    deleteButton: "Hesabımı kalıcı olarak sil",
    deleting: "Siliniyor…",
    errors: {
      unauthorized: "Oturumun kapanmış. Tekrar giriş yap.",
      invalidInput: "Girdiğin bilgileri kontrol et. Şifre en az 8 karakter olmalı.",
      invalidCredentials: "Şifre hatalı.",
      confirmMismatch: "Yazdığın e-posta adresi hesabınla eşleşmiyor.",
      noPassword: "Önce bir şifre belirle.",
    },
  },

  footer: {
    tagline: "Yapay zeka ses, video ve görsel servislerini tek hesapta, uygun maliyetle kullan.",
    services: "Hizmetler",
    apiDocs: "API Belgeleri",
    support: "Destek",
    payment: "Ödeme",
    paymentHistory: "Ödeme Geçmişi",
    contact: "Destek ile İletişim",
    rights: "Tüm hakları saklıdır.",
    legal: {
      terms: "Kullanım Şartları",
      privacy: "Gizlilik Politikası",
      refund: "İade Politikası",
      acceptable: "Kabul Edilebilir Kullanım",
    },
  },

  legal: {
    template: "Bu metin bir şablondur. Yayına almadan önce hukuk danışmanınızla gözden geçirin.",
    updated: (d: string) => `Son güncelleme: ${d}`,
  },
};

export type Dict = typeof tr;

const en: Dict = {
  nav: { voice: "Voice AI", media: "Video & Image", pricing: "Pricing" },
  signIn: "Sign In",
  signUp: "Sign Up",
  signUpNow: "Sign Up Now",
  signOut: "Sign Out",
  openLabs: "Open Studio",
  menu: "Menu",
  close: "Close",
  account: "My account",
  soon: "Soon",
  theme: { toLight: "Switch to light theme", toDark: "Switch to dark theme" },
  demoNote: "Demo mode: payments are not real; voice, image and video results are previews.",
  loading: "Loading…",

  hero: {
    badge: "New: Voice Cloning v3 is live",
    title: "Push the Limits of Content Creation with",
    sub: "1000+ realistic AI voices, voice cloning, text-to-video and image generation. No subscription: buy credits, pay only for what you use.",
    tts: "Text to Speech",
    ttsSample: "Hello! I'm TrAi Pro, bringing your content to life.",
    imgGen: "Generate Image",
    imgPrompt: "neon Istanbul, sunset, cinematic",
    generate: "Generate",
    generating: "Generating…",
  },

  packages: {
    voiceTitle: "Voice AI Credit Packs",
    voiceSub: "Pick a pack for your voiceover volume; credits stay valid for 30 days.",
    mediaTitle: "Video & Image AI Packs",
    mediaSub: "Flexible day-based packs for busy production weeks.",
    credits: (n) => `${n} Credits`,
    days: (n) => `${n} ${n === 1 ? "day" : "days"}`,
    popular: "Popular",
    creditAmount: "Credits",
    usagePeriod: "Valid for",
    unitPrice: "Unit price",
    perDollar: (n) => `$1 ≈ ${n} credits`,
    mediaName: "Video & Image AI",
    mediaIncludes: (n) => `${n} credits for videos or images`,
    select: "Choose Pack",
  },

  pricing: {
    title: "Pricing",
    sub: "No subscription, no hidden fees. Buy credits and use them in any tool before they expire.",
    costTitle: "How are credits spent?",
    costRows: [
      ["Text to speech", "1 character = 1 credit"],
      ["Image generation", "1 credit per image"],
      ["Video generation", "5 credits per video"],
      ["Voice cloning", "Free, up to 5 voices per account"],
    ],
    faqTitle: "Frequently Asked Questions",
    faqs: [
      [
        "What happens when credits expire?",
        "Each pack's validity starts at purchase. Remaining credits are removed when it ends; you can hold several packs and the one expiring soonest is used first.",
      ],
      [
        "Are voice and video credits interchangeable?",
        "No. Voice AI credits are used for voiceovers only, Video & Image credits for video and image generation only.",
      ],
      [
        "What do I need for voice cloning?",
        "A clean recording of at least 30 seconds and confirmation that the voice is yours or that you have the owner's permission.",
      ],
      [
        "Can I use my content commercially?",
        "Yes. As long as you follow the Acceptable Use Policy, what you create is yours.",
      ],
    ],
  },

  auth: {
    signInTitle: "Welcome back",
    signInSub: "Sign in to your account and keep creating.",
    signUpTitle: "Create an account",
    signUpSub: (n) => `Sign up and verify your email to get ${n} trial credits.`,
    name: "Full name",
    email: "Email",
    password: "Password",
    passwordHint: "At least 8 characters",
    termsBefore: "I have read and accept the ",
    terms: "Terms of Service",
    and: " and ",
    privacy: "Privacy Policy",
    termsAfter: ".",
    noAccount: "Don't have an account?",
    haveAccount: "Already have an account?",
    submitting: "Please wait…",
    forgot: "Forgot password?",
    resetDone: "Your password was updated. Sign in with your new password.",
    google: "Continue with Google",
    or: "or",
    googleTermsBefore: "By continuing with Google you accept the ",
    googleTermsAfter: ".",
    errors: {
      required: "This field is required.",
      email: "Enter a valid email address.",
      password: "Password must be at least 8 characters.",
      terms: "Accept the terms to continue.",
      invalidCredentials: "Incorrect email or password.",
      tooManyAttempts: (n) =>
        `Too many attempts. Try again in ${n} ${n === 1 ? "minute" : "minutes"}.`,
      network: "Couldn't reach the server. Check your connection and try again.",
      googleUnavailable:
        "Google sign-in isn't available right now. You can continue with email and password.",
      googleCancelled: "Google sign-in was cancelled.",
      googleFailed: "Google sign-in couldn't be completed. Try again.",
      googleUnverified: "Your Google account's email address isn't verified.",
      googleEmailInUse:
        "An account with a password already uses this email. Sign in with your email and password.",
      googleAlreadyLinked: "This Google account is already linked to another account.",
      emailTaken: "This email is already registered. Try signing in.",
    },
  },

  labs: {
    title: "Studio",
    sub: "Voice it, clone your voice, generate images and video.",
    tabs: { tts: "Text to Speech", clone: "Voice Cloning", image: "Image", video: "Video" },
    voiceBalance: "Voice AI credits",
    mediaBalance: "Video & Image credits",
    expires: (d) => `Expires: ${d}`,
    noPackage: "No active pack",
    buy: "Buy Credits",
    insufficient: "You don't have enough credits for this.",
    providerFailed: "The voice service isn't responding; no credits were used. Try again shortly.",
    failed: "Couldn't complete that. Try again.",
    seePackages: "See packs",
    cost: (n) => `Costs ${n} credits`,
    creditsShort: "cr",
    history: "History",
    delete: "Delete",
    demoResult: "Demo preview: connect an AI API for real generation.",
    tts: {
      text: "Text",
      placeholder: "Type the text you want to voice…",
      sample:
        "Welcome to the Tech Desk. Today we'll talk about how AI is changing content creation.",
      voice: "Voice",
      chars: (n, max) => `${n} / ${max} characters`,
      submit: "Generate Speech",
      working: "Generating…",
      play: "Play",
      stop: "Stop",
      empty: "No speech yet. Create your first one.",
      emptyText: "Enter some text to voice.",
      noSpeech: "Your browser doesn't support audio preview.",
      cloned: "Clone",
      female: "Female",
      male: "Male",
      multilingual: "Multilingual",
      download: "Download MP3",
      serviceDown: "The voice service is unreachable right now. Refresh the page in a moment.",
      unknownVoice: "Voice",
    },
    clone: {
      name: "Voice name",
      namePlaceholder: "e.g. My voice",
      file: "Voice sample",
      fileHint: "MP3 or WAV, at least 30 seconds, without background noise.",
      consent: "This voice is mine or I have the owner's explicit permission.",
      submit: "Clone Voice",
      steps: ["Upload", "Analyze", "Train", "Ready"],
      done: "Your voice clone is ready! Pick it in the Text to Speech tab.",
      limit: (n) => `You can create up to ${n} clones.`,
      mine: "Your cloned voices",
      none: "No cloned voices yet.",
      free: "Voice cloning is free.",
      tooBig: (mb) => `The file can be at most ${mb} MB.`,
      liveNote:
        "Your voice is cloned on the AI service and used only in your account. Deleting the clone removes it there too.",
      demoBadge: "Demo",
      deleteClone: "Delete clone",
    },
    image: {
      prompt: "Prompt",
      placeholder: "neon Istanbul, sunset, cinematic",
      count: "Count",
      submit: "Generate Image",
      empty: "No images yet.",
    },
    video: {
      prompt: "Prompt",
      placeholder: "A futuristic ship gliding over the Bosphorus",
      style: "Style",
      styles: ["Cinematic", "Anime", "3D", "Documentary"],
      submit: "Generate Video",
      empty: "No videos yet.",
    },
    working: "Generating…",
    locked: "An active Video & Image pack is required to generate video and images.",
  },

  payment: {
    title: "Payment",
    sub: "Pick a pack, choose a payment method and get your credits instantly.",
    choose: "Pack",
    method: "Payment method",
    methods: { card: "Credit / Debit Card", crypto: "Crypto (USDT)", bank: "Bank Transfer" },
    methodNote:
      "When you complete payment you'll be redirected to the secure payment provider's page.",
    summary: "Summary",
    total: "Total",
    pay: "Complete Payment",
    paying: "Processing…",
    success: "Payment complete",
    successSub: (n, d) => `${n} credits added to your account. Expires: ${d}.`,
    goLabs: "Open Studio",
    goHistory: "Payment History",
    pickFirst: "Pick a pack to continue.",
    failed: "Payment couldn't be completed. Try again.",
    disabled: "Payments are currently disabled.",
  },

  history: {
    title: "Payment History",
    sub: "Packs you've bought and your remaining credits.",
    cols: {
      date: "Date",
      pkg: "Pack",
      credits: "Credits",
      amount: "Amount",
      method: "Method",
      status: "Status",
      expires: "Expires",
    },
    paid: "Paid",
    empty: "No payments yet.",
    emptyCta: "Browse packs",
  },

  email: {
    banner: (n) => `Verify your email address to get ${n} trial credits.`,
    bannerSub:
      "We sent a verification link to your email. If it's not there, check your spam folder.",
    resend: "Resend link",
    resent: "Verification email sent.",
    verified: "Verified",
    notVerified: "Not verified",
    forgotTitle: "Reset your password",
    forgotSub: "Enter your account's email address and we'll send you a reset link.",
    forgotSubmit: "Send reset link",
    forgotSent:
      "If an account exists for this address, we've sent a reset link. Check your inbox and spam folder; the link is valid for 1 hour.",
    resetTitle: "Set a new password",
    resetSub: "Enter your new password. You'll be signed out on every device afterwards.",
    resetSubmit: "Update password",
    requestNew: "Request a new link",
    verifyTitle: "Email verification",
    verifying: "Verifying your email address…",
    verifyDone: (n) =>
      `Your email address is verified. ${n} trial credits were added to your account.`,
    backToSignIn: "Back to sign in",
    errors: {
      invalidToken: "This link is invalid or has already been used.",
      expiredToken: "This link has expired.",
      invalidInput: "Passwords need at least 8 characters.",
      sendFailed: "The email couldn't be sent. Try again in a moment.",
      alreadyVerified: "Your email address is already verified.",
    },
  },

  accountPage: {
    title: "My account",
    sub: "Manage your profile, sign-in methods and account security.",
    profile: "Profile",
    memberSince: (d) => `Member since ${d}`,
    save: "Save",
    saved: "Changes saved.",
    methods: "Sign-in methods",
    password: "Password",
    passwordSet: "Set",
    passwordNone: "Not set",
    google: "Google",
    googleLinked: "Linked",
    googleNotLinked: "Not linked",
    googleLink: "Link Google account",
    googleUnlink: "Unlink",
    googleUnlinkHint: "Set a password before unlinking, otherwise you can't sign in.",
    googleLinkedNow: "Your Google account is linked. You can now sign in with Google too.",
    googleUnlinked: "Google account unlinked.",
    changePassword: "Change password",
    setPassword: "Set a password",
    setPasswordHint:
      "Your account was created with Google. Set a password to also sign in with email and password.",
    currentPassword: "Current password",
    newPassword: "New password",
    passwordChanged: "Your password was updated. Sessions on other devices were signed out.",
    sessions: "Sessions",
    sessionsSub: "Signs you out on every device except this one.",
    signOutOthers: "Sign out other devices",
    signedOutOthers: "Sessions on other devices were signed out.",
    danger: "Delete account",
    dangerSub:
      "Your account, credits, orders and generation history are permanently deleted. This can't be undone.",
    confirmEmail: "Type your email address to confirm",
    deleteButton: "Permanently delete my account",
    deleting: "Deleting…",
    errors: {
      unauthorized: "Your session has ended. Sign in again.",
      invalidInput: "Check what you entered. Passwords need at least 8 characters.",
      invalidCredentials: "Incorrect password.",
      confirmMismatch: "The email you typed doesn't match your account.",
      noPassword: "Set a password first.",
    },
  },

  footer: {
    tagline: "Use AI voice, video and image services from one account, at a fair price.",
    services: "Services",
    apiDocs: "API Docs",
    support: "Support",
    payment: "Payment",
    paymentHistory: "Payment History",
    contact: "Contact Support",
    rights: "All rights reserved.",
    legal: {
      terms: "Terms of Service",
      privacy: "Privacy Policy",
      refund: "Refund Policy",
      acceptable: "Acceptable Use",
    },
  },

  legal: {
    template: "This text is a template. Review it with your legal counsel before going live.",
    updated: (d) => `Last updated: ${d}`,
  },
};

const dict: Record<Lang, Dict> = { tr, en };
const LANG_KEY = "traipro:lang";

const Ctx = createContext<{
  lang: Lang;
  t: Dict;
  setLang: (l: Lang) => void;
  locale: string;
} | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("tr");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === "tr" || saved === "en") setLangState(saved);
    } catch {
      /* depolama kapalıysa varsayılan dil kalır */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* yoksay */
    }
  };

  return (
    <Ctx.Provider
      value={{ lang, t: dict[lang], setLang, locale: lang === "tr" ? "tr-TR" : "en-US" }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n outside provider");
  return c;
}

export function useFormat() {
  const { locale } = useI18n();
  return {
    num: (n: number) => new Intl.NumberFormat(locale).format(n),
    usd: (n: number) =>
      new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(n),
    date: (iso: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso)),
    dateTime: (iso: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(iso),
      ),
  };
}

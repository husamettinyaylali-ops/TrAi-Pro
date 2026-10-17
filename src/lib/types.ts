import type { CreditKind, Grant } from "./credits";
import type { VoiceSettings } from "./voice-settings";

/** Siparişin ödeme biçimi. "balance": bakiyeden; diğerleri demo dönemin kayıtları. */
export type PaymentMethod = "card" | "crypto" | "bank" | "balance";
export type GenerationType = "tts" | "image" | "video";

/** Bakiye yükleme yöntemleri (genaipro.io'daki seçenekler) ve geliştirme için demo. */
export type TopUpMethod = "usdt_bep20" | "binance_pay" | "paypal" | "demo";

export interface WalletEntry {
  id: string;
  kind: "topup" | "purchase" | "adjust";
  amountCents: number;
  reference: string | null;
  createdAt: string;
}

export interface TopUpIntent {
  id: string;
  method: TopUpMethod;
  amountCents: number;
  /** Gönderilecek tutar; kripto yöntemlerde benzersiz tutar (USDT BEP20 "10.0347", Binance Pay "10.37"). */
  payAmount: string;
  /** Ödeme doğrulanınca bakiyeye yazılacak tutar (sent); kriptoda ödenen tutar sente aşağı yuvarlanır. */
  creditCents: number;
  payCurrency: "USDT" | "USD";
  status: "pending" | "completed" | "expired";
  createdAt: string;
  expiresAt: string;
}

/** Ödeme sayfasında hangi yöntemlerin açık olduğu ve alıcı bilgileri; sunucudan gelir. */
export interface PaymentConfig {
  demo: boolean;
  usdtBep20: { address: string } | null;
  binancePay: { binanceId: string } | null;
  paypal: { clientId: string; sandbox: boolean } | null;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Order {
  id: string;
  packageId: string;
  kind: CreditKind;
  credits: number;
  days: number;
  amountUsd: number;
  method: PaymentMethod;
  createdAt: string;
  expiresAt: string;
  status: "paid";
}

export interface Generation {
  id: string;
  type: GenerationType;
  text: string;
  voiceId?: string | undefined;
  style?: string | undefined;
  images?: number[] | undefined;
  /** Gerçek seslendirmenin dinleme adresi (yalnız sahibine sunulur); demo üretimde yok. */
  audioUrl?: string | undefined;
  /** Gerçek görsel/video dosyalarının adresleri (yalnız sahibine sunulur); demo üretimde yok. */
  fileUrls?: string[] | undefined;
  /** Altyazı adresi (`?format=srt|vtt`); demo üretimde ya da zamanlama yoksa yok. */
  subtitleUrl?: string | undefined;
  /**
   * Video ya da uzun seslendirme hazırlanıyor veya başarısız oldu (kredisi iade
   * edildi); boşsa tamamlandı.
   */
  status?: "pending" | "failed" | undefined;
  /** Arka planda seslendirilen uzun metnin ilerlemesi (parça). */
  progress?: { done: number; total: number } | undefined;
  /** Düzenleyicide oluşturulan sürüm (ücretsiz): kırpma, birleştirme ya da görsel düzenleme. */
  edit?: "trim" | "merge" | "image" | undefined;
  sourceId?: string | undefined;
  cost: number;
  createdAt: string;
  /** Kullanıcının verdiği ad; yoksa metin/istem gösterilir. */
  title?: string | undefined;
  projectId?: string | undefined;
  /** Seslendirmede kullanılan ayarlar; varsayılan ayarlarla üretildiyse yok. */
  voiceSettings?: VoiceSettings | undefined;
}

/** Altyazı satırı: zamanlar milisaniye, metin en çok iki satır. */
export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type EditErrorCode = "unauthorized" | "invalidInput" | "notFound";

/** Kullanıcının çalışma alanı; üretimler bir projede toplanır. */
export interface Project {
  id: string;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** Projedeki üretim sayıları, türe göre. */
  counts: Record<GenerationType, number>;
}

export type ProjectErrorCode = "unauthorized" | "notFound" | "invalidInput" | "limit";

/** Stüdyo geçmişinin bir sayfası; `next` sonraki (daha eski) sayfanın imleci. */
export interface GenerationPage {
  items: Generation[];
  next: string | null;
}

export interface ClonedVoice {
  id: string;
  name: string;
  createdAt: string;
  /** Sağlayıcıda gerçekten klonlandı mı (demo klonda false). */
  live: boolean;
}

/** Stüdyonun çalışma kipi ve ses kataloğu; sunucudan gelir. */
export interface StudioConfig {
  /** "live": ElevenLabs bağlı; "demo": tarayıcı önizlemesi. */
  tts: "live" | "demo";
  /** Gerçek ses klonlama açık mı. */
  cloning: boolean;
  /** "live": görsel üretim servisi bağlı; "demo": örnek görseller. */
  image: "live" | "demo";
  /** "live": video üretim servisi bağlı; "demo": örnek görseller. */
  video: "live" | "demo";
  /** Hazır sesler (live kipte sağlayıcıdan). */
  voices: { id: string; name: string; gender: "female" | "male" | null }[];
}

export interface UserData {
  grants: Grant[];
  orders: Order[];
  clones: ClonedVoice[];
  security: { hasPassword: boolean; googleLinked: boolean; emailVerified: boolean };
  wallet: { balanceCents: number; entries: WalletEntry[]; pending: TopUpIntent[] };
}

export interface SessionPayload {
  user: Account;
  data: UserData;
  /** Yönetim paneline erişim (yalnız menüyü göstermek için; yetki sunucuda denetlenir). */
  admin: boolean;
}

/**
 * Üretim isteği; maliyet istemciden alınmaz, sunucuda hesaplanır. `projectId`
 * kullanıcının kendi projesi değilse yok sayılır; `title` düzeltilen sürüme
 * eski kaydın adını taşır.
 */
export type GenerateInput = (
  | { type: "tts"; text: string; voiceId: string; settings?: VoiceSettings | undefined }
  | { type: "image"; text: string; count: number }
  | { type: "video"; text: string; styleIndex: number }
) & { projectId?: string | undefined; title?: string | undefined };

export type AuthErrorCode = "emailTaken" | "invalidCredentials";
/** Çok fazla deneme; istemci bekleme süresini gösterir. */
export interface RateLimited {
  ok: false;
  error: "tooManyAttempts";
  retryAfterMinutes: number;
}

export type GoogleErrorCode =
  | "googleUnavailable"
  | "googleCancelled"
  | "googleFailed"
  | "googleUnverified"
  | "googleEmailInUse"
  | "googleAlreadyLinked";

export type TokenErrorCode = "invalidToken" | "expiredToken";
export type EmailErrorCode = "alreadyVerified" | "sendFailed";

export type AccountErrorCode =
  "unauthorized" | "invalidInput" | "invalidCredentials" | "confirmMismatch" | "noPassword";
export type ActionErrorCode =
  | "unauthorized"
  | "insufficient"
  | "invalidInput"
  | "limit"
  | "paymentsDisabled"
  /** Ses servisi yanıt vermedi ya da hata döndü; kredi düşülmez. */
  | "providerFailed"
  /** USD bakiye paket fiyatını karşılamıyor. */
  | "insufficientBalance"
  /** İstek ya da çıktı sağlayıcının güvenlik filtresine takıldı; kredi düşülmez. */
  | "contentRejected";

export type TopUpErrorCode =
  | "unauthorized"
  | "invalidInput"
  /** Bu yöntem kapalı (yapılandırılmamış). */
  | "methodDisabled"
  /** Benzersiz kripto tutarı üretilemedi (çok fazla bekleyen talep). */
  | "busy";

/** Kripto ödeme doğrulamasının sonuçları. */
export type ClaimErrorCode =
  | "unauthorized"
  | "invalidInput"
  | "methodDisabled"
  /** Kullanıcının bu yöntemde bekleyen talebi yok (süresi dolmuş olabilir). */
  | "noPending"
  /** İşlem zincirde/serviste bulunamadı. */
  | "notFound"
  /** İşlem başarısız olmuş. */
  | "failed"
  /** İşlem, alıcıya USDT transferi değil. */
  | "noTransfer"
  /** Henüz yeterli onay yok; biraz sonra tekrar denenir. */
  | "unconfirmed"
  /** Gönderilen tutar bekleyen benzersiz tutarla eşleşmiyor. */
  | "amountMismatch"
  /** İşlem, talepten önce yapılmış. */
  | "tooOld"
  /** Bu işlem daha önce kullanılmış. */
  | "duplicateRef"
  /** Zincire/servise ulaşılamadı. */
  | "providerFailed"
  /** Kart ya da PayPal hesabı ödemeyi reddetti; başka bir kaynakla denenir. */
  | "declined";

// ---------------------------------------------------------------- yönetim paneli

export type AdminErrorCode =
  | "unauthorized"
  /** Oturum var ama yönetici değil. */
  | "forbidden"
  | "notFound"
  | "invalidInput"
  /** Düzeltme sonrası bakiye eksiye düşerdi. */
  | "negativeBalance"
  /** Yönetici kendi hesabında işlem yapamaz. */
  | "selfAction"
  /** Talep zaten tamamlanmış. */
  | "alreadyCompleted"
  /** Bu sağlayıcı işlem kimliği başka bir talepte kullanılmış. */
  | "duplicateRef";

/** Kurulum kontrolündeki bir servis ya da ayar grubu. */
export type SetupId =
  "site" | "email" | "tts" | "fal" | "google" | "usdt" | "binance" | "paypal" | "backup";

/** ready: çalışır; missing: gerekli anahtar eksik; warning: çalışır ama dikkat; optional: kullanılmıyor. */
export type SetupState = "ready" | "missing" | "warning" | "optional";

export type SetupWarning =
  | "demoPaymentsOn"
  | "invalidAddress"
  | "invalidBinanceId"
  | "paypalSandbox"
  | "paypalWebhookMissing"
  | "backupMissing"
  | "noPaymentMethod";

/** Gizli olmayan bilgi (adres kısaltılmış); gizli anahtarların değeri hiç dönmez. */
export interface SetupInfo {
  key:
    | "publicUrl"
    | "domain"
    | "from"
    | "smtpHost"
    | "model"
    | "imageModel"
    | "videoModel"
    | "callback"
    | "address"
    | "rpc"
    | "binanceId"
    | "mode"
    | "webhook"
    | "admins"
    | "backupDir"
    | "retention";
  value: string;
}

export interface SetupItem {
  id: SetupId;
  state: SetupState;
  /** Eksik ortam değişkenlerinin adları (değerler asla). */
  missing: string[];
  warnings: SetupWarning[];
  info: SetupInfo[];
  testable: boolean;
}

export type SetupTestCode =
  | "voices"
  | "keyAccepted"
  | "keyRejected"
  | "sent"
  | "outbox"
  | "blockNumber"
  | "historyOk"
  | "tokenOk"
  | "notConfigured"
  | "httpError"
  | "network";

export interface SetupTestResult {
  ok: boolean;
  code: SetupTestCode;
  /** Sayı, durum kodu ya da kısaltılmış adres; gizli bilgi içermez. */
  value?: string | undefined;
}

export interface AdminOverview {
  users: number;
  deletedUsers: number;
  /** Tüm kullanıcıların bakiyeleri toplamı (sent): kullanıcılara borç. */
  liabilityCents: number;
  /** Son 24 saatte tamamlanan gerçek bakiye yüklemeleri (demo hariç, sent). */
  topUps24hCents: number;
  pendingIntents: number;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  verified: boolean;
  deletedAt: string | null;
  balanceCents: number;
}

export interface AdminAction {
  id: string;
  adminEmail: string;
  action: "adjustBalance" | "completeIntent";
  targetUserId: string | null;
  targetEmail: string | null;
  reason: string;
  /** Bakiyeye etkisi (sent). */
  amountCents: number | null;
  createdAt: string;
}

export interface AdminUserDetail {
  user: AdminUserRow;
  entries: WalletEntry[];
  intents: (TopUpIntent & { providerRef: string | null })[];
  orders: Order[];
  actions: AdminAction[];
}

export interface AdminIntentRow extends TopUpIntent {
  providerRef: string | null;
  userId: string;
  userEmail: string;
}

/** Hesap sayfasında listelenen API anahtarı (anahtarın kendisi yalnız oluşturulurken görünür). */
export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

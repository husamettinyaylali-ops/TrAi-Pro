import type { CreditKind, Grant } from "./credits";

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
  /** Gönderilecek tutar; kripto yöntemlerde benzersiz 4 ondalıklı tutar (ör. "10.0347"). */
  payAmount: string;
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
  cost: number;
  createdAt: string;
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
  /** Hazır sesler (live kipte sağlayıcıdan). */
  voices: { id: string; name: string; gender: "female" | "male" | null }[];
}

export interface UserData {
  grants: Grant[];
  orders: Order[];
  generations: Generation[];
  clones: ClonedVoice[];
  security: { hasPassword: boolean; googleLinked: boolean; emailVerified: boolean };
  wallet: { balanceCents: number; entries: WalletEntry[]; pending: TopUpIntent[] };
}

export interface SessionPayload {
  user: Account;
  data: UserData;
}

/** Üretim isteği; maliyet istemciden alınmaz, sunucuda hesaplanır. */
export type GenerateInput =
  | { type: "tts"; text: string; voiceId: string }
  | { type: "image"; text: string; count: number }
  | { type: "video"; text: string; styleIndex: number };

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
  | "insufficientBalance";

export type TopUpErrorCode =
  | "unauthorized"
  | "invalidInput"
  /** Bu yöntem kapalı (yapılandırılmamış). */
  | "methodDisabled"
  /** Benzersiz kripto tutarı üretilemedi (çok fazla bekleyen talep). */
  | "busy";

import type { CreditKind, Grant } from "./credits";

export type PaymentMethod = "card" | "crypto" | "bank";
export type GenerationType = "tts" | "image" | "video";

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
  | "providerFailed";

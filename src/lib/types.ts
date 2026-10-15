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
  cost: number;
  createdAt: string;
}

export interface ClonedVoice {
  id: string;
  name: string;
  createdAt: string;
}

export interface UserData {
  grants: Grant[];
  orders: Order[];
  generations: Generation[];
  clones: ClonedVoice[];
  security: { hasPassword: boolean; googleLinked: boolean };
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

export type AccountErrorCode =
  "unauthorized" | "invalidInput" | "invalidCredentials" | "confirmMismatch" | "noPassword";
export type ActionErrorCode =
  "unauthorized" | "insufficient" | "invalidInput" | "limit" | "paymentsDisabled";

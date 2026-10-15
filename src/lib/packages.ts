import type { CreditKind } from "./credits";

export interface CreditPackage {
  id: string;
  kind: CreditKind;
  credits: number;
  days: number;
  priceUsd: number;
  popular?: boolean;
}

// Fiyatlar yer tutucudur; yayından önce burada güncelleyin.
export const voicePackages: CreditPackage[] = [
  { id: "voice-250k", kind: "voice", credits: 250_000, days: 30, priceUsd: 8 },
  { id: "voice-1m", kind: "voice", credits: 1_000_000, days: 30, priceUsd: 22, popular: true },
];

export const mediaPackages: CreditPackage[] = [
  { id: "media-2d", kind: "media", credits: 100, days: 2, priceUsd: 3 },
  { id: "media-6d", kind: "media", credits: 300, days: 6, priceUsd: 8, popular: true },
];

export const allPackages = [...voicePackages, ...mediaPackages];

export function findPackage(id: string | undefined): CreditPackage | undefined {
  return allPackages.find((p) => p.id === id);
}

/** Kayıtta tanımlanan deneme kredisi. */
export const signupBonus = { kind: "voice" as const, credits: 5_000, days: 7 };

export const site = {
  email: "hello@traipro.ai",
  social: {
    whatsapp: "https://wa.me/905000000000",
    telegram: "",
    youtube: "",
  },
};

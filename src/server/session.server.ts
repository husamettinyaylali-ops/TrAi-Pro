import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "trai_session";
export const SESSION_DAYS = 30;

/** Çereze yazılan rastgele oturum token'ı (256 bit). */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Veritabanında token yerine bu özet saklanır. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

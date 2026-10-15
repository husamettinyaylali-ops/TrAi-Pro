import { createHash, randomBytes } from "node:crypto";

import { env } from "./env.server";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/** GOOGLE_CLIENT_ID ve GOOGLE_CLIENT_SECRET tanımlı değilse Google girişi kapalıdır. */
export function googleConfig(): GoogleConfig | null {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const randomToken = () => randomBytes(32).toString("base64url");

/** PKCE S256: code_challenge = BASE64URL(SHA256(code_verifier)). */
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

export function buildAuthUrl(
  cfg: GoogleConfig,
  opts: { redirectUri: string; state: string; verifier: string },
): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: opts.state,
    code_challenge: pkceChallenge(opts.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

/** Yetki kodunu token'a çevirir ve profili okur. Herhangi bir adım başarısızsa null. */
export async function fetchGoogleProfile(
  cfg: GoogleConfig,
  opts: { code: string; verifier: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleProfile | null> {
  const tokenRes = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
      code_verifier: opts.verifier,
    }),
  });
  if (!tokenRes.ok) return null;
  const token = (await tokenRes.json()) as { access_token?: unknown };
  if (typeof token.access_token !== "string") return null;

  const infoRes = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) return null;
  const info = (await infoRes.json()) as {
    sub?: unknown;
    email?: unknown;
    email_verified?: unknown;
    name?: unknown;
  };
  if (typeof info.sub !== "string" || typeof info.email !== "string") return null;
  const name =
    typeof info.name === "string" && info.name.trim()
      ? info.name.trim()
      : info.email.split("@")[0]!;
  return { sub: info.sub, email: info.email, emailVerified: info.email_verified === true, name };
}

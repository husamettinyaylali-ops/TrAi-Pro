import { timingSafeEqual } from "node:crypto";

import { clock } from "@/lib/clock";
import type { GoogleErrorCode } from "@/lib/types";
import { safeRedirect } from "@/lib/redirect";

import { parseCookies, serializeCookie } from "./cookies.server";
import { getDb, type Db } from "./db.server";
import { env, isProduction } from "./env.server";
import { buildAuthUrl, fetchGoogleProfile, googleConfig, randomToken } from "./google.server";
import { createSession, signInWithGoogle } from "./services.server";
import { SESSION_COOKIE } from "./session.server";

export const CALLBACK_PATH = "/auth/google/callback";

const STATE_COOKIE = "trai_oauth_state";
const VERIFIER_COOKIE = "trai_oauth_verifier";
const RETURN_COOKIE = "trai_oauth_return";
const FLOW_SECONDS = 600;

/** Yayında proxy arkasında doğru adres için PUBLIC_URL verilir; yoksa isteğin kökeni. */
const origin = (request: Request) =>
  env("PUBLIC_URL")?.replace(/\/+$/, "") ?? new URL(request.url).origin;

const callbackUrl = (request: Request) => origin(request) + CALLBACK_PATH;

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

const signInWithError = (error: GoogleErrorCode, back: string, cookies: string[] = []) =>
  redirect(`/sign-in?${new URLSearchParams({ error, redirect: back })}`, cookies);

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** GET /auth/google?redirect=… — kullanıcıyı Google onay ekranına gönderir. */
export function startGoogleSignIn(request: Request): Response {
  const back = safeRedirect(new URL(request.url).searchParams.get("redirect"));
  const cfg = googleConfig();
  if (!cfg) return signInWithError("googleUnavailable", back);

  const state = randomToken();
  const verifier = randomToken();
  const opts = { maxAge: FLOW_SECONDS, secure: isProduction() };
  return redirect(buildAuthUrl(cfg, { redirectUri: callbackUrl(request), state, verifier }), [
    serializeCookie(STATE_COOKIE, state, opts),
    serializeCookie(VERIFIER_COOKIE, verifier, opts),
    serializeCookie(RETURN_COOKIE, back, opts),
  ]);
}

export interface FinishDeps {
  db?: Db;
  fetchImpl?: typeof fetch;
  now?: Date;
}

/** GET /auth/google/callback — kodu doğrular, hesabı bulur ya da açar, oturum başlatır. */
export async function finishGoogleSignIn(
  request: Request,
  deps: FinishDeps = {},
): Promise<Response> {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get("cookie"));
  const secure = isProduction();
  const clear = [STATE_COOKIE, VERIFIER_COOKIE, RETURN_COOKIE].map((n) =>
    serializeCookie(n, "", { maxAge: 0, secure }),
  );
  const back = safeRedirect(cookies[RETURN_COOKIE]);
  const fail = (error: GoogleErrorCode) => signInWithError(error, back, clear);

  const cfg = googleConfig();
  if (!cfg) return fail("googleUnavailable");
  if (url.searchParams.get("error")) return fail("googleCancelled");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = cookies[STATE_COOKIE];
  const verifier = cookies[VERIFIER_COOKIE];
  if (!code || !state || !expected || !verifier || !sameToken(state, expected)) {
    return fail("googleFailed");
  }

  const profile = await fetchGoogleProfile(
    cfg,
    { code, verifier, redirectUri: callbackUrl(request) },
    deps.fetchImpl,
  ).catch(() => null);
  if (!profile) return fail("googleFailed");

  const db = deps.db ?? (await getDb());
  const now = deps.now ?? clock();
  const res = await signInWithGoogle(db, profile, now);
  if (!res.ok) return fail(res.error);

  const { token, expiresAt } = await createSession(db, res.userId, now);
  return redirect(back, [
    ...clear,
    serializeCookie(SESSION_COOKIE, token, { expires: expiresAt, secure }),
  ]);
}

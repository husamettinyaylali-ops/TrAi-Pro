// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { balance } from "@/lib/credits";
import { openDb, type Db } from "@/server/db.server";
import { finishGoogleSignIn, startGoogleSignIn } from "@/server/google-flow.server";
import {
  GOOGLE_TOKEN_URL,
  buildAuthUrl,
  fetchGoogleProfile,
  pkceChallenge,
  type GoogleProfile,
} from "@/server/google.server";
import {
  authenticate,
  getSessionUser,
  loadUserData,
  registerUser,
  signInWithGoogle,
} from "@/server/services.server";

const now = new Date("2026-10-15T09:00:00Z");
const cfg = { clientId: "istemci-id", clientSecret: "istemci-sir" };
const profile: GoogleProfile = {
  sub: "google-123",
  email: "Zeynep@Example.com",
  emailVerified: true,
  name: "Zeynep",
};

const dir = mkdtempSync(join(tmpdir(), "trai-google-"));
let db: Db;

beforeEach(async () => {
  db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
  process.env["GOOGLE_CLIENT_ID"] = cfg.clientId;
  process.env["GOOGLE_CLIENT_SECRET"] = cfg.clientSecret;
});

afterEach(() => {
  db.$client.close();
  delete process.env["GOOGLE_CLIENT_ID"];
  delete process.env["GOOGLE_CLIENT_SECRET"];
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

/** Google'ın token ve userinfo uç noktalarını taklit eder. */
function fakeGoogle(info: Record<string, unknown>, tokenOk = true): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === GOOGLE_TOKEN_URL) {
      return new Response(
        JSON.stringify(tokenOk ? { access_token: "erisim" } : { error: "invalid_grant" }),
        {
          status: tokenOk ? 200 : 400,
        },
      );
    }
    return new Response(JSON.stringify(info), { status: 200 });
  }) as typeof fetch;
}

describe("PKCE ve yönlendirme adresi", () => {
  it("S256 dönüşümü RFC 7636 örneğiyle aynı", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("onay adresi gerekli parametreleri taşır, gizli anahtarı taşımaz", () => {
    const url = new URL(
      buildAuthUrl(cfg, {
        redirectUri: "http://localhost:8080/auth/google/callback",
        state: "s1",
        verifier: "v1",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("istemci-id");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge("v1"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.toString()).not.toContain("istemci-sir");
  });
});

describe("profil okuma", () => {
  const opts = { code: "kod", verifier: "v", redirectUri: "http://x/cb" };

  it("token ve profil alınır", async () => {
    const p = await fetchGoogleProfile(
      cfg,
      opts,
      fakeGoogle({ sub: "1", email: "a@b.com", email_verified: true, name: "Ali" }),
    );
    expect(p).toEqual({ sub: "1", email: "a@b.com", emailVerified: true, name: "Ali" });
  });

  it("token alınamazsa null", async () => {
    expect(await fetchGoogleProfile(cfg, opts, fakeGoogle({}, false))).toBeNull();
  });

  it("ad yoksa e-postanın baş kısmı kullanılır", async () => {
    const p = await fetchGoogleProfile(
      cfg,
      opts,
      fakeGoogle({ sub: "1", email: "ayse@b.com", email_verified: false }),
    );
    expect(p).toEqual({ sub: "1", email: "ayse@b.com", emailVerified: false, name: "ayse" });
  });
});

describe("Google ile hesap", () => {
  it("ilk girişte hesap açılır, deneme kredisi tanımlanır; sonraki girişte aynı hesap", async () => {
    const first = await signInWithGoogle(db, profile, now);
    expect(first.ok && first.created).toBe(true);
    if (!first.ok) throw new Error(first.error);
    expect(balance((await loadUserData(db, first.userId)).grants, "voice", now)).toBe(5_000);

    const again = await signInWithGoogle(db, { ...profile, email: "degisti@example.com" }, now);
    expect(again).toEqual({ ok: true, userId: first.userId, created: false });
  });

  it("Google ile açılan hesaba şifreyle girilemez", async () => {
    await signInWithGoogle(db, profile, now);
    expect(
      await authenticate(db, { email: "zeynep@example.com", password: "herhangi-bir" }),
    ).toEqual({
      ok: false,
      error: "invalidCredentials",
    });
  });

  it("aynı e-postayla şifreli hesap varsa otomatik bağlanmaz", async () => {
    await registerUser(
      db,
      { name: "Z", email: "zeynep@example.com", password: "gizli-sifre-1" },
      now,
    );
    expect(await signInWithGoogle(db, profile, now)).toEqual({
      ok: false,
      error: "googleEmailInUse",
    });
  });

  it("Google e-postası doğrulanmamışsa reddedilir", async () => {
    expect(await signInWithGoogle(db, { ...profile, emailVerified: false }, now)).toEqual({
      ok: false,
      error: "googleUnverified",
    });
  });

  it("Google ile açılan e-postayla şifreli kayıt yapılamaz", async () => {
    await signInWithGoogle(db, profile, now);
    const res = await registerUser(
      db,
      { name: "X", email: "zeynep@example.com", password: "baska-sifre" },
      now,
    );
    expect(res).toEqual({ ok: false, error: "emailTaken" });
  });
});

describe("akış", () => {
  const base = "http://localhost:8080";

  it("yapılandırma yoksa giriş sayfasına hata koduyla döner", () => {
    delete process.env["GOOGLE_CLIENT_ID"];
    const res = startGoogleSignIn(new Request(`${base}/auth/google?redirect=/labs`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/sign-in?error=googleUnavailable&redirect=%2Flabs");
  });

  it("başlangıçta Google'a yönlendirir ve state/doğrulayıcı/dönüş çerezlerini yazar", () => {
    const res = startGoogleSignIn(new Request(`${base}/auth/google?redirect=https://kotu.example`));
    const location = new URL(res.headers.get("location")!);
    expect(location.hostname).toBe("accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(`${base}/auth/google/callback`);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    expect(cookies.every((c) => c.includes("HttpOnly") && c.includes("SameSite=Lax"))).toBe(true);
    // Dış adrese dönüş kabul edilmez.
    expect(cookies.find((c) => c.startsWith("trai_oauth_return="))).toContain("%2Flabs");
  });

  function callbackRequest(state: string, cookieState: string) {
    return new Request(`${base}/auth/google/callback?code=kod&state=${state}`, {
      headers: {
        cookie: `trai_oauth_state=${cookieState}; trai_oauth_verifier=v; trai_oauth_return=%2Fpricing`,
      },
    });
  }

  it("state eşleşmezse oturum açılmaz", async () => {
    const res = await finishGoogleSignIn(callbackRequest("saldirgan", "gercek"), {
      db,
      now,
      fetchImpl: fakeGoogle({ sub: "1", email: "a@b.com", email_verified: true }),
    });
    expect(res.headers.get("location")).toBe("/sign-in?error=googleFailed&redirect=%2Fpricing");
    expect(
      res.headers
        .getSetCookie()
        .some((c) => c.startsWith("trai_session=") && !c.includes("Max-Age=0")),
    ).toBe(false);
  });

  it("Google iptal ederse hata koduyla döner", async () => {
    const req = new Request(`${base}/auth/google/callback?error=access_denied&state=s`, {
      headers: { cookie: "trai_oauth_state=s; trai_oauth_verifier=v" },
    });
    const res = await finishGoogleSignIn(req, { db, now });
    expect(res.headers.get("location")).toBe("/sign-in?error=googleCancelled&redirect=%2Flabs");
  });

  it("başarılı dönüşte oturum çerezi yazılır ve dönüş adresine gidilir", async () => {
    const res = await finishGoogleSignIn(callbackRequest("ayni", "ayni"), {
      db,
      now,
      fetchImpl: fakeGoogle({
        sub: "g-9",
        email: "deniz@example.com",
        email_verified: true,
        name: "Deniz",
      }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/pricing");
    const session = res.headers.getSetCookie().find((c) => c.startsWith("trai_session="))!;
    expect(session).toContain("HttpOnly");
    const token = decodeURIComponent(session.split(";")[0]!.slice("trai_session=".length));
    expect((await getSessionUser(db, token, now))?.email).toBe("deniz@example.com");
  });
});

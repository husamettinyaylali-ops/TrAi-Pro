export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // Bozuk kodlanmış çerez yok sayılır.
    }
  }
  return out;
}

export interface CookieOptions {
  secure: boolean;
  maxAge?: number;
  expires?: Date;
}

/** Her zaman HttpOnly, SameSite=Lax ve Path=/ olarak yazılır. */
export function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

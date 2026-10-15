import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const PARAMS = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LEN = 64;

function derive(
  password: string,
  salt: Buffer,
  opts: ScryptOptions,
  keyLen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, keyLen, opts, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** Biçim: scrypt$N$r$p$tuz$özet (base64). Düz şifre hiçbir yerde saklanmaz. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS, KEY_LEN);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(
    password,
    Buffer.from(salt, "base64"),
    { N: Number(n), r: Number(r), p: Number(p) },
    expected.length,
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Bilinmeyen e-postada da aynı süreyi harcamak için kullanılan sahte özet. */
export const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(KEY_LEN).toString("base64");

// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb, type Db } from "@/server/db.server";
import { localFileStorage, type FileStorage } from "@/server/file-storage.server";
import { slugify, serveProjectZip } from "@/server/project-zip.server";
import { createProject } from "@/server/projects.server";
import { generations } from "@/server/schema.server";
import { createSession, markEmailVerified, registerUser } from "@/server/services.server";
import { SESSION_COOKIE } from "@/server/session.server";
import { dosTime, zipStream } from "@/server/zip.server";

const now = new Date("2026-10-16T09:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-zip-"));
let db: Db;
let storage: FileStorage;

beforeEach(async () => {
  db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
  storage = localFileStorage(join(dir, randomUUID()));
});
afterEach(() => db.$client.close());
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

/** Sınama için ZIP okuyucu: merkezi dizinden adları, yerel başlıktan veriyi alır, CRC'yi denetler. */
function readZip(buf: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.byteLength - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    expect(v.getUint16(p + 8, true) & 0x0800).toBe(0x0800);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    expect(crc32(data) >>> 0, name).toBe(crc);
    out.set(name, data);
    p += 46 + nameLen;
  }
  return out;
}

async function user(email: string) {
  const res = await registerUser(db, { name: "K", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, now);
  const { token } = await createSession(db, res.userId, now);
  return { id: res.userId, cookie: `${SESSION_COOKIE}=${token}` };
}

const bytes = (s: string) => new TextEncoder().encode(s);

async function row(
  userId: string,
  projectId: string,
  minute: number,
  fields: Partial<typeof generations.$inferInsert>,
) {
  await db.insert(generations).values({
    id: randomUUID(),
    userId,
    projectId,
    type: "tts",
    text: "metin",
    cost: 5,
    createdAt: new Date(now.getTime() + minute * 60_000).toISOString(),
    ...fields,
  });
}

const get = (id: string, cookie?: string, query = "") =>
  serveProjectZip(
    new Request(`https://trai.example/media/project/${id}${query}`, {
      headers: cookie ? { cookie } : {},
    }),
    id,
    { db, storage, now },
  );

describe("ZIP yazıcı", () => {
  it("zaman damgası İstanbul saatiyle; Türkçe adlar sade ASCII'ye döner", () => {
    // 09:00 UTC = 12:00 İstanbul
    expect(dosTime(now)).toEqual({ time: 12 << 11, date: (46 << 9) | (10 << 5) | 16 });
    expect(slugify("Bölüm 12: Giriş — İlk sahne!")).toBe("bolum-12-giris-ilk-sahne");
    expect(slugify("###")).toBe("kayit");
  });

  it("okunamayan dosyayı atlar ve son dosyaya bildirir", async () => {
    const stream = zipStream(
      [
        { name: "a.txt", data: async () => bytes("A") },
        { name: "eksik.mp3", data: async () => null },
      ],
      now,
      (skipped) => ({ name: "liste.txt", data: async () => bytes(skipped.join(",")) }),
    );
    const files = readZip(new Uint8Array(await new Response(stream).arrayBuffer()));
    expect([...files.keys()]).toEqual(["a.txt", "liste.txt"]);
    expect(new TextDecoder().decode(files.get("liste.txt"))).toBe("eksik.mp3");
  });
});

describe("proje ZIP'i", () => {
  it("dosyalar tür klasörlerinde, sırayla; içerik dosyası not, metin ve demo kayıtlarını listeler", async () => {
    const a = await user("a@example.com");
    const p = await createProject(db, a.id, { name: "Bölüm 12", notes: "Teslim cuma" }, now);
    if (!p.ok) throw new Error(p.error);
    const pid = p.project.id;
    await storage.put(`${a.id}/ses-1.mp3`, bytes("MP3"));
    await storage.put(`${a.id}/img-1.jpg`, bytes("JPG1"));
    await storage.put(`${a.id}/img-2.jpg`, bytes("JPG2"));
    await row(a.id, pid, 1, { title: "Giriş", text: "Merhaba", audioKey: `${a.id}/ses-1.mp3` });
    await row(a.id, pid, 2, {
      type: "image",
      text: "mavi kuş",
      files: [`${a.id}/img-1.jpg`, `${a.id}/img-2.jpg`],
    });
    await row(a.id, pid, 3, { type: "video", text: "gemi", images: [0] });
    // Projesiz kayıt arşive girmez.
    await storage.put(`${a.id}/disari.mp3`, bytes("X"));
    await db.insert(generations).values({
      id: randomUUID(),
      userId: a.id,
      type: "tts",
      text: "dışarıda",
      cost: 1,
      createdAt: now.toISOString(),
      audioKey: `${a.id}/disari.mp3`,
    });

    const res = await get(pid, a.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain('filename="bolum-12.zip"');
    const files = readZip(new Uint8Array(await res.arrayBuffer()));
    expect([...files.keys()]).toEqual([
      "ses/001-giris.mp3",
      "gorsel/002-mavi-kus-1.jpg",
      "gorsel/002-mavi-kus-2.jpg",
      "icerik.txt",
    ]);
    expect(new TextDecoder().decode(files.get("gorsel/002-mavi-kus-2.jpg"))).toBe("JPG2");
    const manifest = new TextDecoder().decode(files.get("icerik.txt"));
    expect(manifest).toContain("Proje: Bölüm 12");
    expect(manifest).toContain("Teslim cuma");
    expect(manifest).toContain("001 · Ses · Giriş");
    expect(manifest).toContain("Dosya: ses/001-giris.mp3");
    expect(manifest).toContain("003 · Video");
    expect(manifest).toContain("(Demo üretim: dosya yok)");
    expect(manifest).toContain("gemi");
  });

  it("İngilizce içerik dosyası ve klasör adları", async () => {
    const a = await user("a@example.com");
    const p = await createProject(db, a.id, { name: "Promo" }, now);
    if (!p.ok) throw new Error(p.error);
    await storage.put(`${a.id}/x.mp3`, bytes("MP3"));
    await row(a.id, p.project.id, 1, { text: "Hello", audioKey: `${a.id}/x.mp3` });
    const files = readZip(
      new Uint8Array(await (await get(p.project.id, a.cookie, "?lang=en")).arrayBuffer()),
    );
    expect([...files.keys()]).toEqual(["audio/001-hello.mp3", "contents.txt"]);
  });

  it("oturum yoksa 401, başkasının projesi 404", async () => {
    const a = await user("a@example.com");
    const b = await user("b@example.com");
    const p = await createProject(db, a.id, { name: "Gizli" }, now);
    if (!p.ok) throw new Error(p.error);
    expect((await get(p.project.id)).status).toBe(401);
    expect((await get(p.project.id, b.cookie)).status).toBe(404);
    expect((await get("yok", a.cookie)).status).toBe(404);
  });
});

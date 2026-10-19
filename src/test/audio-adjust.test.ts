// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { isNoAdjust, validAdjust } from "@/lib/audio-adjust";
import { encodeCues, parseCues } from "@/server/captions.server";
import { detectFfmpeg, ffmpegRunner, type FfmpegRun } from "@/server/compose.server";
import { openDb, type Db } from "@/server/db.server";
import { adjustArgs, adjustAudio } from "@/server/editor.server";
import { localFileStorage, type FileStorage } from "@/server/file-storage.server";
import { readMp3 } from "@/server/mp3.server";
import { generations } from "@/server/schema.server";
import { markEmailVerified, registerUser } from "@/server/services.server";

import { mp3Frames } from "./speech-fixtures";

const now = new Date("2026-10-19T14:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-adjust-test-"));
let db: Db;
let storage: FileStorage;

beforeEach(async () => {
  db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
  storage = localFileStorage(join(dir, `media-${randomUUID()}`));
});
afterEach(() => db.$client.close());
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

describe("ses ayarı kuralları", () => {
  it("hız 0,75–1,5 (0,05 adım), ses düzeyi −6…+6 dB tam sayı; değişiklik yoksa boş", () => {
    expect(validAdjust({ speed: 1.25, gainDb: -3, fade: true })).toBe(true);
    expect(validAdjust({ speed: 0.7, gainDb: 0, fade: false })).toBe(false);
    expect(validAdjust({ speed: 1.23, gainDb: 0, fade: false })).toBe(false);
    expect(validAdjust({ speed: 1, gainDb: 7, fade: false })).toBe(false);
    expect(validAdjust({ speed: 1, gainDb: 1.5, fade: false })).toBe(false);
    expect(isNoAdjust({ speed: 1, gainDb: 0, fade: false })).toBe(true);
  });

  it("ffmpeg süzgeçleri: hız, ses düzeyi (artışta sınırlayıcı), geçiş hızlanmış süreye göre", () => {
    const args = adjustArgs({ speed: 1.25, gainDb: 3, fade: true }, 10, "input.mp3", "output.mp3");
    expect(args[args.indexOf("-af") + 1]).toBe(
      "atempo=1.25,volume=3dB,alimiter=limit=0.97:level=0,afade=t=in:st=0:d=0.300,afade=t=out:st=7.700:d=0.300",
    );
    expect(args.join(" ")).toContain("-ar 44100 -c:a libmp3lame -b:a 128k");
    expect(args).not.toContain("-ac");
    expect(adjustArgs({ speed: 1, gainDb: -2, fade: false }, 4, "i", "o")).toContain("volume=-2dB");
    // Çok kısa seste geçiş sesin dörtte birini aşmaz.
    expect(adjustArgs({ speed: 1, gainDb: 0, fade: true }, 0.8, "i", "o").join(" ")).toContain(
      "afade=t=in:st=0:d=0.200,afade=t=out:st=0.600:d=0.200",
    );
  });
});

async function seed(type: "tts" | "sfx" = "tts") {
  const res = await registerUser(
    db,
    { name: "Ayar", email: `${randomUUID()}@example.com`, password: "gizli-sifre-1" },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, now);
  const id = randomUUID();
  const audioKey = `${res.userId}/${id}.mp3`;
  await storage.put(audioKey, mp3Frames(100));
  const captionsKey = type === "tts" ? `${res.userId}/${id}-captions.json` : null;
  if (captionsKey) {
    await storage.put(captionsKey, encodeCues([{ start: 1000, end: 2500, text: "Merhaba" }]));
  }
  await db.insert(generations).values({
    id,
    userId: res.userId,
    type,
    text: "Merhaba",
    voiceId: type === "tts" ? "defne" : null,
    style: type === "sfx" ? "2.5+loop" : null,
    audioKey,
    captionsKey,
    title: "Giriş",
    cost: 7,
    createdAt: now.toISOString(),
  });
  return { userId: res.userId, id };
}

/** Sahte ffmpeg: çıktı olarak `frames` çerçevelik MP3 yazar (ya da hata verir). */
function fakeRun(opts: { frames?: number; fail?: boolean } = {}) {
  const calls: string[][] = [];
  const run: FfmpegRun = async (args, cwd) => {
    calls.push(args);
    if (opts.fail) throw new Error("ffmpeg 1: hata");
    await writeFile(join(cwd, args.at(-1)!), mp3Frames(opts.frames ?? 80));
  };
  return { run, calls };
}

describe("üretim sonrası ücretsiz ayar", () => {
  it("yeni ücretsiz sürüm; altyazı hıza göre uyarlanır, kaynak değişmez", async () => {
    const { userId, id } = await seed();
    const { run, calls } = fakeRun();
    const res = await adjustAudio(
      db,
      storage,
      run,
      userId,
      { id, speed: 1.25, gainDb: 0, fade: false },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.generation).toMatchObject({
      type: "tts",
      edit: "adjust",
      cost: 0,
      sourceId: id,
      title: "Giriş",
      voiceId: "defne",
    });
    expect(calls[0]).toContain("atempo=1.25");
    const row = await db.query.generations.findFirst({
      where: (g, { eq }) => eq(g.id, res.generation.id),
    });
    expect(parseCues((await storage.read(row!.captionsKey!))!)).toEqual([
      { start: 800, end: 2000, text: "Merhaba" },
    ]);
    expect(await storage.read(`${userId}/${id}.mp3`)).toEqual(mp3Frames(100));
  });

  it("efektte süre yeni hızla değişir; yumuşak geçiş döngüyü kaldırır", async () => {
    const { userId, id } = await seed("sfx");
    const res = await adjustAudio(
      db,
      storage,
      fakeRun().run,
      userId,
      { id, speed: 1, gainDb: 0, fade: true },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.generation.effect?.loop).toBe(false);
    const faster = await adjustAudio(
      db,
      storage,
      fakeRun().run,
      userId,
      { id, speed: 1.5, gainDb: -2, fade: false },
      now,
    );
    if (!faster.ok) throw new Error(faster.error);
    expect(faster.generation.effect).toEqual({ duration: 1.7, loop: true });
  });

  it("değişiklik yok, geçersiz değer, başkasının kaydı ya da ffmpeg hatası: kayıt açılmaz", async () => {
    const { userId, id } = await seed();
    const other = await seed();
    const cases = [
      [{ id, speed: 1, gainDb: 0, fade: false }, "invalidInput", fakeRun().run],
      [{ id, speed: 2, gainDb: 0, fade: false }, "invalidInput", fakeRun().run],
      [{ id: other.id, speed: 1.1, gainDb: 0, fade: false }, "notFound", fakeRun().run],
      [{ id, speed: 1.1, gainDb: 0, fade: false }, "invalidInput", fakeRun({ fail: true }).run],
    ] as const;
    for (const [input, error, run] of cases) {
      expect(await adjustAudio(db, storage, run, userId, input, now)).toEqual({
        ok: false,
        error,
      });
    }
    expect(await db.select().from(generations)).toHaveLength(2);
  });
});

const ffmpeg = await detectFfmpeg();

describe.skipIf(!ffmpeg)("gerçek ffmpeg ile", () => {
  it("süzgeçler geçerli: hızlanan sesin süresi kısalır, mono 44,1 kHz kalır", async () => {
    const work = mkdtempSync(join(dir, "src-"));
    const runner = ffmpegRunner();
    await runner(
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=300:duration=3",
        "-ar",
        "44100",
        "-ac",
        "1",
        "-b:a",
        "128k",
        "src.mp3",
      ],
      work,
      () => {},
      AbortSignal.timeout(20_000),
    );
    const src = new Uint8Array(await readFile(join(work, "src.mp3")));
    await runner(
      adjustArgs(
        { speed: 1.5, gainDb: 4, fade: true },
        readMp3(src)!.seconds,
        "src.mp3",
        "out.mp3",
      ),
      work,
      () => {},
      AbortSignal.timeout(20_000),
    );
    const out = new Uint8Array(await readFile(join(work, "out.mp3")));
    const seconds = readMp3(out)!.seconds;
    expect(seconds).toBeGreaterThan(1.9);
    expect(seconds).toBeLessThan(2.2);
    // MPEG-1 Layer III, 44,1 kHz, mono.
    expect((out[2]! >> 2) & 3).toBe(0);
    expect(out[3]! >> 6).toBe(3);
  }, 60_000);
});

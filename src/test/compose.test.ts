// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeCues } from "@/server/captions.server";
import {
  COMPOSE_FPS,
  assSubtitles,
  detectFfmpeg,
  ffmpegArgs,
  ffmpegRunner,
  imageDurations,
  type FfmpegRun,
} from "@/server/compose.server";
import { openDb, type Db } from "@/server/db.server";
import { COMPOSE_MAX_PENDING, startCompose, type ComposeInput } from "@/server/editor.server";
import { localFileStorage, type FileStorage } from "@/server/file-storage.server";
import { composeJobs } from "@/server/jobs.server";
import { generations } from "@/server/schema.server";
import {
  failOrphanJobs,
  getGeneration,
  markEmailVerified,
  refreshPending,
  registerUser,
  removeGeneration,
} from "@/server/services.server";

import { FRAME_SECONDS, mp3Frames } from "./speech-fixtures";

const now = new Date("2026-10-17T15:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-compose-test-"));
let db: Db;
let storage: FileStorage;

/** Veritabanı ve depo yalnız onları kullanan testlerde açılır. */
function useDb() {
  beforeEach(async () => {
    db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
    storage = localFileStorage(join(dir, `media-${randomUUID()}`));
  });
  afterEach(() => db.$client.close());
}
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

const CUES = [
  { start: 0, end: 1200, text: "Merhaba {kalın} dünya" },
  { start: 1300, end: 2500, text: "İkinci\nsatır \\N" },
];

describe("video komutu ve altyazı", () => {
  it("görsel süreleri kare sınırında, toplam ses süresine eşit", () => {
    const d = imageDurations(10, 3);
    expect(d.map((x) => Math.round(x * COMPOSE_FPS))).toEqual([100, 100, 100]);
    const odd = imageDurations(1, 4);
    expect(odd.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(odd.map((x) => Math.round(x * COMPOSE_FPS))).toEqual([8, 8, 7, 7]);
  });

  it("ASS: çözünürlük, boyut, konum; biçim komutları kullanıcı metninden çıkarılır", () => {
    const ass = assSubtitles(CUES, "9:16", { show: true, position: "bottom", size: "m" });
    expect(ass).toContain("PlayResX: 1080\nPlayResY: 1920");
    // Kısa kenar 1080 × 0,065 = 70; kenar 6; alt (2), dikeyde alt boşluk 1920 × 0,14 = 269.
    expect(ass).toContain(
      "Style: Default,DejaVu Sans,70,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,0,2,86,86,269,1",
    );
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:01.20,Default,,0,0,0,,Merhaba kalın dünya");
    expect(ass).toContain("Dialogue: 0,0:00:01.30,0:00:02.50,Default,,0,0,0,,İkinci\\Nsatır /N");
    const middle = assSubtitles(CUES, "16:9", { show: true, position: "middle", size: "l" });
    expect(middle).toContain("Style: Default,DejaVu Sans,86,");
    expect(middle).toMatch(/,5,154,154,0,1\n/);
  });

  it("ffmpeg argümanları: hareketsizde döngü, hareketlide yakınlaşma; ses son girdi", () => {
    const still = ffmpegArgs({
      images: ["img-0.jpg", "img-1.png"],
      durations: [1.5, 1],
      audio: "audio.mp3",
      subtitles: "subs.ass",
      format: "1:1",
      motion: false,
      output: "out.mp4",
    });
    expect(still.slice(still.indexOf("-loop"), still.indexOf("-loop") + 7)).toEqual([
      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      "1.500",
      "-i",
    ]);
    const graph = still[still.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain(
      "[0:v]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,setsar=1,format=yuv420p[v0]",
    );
    expect(graph).toContain("[v0][v1]concat=n=2:v=1:a=0[vc]");
    expect(graph).toContain("[vc]ass=subs.ass[v]");
    expect(still).toContain("2:a");
    expect(still.at(-1)).toBe("out.mp4");

    const moving = ffmpegArgs({
      images: ["img-0.jpg"],
      durations: [2],
      audio: "audio.mp3",
      subtitles: null,
      format: "9:16",
      motion: true,
      output: "out.mp4",
    });
    expect(moving).not.toContain("-loop");
    const g2 = moving[moving.indexOf("-filter_complex") + 1]!;
    expect(g2).toContain("scale=2160:3840");
    expect(g2).toContain("zoompan=z='min(zoom+0.001667,1.1)'");
    expect(g2).toContain(":d=60:s=1080x1920:fps=30");
    expect(g2).toContain("[vc]null[v]");
  });
});

async function newUser(email = "video@example.com") {
  const res = await registerUser(db, { name: "Video", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, now);
  return res.userId;
}

async function seed(userId: string, opts: { frames?: number; captions?: boolean } = {}) {
  const audioId = randomUUID();
  const audioKey = `${userId}/${audioId}.mp3`;
  await storage.put(audioKey, mp3Frames(opts.frames ?? 100));
  const captionsKey = opts.captions === false ? null : `${userId}/${audioId}-captions.json`;
  if (captionsKey) await storage.put(captionsKey, encodeCues(CUES));
  await db.insert(generations).values({
    id: audioId,
    userId,
    type: "tts",
    text: "Merhaba dünya. İkinci satır.",
    voiceId: "defne",
    audioKey,
    captionsKey,
    title: "Giriş",
    cost: 28,
    createdAt: now.toISOString(),
  });
  const imageId = randomUUID();
  const files = [`${userId}/${imageId}-0.jpg`, `${userId}/${imageId}-1.jpg`];
  for (const k of files) await storage.put(k, new Uint8Array([0xff, 0xd8, 0xff, 1]));
  await db.insert(generations).values({
    id: imageId,
    userId,
    type: "image",
    text: "kapak",
    files,
    cost: 2,
    createdAt: now.toISOString(),
  });
  return { audioId, imageId };
}

const input = (audioId: string, imageId: string, over: Partial<ComposeInput> = {}) =>
  ({
    audioId,
    images: [
      { id: imageId, index: 1 },
      { id: imageId, index: 0 },
    ],
    format: "9:16",
    captions: { show: true, position: "bottom", size: "m" },
    motion: false,
    ...over,
  }) satisfies ComposeInput;

/** Sahte ffmpeg: argümanları ve çalışma klasörünü kaydeder, çıktı dosyasını yazar. */
function fakeRun(opts: { fail?: boolean; hang?: boolean } = {}) {
  const calls: { args: string[]; cwd: string }[] = [];
  const run: FfmpegRun = async (args, cwd, onProgress, signal) => {
    calls.push({ args, cwd });
    onProgress(1);
    if (opts.hang) {
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("durduruldu"))),
      );
    }
    if (opts.fail) throw new Error("ffmpeg 1: hata");
    await writeFile(join(cwd, "out.mp4"), new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]));
  };
  return { run, calls };
}

async function settled(userId: string, id: string) {
  return vi.waitFor(
    async () => {
      const g = await getGeneration(db, userId, id);
      if (g?.status === "pending") throw new Error("hâlâ hazırlanıyor");
      return g!;
    },
    { timeout: 5_000, interval: 20 },
  );
}

describe("kısa video oluşturma", () => {
  useDb();
  it("bekleyen ücretsiz kayıt açılır; video bitince projede dosyasıyla görünür", async () => {
    const user = await newUser();
    const { audioId, imageId } = await seed(user);
    const { run, calls } = fakeRun();
    const res = await startCompose(
      db,
      storage,
      { run, subtitles: true },
      user,
      input(audioId, imageId, { title: "Kısa" }),
      now,
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.generation).toMatchObject({
      type: "video",
      status: "pending",
      cost: 0,
      edit: "compose",
      sourceId: audioId,
      title: "Kısa",
    });
    const done = await settled(user, res.generation.id);
    expect(done.status).toBeUndefined();
    expect(done.fileUrls).toEqual([`/media/file/${done.id}/0`]);
    expect(await storage.read(`${user}/${done.id}-0.mp4`)).not.toBeNull();

    // Görseller verilen sırayla, altyazı dosyasıyla; ses süresi görsellere bölünür.
    const args = calls[0]!.args;
    expect(args.filter((a) => a.startsWith("img-"))).toEqual(["img-0.jpg", "img-1.jpg"]);
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("ass=subs.ass");
    const total = 100 * FRAME_SECONDS;
    const firstT = Number(args[args.indexOf("-t") + 1]);
    expect(firstT).toBeCloseTo(total / 2, 1);
  });

  it("altyazı istenmezse, ses altyazısızsa ya da sunucu yazamıyorsa altyazısız", async () => {
    const user = await newUser();
    const { audioId, imageId } = await seed(user);
    for (const [deps, opts] of [
      [{ subtitles: true }, { captions: { show: false, position: "bottom", size: "m" } }],
      [{ subtitles: false }, {}],
    ] as const) {
      const { run, calls } = fakeRun();
      const res = await startCompose(
        db,
        storage,
        { run, ...deps },
        user,
        input(audioId, imageId, opts),
        now,
      );
      if (!res.ok) throw new Error(res.error);
      await settled(user, res.generation.id);
      expect(calls[0]!.args.join(" ")).toContain("[vc]null[v]");
    }
  });

  it("ffmpeg hata verirse kayıt başarısız olur, dosya kalmaz", async () => {
    const user = await newUser();
    const { audioId, imageId } = await seed(user);
    const res = await startCompose(
      db,
      storage,
      { run: fakeRun({ fail: true }).run, subtitles: true },
      user,
      input(audioId, imageId),
      now,
    );
    if (!res.ok) throw new Error(res.error);
    const done = await settled(user, res.generation.id);
    expect(done.status).toBe("failed");
    expect(await storage.read(`${user}/${done.id}-0.mp4`)).toBeNull();
  });

  it(`aynı anda en çok ${COMPOSE_MAX_PENDING} video; silinen iş ffmpeg'i durdurur`, async () => {
    const user = await newUser();
    const { audioId, imageId } = await seed(user);
    const { run } = fakeRun({ hang: true });
    const first = await startCompose(
      db,
      storage,
      { run, subtitles: true },
      user,
      input(audioId, imageId),
      now,
    );
    if (!first.ok) throw new Error(first.error);
    expect(
      await startCompose(db, storage, { run, subtitles: true }, user, input(audioId, imageId), now),
    ).toEqual({ ok: false, error: "limit" });
    // 1 sn / 2,6 sn işlendi.
    await vi.waitFor(() => expect(composeJobs.get(first.generation.id)?.percent).toBe(38));
    await removeGeneration(db, user, first.generation.id, storage);
    await vi.waitFor(() => expect(composeJobs.has(first.generation.id)).toBe(false));
    expect(await getGeneration(db, user, first.generation.id)).toBeNull();
  });

  it("sunucu yeniden başlayınca yarım kalan video başarısız sayılır", async () => {
    const user = await newUser();
    const { audioId, imageId } = await seed(user);
    const { run } = fakeRun({ hang: true });
    const res = await startCompose(
      db,
      storage,
      { run, subtitles: true },
      user,
      input(audioId, imageId),
      now,
    );
    if (!res.ok) throw new Error(res.error);
    const live = await refreshPending(db, null, user, res.generation.id, now);
    expect(live.ok && live.generation.status).toBe("pending");
    expect(live.ok && live.generation.progress?.total).toBe(100);
    const job = composeJobs.get(res.generation.id)!;
    composeJobs.clear();
    expect(await failOrphanJobs(db)).toBe(1);
    expect((await getGeneration(db, user, res.generation.id))?.status).toBe("failed");
    job.cancel();
  });

  it("geçersiz istek, başkasının dosyası ve 10 dakikayı aşan ses reddedilir", async () => {
    const owner = await newUser("sahip@example.com");
    const other = await newUser("baska@example.com");
    const { audioId, imageId } = await seed(owner);
    const deps = { run: fakeRun().run, subtitles: true };
    for (const over of [
      { images: [] },
      { images: Array.from({ length: 31 }, () => ({ id: imageId, index: 0 })) },
      { format: "4:3" as never },
      { captions: { show: true, position: "top" as never, size: "m" as const } },
    ]) {
      expect(
        await startCompose(db, storage, deps, owner, input(audioId, imageId, over), now),
      ).toEqual({ ok: false, error: "invalidInput" });
    }
    for (const over of [{ images: [{ id: imageId, index: 5 }] }, { audioId: imageId }]) {
      expect(
        await startCompose(db, storage, deps, owner, input(audioId, imageId, over), now),
      ).toEqual({ ok: false, error: "notFound" });
    }
    expect(await startCompose(db, storage, deps, other, input(audioId, imageId), now)).toEqual({
      ok: false,
      error: "notFound",
    });
    const long = await seed(owner, { frames: Math.ceil(601 / FRAME_SECONDS) });
    expect(
      await startCompose(db, storage, deps, owner, input(long.audioId, long.imageId), now),
    ).toEqual({ ok: false, error: "invalidInput" });
  });
});

const ffmpeg = await detectFfmpeg();

describe.skipIf(!ffmpeg)("gerçek ffmpeg ile", () => {
  useDb();
  it("gerçek ses ve tek renk görsellerden altyazılı MP4 kodlanır", async () => {
    const user = await newUser();
    const { audioId, imageId } = await seed(user, { frames: 60 });
    // Gerçek ses ve görseller ffmpeg'le üretilir (sahte çerçeveler çözülemez).
    const work = mkdtempSync(join(dir, "src-"));
    const runner = ffmpegRunner();
    const make = (lavfi: string, out: string, extra: string[]) =>
      runner(
        ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", lavfi, ...extra, out],
        work,
        () => {},
        AbortSignal.timeout(20_000),
      );
    const copy = async (file: string, key: string) =>
      storage.put(key, new Uint8Array(await readFile(join(work, file))));
    await make("sine=frequency=440:duration=2", "a.mp3", [
      "-ar",
      "44100",
      "-ac",
      "2",
      "-b:a",
      "128k",
    ]);
    await copy("a.mp3", `${user}/${audioId}.mp3`);
    for (const [i, color] of ["red", "blue"].entries()) {
      await make(`color=c=${color}:s=320x240`, `x${i}.jpg`, ["-frames:v", "1"]);
      await copy(`x${i}.jpg`, `${user}/${imageId}-${i}.jpg`);
    }
    const res = await startCompose(
      db,
      storage,
      { run: runner, subtitles: ffmpeg!.subtitles },
      user,
      input(audioId, imageId, { format: "1:1" }),
      now,
    );
    if (!res.ok) throw new Error(res.error);
    const done = await vi.waitFor(
      async () => {
        const g = await getGeneration(db, user, res.generation.id);
        if (g?.status === "pending") throw new Error("hâlâ hazırlanıyor");
        return g!;
      },
      { timeout: 60_000, interval: 200 },
    );
    expect(done.status).toBeUndefined();
    const mp4 = (await storage.read(`${user}/${done.id}-0.mp4`))!;
    expect(new TextDecoder().decode(mp4.subarray(4, 8))).toBe("ftyp");
  }, 90_000);
});

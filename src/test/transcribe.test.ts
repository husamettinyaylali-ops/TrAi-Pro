// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { balance } from "@/lib/credits";
import { cuesFromWords, cuesToText, parseCues } from "@/server/captions.server";
import { detectFfmpeg, ffmpegRunner, type FfmpegRun } from "@/server/compose.server";
import { openDb, type Db } from "@/server/db.server";
import { mergeSpeech, trimSpeech } from "@/server/editor.server";
import { localFileStorage, type FileStorage } from "@/server/file-storage.server";
import { transcribeJobs } from "@/server/jobs.server";
import { createProject } from "@/server/projects.server";
import { handleApi, type ApiDeps } from "@/server/public-api.server";
import { generations } from "@/server/schema.server";
import {
  getGeneration,
  listGenerations,
  loadUserData,
  markEmailVerified,
  refreshPending,
  registerUser,
  removeGeneration,
} from "@/server/services.server";
import {
  STT_MAX_PENDING,
  elevenLabsStt,
  prepareArgs,
  readTranscript,
  startTranscription,
  titleFromName,
  type SttProvider,
  type Transcript,
  type TranscribeDeps,
} from "@/server/transcribe.server";
import { TtsError } from "@/server/tts.server";
import { createApiKey } from "@/server/api-keys.server";

import { FRAME_SECONDS, mp3Frames } from "./speech-fixtures";

const now = new Date("2026-10-17T15:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "trai-stt-test-"));
let db: Db;
let storage: FileStorage;

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

/** Sağlayıcı yanıtı: iki cümle, arada 3 sn sessizlik. */
const TRANSCRIPT: Transcript = {
  text: "Merhaba dünya. Bugün hava güzel.",
  language: "tur",
  words: [
    { text: "Merhaba", start: 0.1, end: 0.5 },
    { text: "dünya.", start: 0.6, end: 1.0 },
    { text: "Bugün", start: 4.0, end: 4.4 },
    { text: "hava", start: 4.5, end: 4.8 },
    { text: "güzel.", start: 4.9, end: 5.3 },
  ],
};

describe("yazıya dökme yardımcıları", () => {
  it("sağlayıcı yanıtı: boşluk ve ses olayı atılır; dil küçük harfe; metin yoksa hata", () => {
    const t = readTranscript({
      text: " Merhaba dünya. ",
      language_code: "TUR",
      words: [
        { text: "Merhaba", start: 0, end: 0.4, type: "word" },
        { text: " ", start: 0.4, end: 0.5, type: "spacing" },
        { text: "(gülüşme)", start: 0.5, end: 0.9, type: "audio_event" },
        { text: "dünya.", start: 1, end: null, type: "word" },
        { text: "dünya.", start: 1, end: 1.4, type: "word" },
      ],
    });
    expect(t).toEqual({
      text: "Merhaba dünya.",
      language: "tur",
      words: [
        { text: "Merhaba", start: 0, end: 0.4 },
        { text: "dünya.", start: 1, end: 1.4 },
      ],
    });
    expect(readTranscript({ text: "x", language_code: "<script>" }).language).toBeNull();
    expect(() => readTranscript({ words: [] })).toThrow(TtsError);
  });

  it("ElevenLabs isteği: model, dil, kelime zamanı; hata durum koduyla", async () => {
    const seen: { url: string; headers: Headers; form: FormData }[] = [];
    let status = 200;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), form: init.body as FormData });
      return status === 200
        ? Response.json({ text: "Merhaba.", language_code: "tur", words: [] })
        : new Response("hata", { status });
    }) as unknown as typeof fetch;
    const stt = elevenLabsStt({ apiKey: "test-anahtar", fetchImpl });
    const res = await stt.transcribe(mp3Frames(3), { language: "tr" });
    expect(res.text).toBe("Merhaba.");
    const req = seen[0]!;
    expect(req.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(req.headers.get("xi-api-key")).toBe("test-anahtar");
    expect(req.form.get("model_id")).toBe("scribe_v2");
    expect(req.form.get("language_code")).toBe("tr");
    expect(req.form.get("timestamps_granularity")).toBe("word");
    expect(req.form.get("tag_audio_events")).toBe("false");
    expect((req.form.get("file") as File).size).toBe(mp3Frames(3).byteLength);

    await stt.transcribe(mp3Frames(3), {});
    expect(seen[1]!.form.has("language_code")).toBe(false);
    status = 401;
    await expect(stt.transcribe(mp3Frames(3), {})).rejects.toMatchObject({ status: 401 });
  });

  it("ffmpeg: ilk ses kanalı, mono 44,1 kHz MP3, süre sınırı, meta veri yok", () => {
    const args = prepareArgs("input", "audio.mp3");
    expect(args.slice(0, 5)).toEqual(["-hide_banner", "-nostdin", "-y", "-i", "input"]);
    expect(args.join(" ")).toContain("-map 0:a:0 -vn -ac 1 -ar 44100 -c:a libmp3lame -b:a 64k");
    expect(args.join(" ")).toContain("-t 3601 -map_metadata -1 -id3v2_version 0 -write_xing 0");
    expect(args.at(-1)).toBe("audio.mp3");
  });

  it("dosya adından kayıt adı", () => {
    expect(titleFromName("toplanti_kaydi_01.m4a")).toBe("toplanti kaydi 01");
    expect(titleFromName("Röportaj.final.mp4")).toBe("Röportaj.final");
    expect(titleFromName(".mp3")).toBeUndefined();
    expect([...titleFromName(`${"ş".repeat(120)}.wav`)!]).toHaveLength(80);
  });

  it("altyazı: uzun duraklamada yeni satır; metin paragraflara ayrılır", () => {
    const cues = cuesFromWords(
      TRANSCRIPT.words.map((w) => ({ text: w.text, start: w.start * 1000, end: w.end * 1000 })),
    );
    expect(cues.map((c) => c.text)).toEqual(["Merhaba dünya.", "Bugün hava güzel."]);
    expect(cues[0]).toMatchObject({ start: 100, end: 1100 });
    expect(cuesToText(cues)).toBe("Merhaba dünya.\n\nBugün hava güzel.");
    expect(
      cuesToText([
        { start: 0, end: 900, text: "Bir iki\nüç" },
        { start: 1000, end: 2000, text: "dört." },
      ]),
    ).toBe("Bir iki üç dört.");
  });
});

// ---------------------------------------------------------------- iş

async function newUser(email = "yazi@example.com") {
  const res = await registerUser(db, { name: "Yazı", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, now);
  return res.userId;
}

const voiceCredits = async (userId: string) =>
  balance((await loadUserData(db, userId, now)).grants, "voice", now);

/** Sahte ffmpeg: çıktı olarak `frames` çerçevelik MP3 yazar (ya da hata verir). */
function fakeRun(opts: { frames?: number; fail?: boolean } = {}) {
  const calls: { args: string[]; input: Uint8Array }[] = [];
  const run: FfmpegRun = async (args, cwd) => {
    calls.push({ args, input: new Uint8Array(await readFile(join(cwd, "input"))) });
    if (opts.fail) throw new Error("ffmpeg 1: Stream map '0:a:0' matches no streams");
    await writeFile(join(cwd, args.at(-1)!), mp3Frames(opts.frames ?? 400));
  };
  return { run, calls };
}

/** Sahte servis: sırayla verilen sonuçlar (hata nesnesi atılır); bitene kadar bekletilebilir. */
function fakeStt(results: (Transcript | Error)[] = [TRANSCRIPT], gate?: Promise<void>) {
  const calls: { audio: Uint8Array; language: string | undefined }[] = [];
  const stt: SttProvider = {
    async transcribe(audio, { language }) {
      calls.push({ audio, language });
      if (gate) await gate;
      const next = results[Math.min(calls.length - 1, results.length - 1)]!;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { stt, calls };
}

function makeDeps(over: Partial<TranscribeDeps> = {}): TranscribeDeps {
  return { stt: fakeStt().stt, storage, run: fakeRun().run, retryDelayMs: 1, ...over };
}

const FILE = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);

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

describe("sesten yazıya", () => {
  useDb();

  it("dosya dönüştürülür, süreye göre kredi düşer; bitince metin, dil ve altyazı kayıtlı", async () => {
    const user = await newUser();
    const project = await createProject(db, user, { name: "Podcast" }, now);
    if (!project.ok) throw new Error(project.error);
    const ff = fakeRun({ frames: 400 });
    const svc = fakeStt();
    const res = await startTranscription(
      db,
      makeDeps({ run: ff.run, stt: svc.stt }),
      user,
      { file: FILE, name: "bolum_1.mp4", projectId: project.project.id },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    const cost = Math.ceil(400 * FRAME_SECONDS);
    expect(res.generation).toMatchObject({
      type: "stt",
      status: "pending",
      cost,
      title: "bolum 1",
      projectId: project.project.id,
      text: "",
    });
    expect(ff.calls[0]!.input).toEqual(FILE);
    expect(await voiceCredits(user)).toBe(5_000 - cost);

    const done = await settled(user, res.generation.id);
    expect(done).toMatchObject({
      status: undefined,
      text: "Merhaba dünya.\n\nBugün hava güzel.",
      language: "tur",
      audioUrl: `/media/audio/${res.generation.id}`,
      subtitleUrl: `/media/subtitle/${res.generation.id}`,
    });
    // Servise dönüştürülen MP3 gider; dil seçilmediyse algılatılır.
    expect(svc.calls[0]!.audio).toEqual(mp3Frames(400));
    expect(svc.calls[0]!.language).toBeUndefined();
    const row = await db
      .select()
      .from(generations)
      .where(eq(generations.id, res.generation.id))
      .get();
    expect(await storage.read(row!.audioKey!)).toEqual(mp3Frames(400));
    expect(parseCues((await storage.read(row!.captionsKey!))!)!.map((c) => c.text)).toEqual([
      "Merhaba dünya.",
      "Bugün hava güzel.",
    ]);
    expect(transcribeJobs.has(res.generation.id)).toBe(false);

    // Geçmişte kendi türüyle ve "ses" süzgecinde görünür.
    const own = await listGenerations(db, user, { type: "stt" });
    expect(own.items.map((g) => g.id)).toEqual([res.generation.id]);
    const audio = await listGenerations(db, user, { type: "audio" });
    expect(audio.items.map((g) => g.id)).toEqual([res.generation.id]);
    expect((await listGenerations(db, user, { type: "tts" })).items).toEqual([]);
  });

  it("seçilen dil servise gider ve kayıtta kalır; verilen ad dosya adının önüne geçer", async () => {
    const user = await newUser();
    const svc = fakeStt();
    const res = await startTranscription(
      db,
      makeDeps({ stt: svc.stt }),
      user,
      { file: FILE, name: "kayit.wav", language: "en", title: "Röportaj" },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    const done = await settled(user, res.generation.id);
    expect(svc.calls[0]!.language).toBe("en");
    expect(done).toMatchObject({ language: "en", title: "Röportaj" });
  });

  it("geçersiz girdi, okunamayan dosya ve çok kısa kayıt: kredi düşmez, kayıt açılmaz", async () => {
    const user = await newUser();
    const cases = [
      [makeDeps(), { file: new Uint8Array(), name: "bos.mp3" }],
      [makeDeps(), { file: FILE, name: "a.mp3", language: "xx" }],
      [makeDeps({ run: fakeRun({ fail: true }).run }), { file: FILE, name: "resim.jpg" }],
      [makeDeps({ run: fakeRun({ frames: 20 }).run }), { file: FILE, name: "kisa.mp3" }],
    ] as const;
    for (const [d, input] of cases) {
      expect(await startTranscription(db, d, user, input, now)).toEqual({
        ok: false,
        error: "invalidInput",
      });
    }
    expect(await voiceCredits(user)).toBe(5_000);
    expect(await db.select().from(generations)).toEqual([]);
  });

  it("kredi yetmezse dosya silinir; bekleyen iş sınırı", async () => {
    const user = await newUser();
    // 5.000 kredi: 5.000 saniyeyi aşan kayıt (en çok 1 saat) zaten reddedilir; sınırı küçük kayıtla dene.
    await db.$client.execute("update credit_grants set remaining = 3");
    const short = await startTranscription(db, makeDeps(), user, { file: FILE, name: "a" }, now);
    expect(short).toEqual({ ok: false, error: "insufficient" });
    expect(await db.select().from(generations)).toEqual([]);
    expect(transcribeJobs.size).toBe(0);
    await db.$client.execute("update credit_grants set remaining = 5000");

    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const d = makeDeps({ stt: fakeStt([TRANSCRIPT], gate).stt });
    for (let i = 0; i < STT_MAX_PENDING; i++) {
      expect((await startTranscription(db, d, user, { file: FILE, name: "a" }, now)).ok).toBe(true);
    }
    expect(await startTranscription(db, d, user, { file: FILE, name: "a" }, now)).toEqual({
      ok: false,
      error: "limit",
    });
    open();
    const rows = await db.select().from(generations);
    for (const r of rows) await settled(user, r.id);
  });

  it("servis hatası: kredi iade edilir, ses silinir; geçici hata bir kez yeniden denenir", async () => {
    const user = await newUser();
    const bad = await startTranscription(
      db,
      makeDeps({ stt: fakeStt([new TtsError("kötü istek", 400)]).stt }),
      user,
      { file: FILE, name: "a" },
      now,
    );
    if (!bad.ok) throw new Error(bad.error);
    expect(await settled(user, bad.generation.id)).toMatchObject({
      status: "failed",
      audioUrl: undefined,
    });
    expect(await voiceCredits(user)).toBe(5_000);
    expect(await storage.read(`${user}/${bad.generation.id}.mp3`)).toBeNull();

    const flaky = fakeStt([new TtsError("meşgul", 503), TRANSCRIPT]);
    const ok = await startTranscription(
      db,
      makeDeps({ stt: flaky.stt }),
      user,
      { file: FILE, name: "a" },
      now,
    );
    if (!ok.ok) throw new Error(ok.error);
    expect(await settled(user, ok.generation.id)).toMatchObject({ status: undefined });
    expect(flaky.calls).toHaveLength(2);
  });

  it("kayıtta konuşma yoksa başarısız sayılır ve iade edilir", async () => {
    const user = await newUser();
    const res = await startTranscription(
      db,
      makeDeps({ stt: fakeStt([{ text: "", language: null, words: [] }]).stt }),
      user,
      { file: FILE, name: "muzik.mp3" },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    expect(await settled(user, res.generation.id)).toMatchObject({ status: "failed" });
    expect(await voiceCredits(user)).toBe(5_000);
  });

  it("beklerken silinen kaydın sonucu yazılmaz; yarım kalan iş iade edilir", async () => {
    const user = await newUser();
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const res = await startTranscription(
      db,
      makeDeps({ stt: fakeStt([TRANSCRIPT], gate).stt }),
      user,
      { file: FILE, name: "a" },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    await removeGeneration(db, user, res.generation.id, storage);
    open();
    await vi.waitFor(() => expect(transcribeJobs.has(res.generation.id)).toBe(false));
    expect(await db.select().from(generations)).toEqual([]);
    expect(await storage.read(`${user}/${res.generation.id}-captions.json`)).toBeNull();

    // Sunucu yeniden başladı: iş listede yok.
    const gate2 = new Promise<void>(() => {});
    const orphan = await startTranscription(
      db,
      makeDeps({ stt: fakeStt([TRANSCRIPT], gate2).stt }),
      user,
      { file: FILE, name: "a" },
      now,
    );
    if (!orphan.ok) throw new Error(orphan.error);
    const charged = await voiceCredits(user);
    transcribeJobs.delete(orphan.generation.id);
    const fresh = await refreshPending(db, null, user, orphan.generation.id, now);
    expect(fresh).toMatchObject({ ok: true, generation: { status: "failed" } });
    expect(await voiceCredits(user)).toBe(charged + orphan.generation.cost);
  });

  it("düzenleyici: altyazısı düzeltilen kırpma metni de günceller; yazılar birleşince tür korunur", async () => {
    const user = await newUser();
    const ids: string[] = [];
    for (const name of ["a", "b"]) {
      const res = await startTranscription(db, makeDeps(), user, { file: FILE, name }, now);
      if (!res.ok) throw new Error(res.error);
      await settled(user, res.generation.id);
      ids.push(res.generation.id);
    }
    const trimmed = await trimSpeech(
      db,
      storage,
      user,
      {
        id: ids[0]!,
        startMs: 0,
        endMs: 400 * FRAME_SECONDS * 1000,
        cues: [
          { start: 100, end: 1100, text: "Merhaba dünya." },
          { start: 4000, end: 5300, text: "Bugün hava çok güzel." },
        ],
      },
      now,
    );
    if (!trimmed.ok) throw new Error(trimmed.error);
    expect(trimmed.generation).toMatchObject({
      type: "stt",
      edit: "trim",
      cost: 0,
      text: "Merhaba dünya.\n\nBugün hava çok güzel.",
      language: "tur",
    });
    const merged = await mergeSpeech(db, storage, user, { ids, gapMs: 0 }, now);
    if (!merged.ok) throw new Error(merged.error);
    expect(merged.generation).toMatchObject({ type: "stt", edit: "merge" });
  });
});

describe("geliştirici API'si: yazıya dökme", () => {
  useDb();

  const post = (key: string, form: FormData, d: Partial<ApiDeps>, headers = {}) =>
    handleApi(
      new Request("https://trai.example/api/v1/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, ...headers },
        body: form,
      }),
      "transcriptions",
      {
        db: async () => db,
        now: () => now,
        storage,
        speech: null,
        image: null,
        video: null,
        ...d,
      },
    );
  const form = (fields: Record<string, string | Blob>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
  };

  it("dosya yüklenir, 202 döner; bitince metin, dil, ses ve altyazı adresleri", async () => {
    const user = await newUser();
    const key = await createApiKey(db, user, "x", now);
    if (!key.ok) throw new Error(key.error);
    const deps = makeDeps();
    const res = await post(
      key.key,
      form({ file: new File([FILE], "roportaj.mp3"), language: "tr" }),
      { transcribe: async () => deps },
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { id: string; status: string; transcript: string };
    expect(body).toMatchObject({ type: "stt", status: "pending", transcript: "" });
    expect(body).not.toHaveProperty("prompt");
    await settled(user, body.id);

    const g = await handleApi(
      new Request(`https://trai.example/api/v1/generations/${body.id}`, {
        headers: { authorization: `Bearer ${key.key}` },
      }),
      `generations/${body.id}`,
      { db: async () => db, now: () => now, storage, speech: null, image: null, video: null },
    );
    expect(await g.json()).toMatchObject({
      status: "completed",
      transcript: "Merhaba dünya.\n\nBugün hava güzel.",
      language: "tr",
      files: [`https://trai.example/api/v1/generations/${body.id}/files/0`],
      subtitles: { srt: `https://trai.example/api/v1/generations/${body.id}/subtitles?format=srt` },
    });
  });

  it("kapalı servis 503, büyük dosya 413, geçersiz dil ve dosyasız istek 400", async () => {
    const user = await newUser();
    const key = await createApiKey(db, user, "x", now);
    if (!key.ok) throw new Error(key.error);
    const file = new File([FILE], "a.mp3");
    expect((await post(key.key, form({ file }), {})).status).toBe(503);
    expect((await post(key.key, form({ file }), { transcribe: async () => null })).status).toBe(
      503,
    );
    const on = { transcribe: async () => makeDeps() };
    expect(
      (await post(key.key, form({ file }), on, { "content-length": String(200 * 1024 * 1024) }))
        .status,
    ).toBe(413);
    expect((await post(key.key, form({ file, language: "klingon" }), on)).status).toBe(400);
    expect((await post(key.key, form({ title: "x" }), on)).status).toBe(400);
    expect(await db.select().from(generations)).toEqual([]);
  });
});

// ---------------------------------------------------------------- gerçek ffmpeg

const ffmpeg = await detectFfmpeg();

describe.skipIf(!ffmpeg)("gerçek ffmpeg ile", () => {
  useDb();
  it("videonun sesi MP3'e çevrilir ve ölçülür; sesi olmayan dosya reddedilir", async () => {
    const user = await newUser();
    const work = mkdtempSync(join(dir, "src-"));
    const runner = ffmpegRunner();
    const make = (args: string[], out: string) =>
      runner(
        ["-hide_banner", "-loglevel", "error", "-y", ...args, out],
        work,
        () => {},
        AbortSignal.timeout(30_000),
      );
    // 3 sn'lik sesli video ve sessiz bir görüntü.
    await make(
      [
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=160x120:d=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=300:duration=3",
        "-shortest",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
      ],
      "video.mp4",
    );
    await make(["-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1"], "image.png");

    const svc = fakeStt();
    const deps = makeDeps({ run: runner, stt: svc.stt });
    const video = new Uint8Array(await readFile(join(work, "video.mp4")));
    const res = await startTranscription(db, deps, user, { file: video, name: "v.mp4" }, now);
    if (!res.ok) throw new Error(res.error);
    expect(res.generation.cost).toBe(3);
    await settled(user, res.generation.id);
    const mp3 = svc.calls[0]!.audio;
    // MPEG-1 Layer III, 44,1 kHz, mono; baştaki ID3 ve Xing çerçevesi yok.
    expect(mp3[0]).toBe(0xff);
    expect((mp3[1]! & 0xfe) === 0xfa).toBe(true);
    expect((mp3[2]! >> 2) & 3).toBe(0);
    expect(mp3[3]! >> 6).toBe(3);
    expect(Buffer.from(mp3.subarray(0, 200)).includes("Xing")).toBe(false);

    const image = new Uint8Array(await readFile(join(work, "image.png")));
    expect(await startTranscription(db, deps, user, { file: image, name: "i.png" }, now)).toEqual({
      ok: false,
      error: "invalidInput",
    });
  }, 60_000);
});

// @vitest-environment node
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { balance } from "@/lib/credits";
import { openDb, type Db } from "@/server/db.server";
import { handleFalWebhook } from "@/server/fal-webhook.server";
import { localFileStorage, type FileStorage } from "@/server/file-storage.server";
import {
  demoTopUp,
  loadUserData,
  markEmailVerified,
  purchasePackage,
  refreshVideo,
  registerUser,
  startVideo,
  VIDEO_MAX_AGE_MS,
  type VideoDeps,
} from "@/server/services.server";
import {
  falVideoProvider,
  stylePrompt,
  type VideoCheck,
  type VideoJob,
  type VideoProvider,
} from "@/server/video.server";

const now = new Date("2026-10-16T09:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);
const Q = "https://queue.fal.run/fal-ai/kling-video";
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const job: VideoJob = {
  requestId: "req-12345678",
  statusUrl: `${Q}/requests/req-12345678/status`,
  responseUrl: `${Q}/requests/req-12345678`,
  cancelUrl: `${Q}/requests/req-12345678/cancel`,
};

describe("fal.ai video sağlayıcısı", () => {
  const MODEL = "fal-ai/kling-video/v1.6/standard/text-to-video";

  it("işi gönderir; webhook adresi ve 5 sn süre iletilir", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        request_id: job.requestId,
        status_url: job.statusUrl,
        response_url: job.responseUrl,
        cancel_url: job.cancelUrl,
      }),
    );
    const res = await falVideoProvider(
      { key: "k", model: MODEL },
      fetchImpl as unknown as typeof fetch,
    ).submit({ prompt: "gemi", webhookUrl: "https://trai.example/webhooks/fal" });
    expect(res).toEqual(job);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://queue.fal.run/${MODEL}?fal_webhook=${encodeURIComponent("https://trai.example/webhooks/fal")}`,
    );
    expect(JSON.parse(String(init.body))).toMatchObject({ prompt: "gemi", duration: "5" });
  });

  it("kuyruk alan adı dışındaki durum adresi kabul edilmez", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        request_id: "r",
        status_url: "https://evil.example/s",
        response_url: job.responseUrl,
      }),
    );
    await expect(
      falVideoProvider({ key: "k", model: MODEL }, fetchImpl as unknown as typeof fetch).submit({
        prompt: "x",
        webhookUrl: null,
      }),
    ).rejects.toThrow("beklenmedik");
  });

  it("durum: bekliyor, tamamlandı (video indirilir), 4xx başarısız, 5xx geçici", async () => {
    const run = (routes: Record<string, () => Response>) =>
      falVideoProvider({ key: "k", model: MODEL }, (async (url: string) => {
        const r = routes[url];
        if (!r) throw new Error(`beklenmeyen ${url}`);
        return r();
      }) as unknown as typeof fetch).check(job);

    expect(await run({ [job.statusUrl]: () => json({ status: "IN_PROGRESS" }) })).toEqual({
      state: "pending",
    });
    expect(
      await run({
        [job.statusUrl]: () => json({ status: "COMPLETED" }),
        [job.responseUrl]: () => json({ video: { url: "https://v3.fal.media/files/v.mp4" } }),
        "https://v3.fal.media/files/v.mp4": () => new Response(MP4),
      }),
    ).toEqual({ state: "done", video: MP4 });
    expect(
      await run({
        [job.statusUrl]: () => json({ status: "COMPLETED" }),
        [job.responseUrl]: () => json({ detail: "içerik" }, 422),
      }),
    ).toEqual({ state: "failed" });
    await expect(
      run({
        [job.statusUrl]: () => json({ status: "COMPLETED" }),
        [job.responseUrl]: () => json({}, 503),
      }),
    ).rejects.toThrow("503");
  });

  it("stil ipucu isteme eklenir", () => {
    expect(stylePrompt("gemi", 1)).toBe("gemi. Style: anime style animation, vibrant colors.");
    expect(stylePrompt("gemi", 9)).toBe("gemi");
  });
});

describe("gerçek video üretimi", () => {
  const dir = mkdtempSync(join(tmpdir(), "trai-video-"));
  let db: Db;
  let root: string;
  let storage: FileStorage;

  beforeEach(async () => {
    db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
    root = join(dir, `media-${randomUUID()}`);
    storage = localFileStorage(root);
  });
  afterEach(() => db.$client.close());
  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows dosya kilidini geç bırakabilir.
    }
  });

  /** İki Video & Görsel paketi (100 + 300 kredi, farklı son kullanma) almış kullanıcı. */
  async function newUser(email = "ayse@example.com") {
    const res = await registerUser(db, { name: "Ayşe", email, password: "gizli-sifre-1" }, now);
    if (!res.ok) throw new Error(res.error);
    await markEmailVerified(db, res.userId, now);
    await demoTopUp(db, res.userId, 1_100, now);
    for (const packageId of ["media-2d", "media-6d"]) {
      const bought = await purchasePackage(db, res.userId, { packageId }, now);
      if (!bought.ok) throw new Error(bought.error);
    }
    return res.userId;
  }

  const media = async (id: string) =>
    balance((await loadUserData(db, id, now)).grants, "media", now);

  /** Durumu testten yönetilen sahte sağlayıcı. */
  function fakeVideo() {
    let state: VideoCheck | Error = { state: "pending" };
    let n = 0;
    const p = {
      submitted: [] as string[],
      cancelled: 0,
      set(next: VideoCheck | Error) {
        state = next;
      },
      async submit({ prompt }: { prompt: string }) {
        p.submitted.push(prompt);
        n++;
        return { ...job, requestId: `req-0000000${n}` };
      },
      async check() {
        if (state instanceof Error) throw state;
        return state;
      },
      async cancel() {
        p.cancelled++;
      },
    } satisfies VideoProvider & Record<string, unknown>;
    return p;
  }
  const depsOf = (video: VideoProvider): VideoDeps => ({ video, storage, webhookUrl: null });
  const input = { text: "Boğazda gemi", styleIndex: 0 };

  it("iş gönderilince 15 kredi düşer; bitince video saklanır ve adresi verilir", async () => {
    const id = await newUser();
    const before = await media(id);
    const video = fakeVideo();
    const res = await startVideo(db, depsOf(video), id, input, now);
    if (!res.ok) throw new Error(res.error);
    expect(res.generation).toMatchObject({ type: "video", status: "pending", cost: 15 });
    expect(video.submitted[0]).toContain("Boğazda gemi. Style: cinematic");
    expect(await media(id)).toBe(before - 15);

    const gid = res.generation.id;
    expect((await refreshVideo(db, depsOf(video), id, gid, later(60_000))).ok).toBe(true);
    expect((await loadUserData(db, id, now)).generations[0]?.status).toBe("pending");

    video.set({ state: "done", video: MP4 });
    const done = await refreshVideo(db, depsOf(video), id, gid, later(120_000));
    expect(done.ok && done.generation).toMatchObject({
      status: undefined,
      fileUrls: [`/media/file/${gid}/0`],
    });
    expect(existsSync(join(root, id, `${gid}-0.mp4`))).toBe(true);
    expect(await media(id)).toBe(before - 15);
  });

  it("başarısız iş krediyi düşüldüğü paketlere bir kez iade eder", async () => {
    const id = await newUser();
    const before = await media(id);
    const video = fakeVideo();
    const res = await startVideo(db, depsOf(video), id, input, now);
    if (!res.ok) throw new Error(res.error);
    video.set({ state: "failed" });
    const failed = await refreshVideo(db, depsOf(video), id, res.generation.id, later(1000));
    expect(failed.ok && failed.generation.status).toBe("failed");
    await refreshVideo(db, depsOf(video), id, res.generation.id, later(2000));
    expect(await media(id)).toBe(before);
    // En erken biten paketten düşülmüştü; iade de oraya.
    const grants = (await loadUserData(db, id, now)).grants;
    expect(grants.find((g) => g.packageId === "media-2d")?.remaining).toBe(100);
  });

  it("geçici hatada bekler; 1 saati aşan iş iptal edilip iade edilir", async () => {
    const id = await newUser();
    const before = await media(id);
    const video = fakeVideo();
    const res = await startVideo(db, depsOf(video), id, input, now);
    if (!res.ok) throw new Error(res.error);
    video.set(new Error("fal 503"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const still = await refreshVideo(db, depsOf(video), id, res.generation.id, later(60_000));
    expect(still.ok && still.generation.status).toBe("pending");
    const expired = await refreshVideo(
      db,
      depsOf(video),
      id,
      res.generation.id,
      later(VIDEO_MAX_AGE_MS + 1),
    );
    spy.mockRestore();
    expect(expired.ok && expired.generation.status).toBe("failed");
    expect(video.cancelled).toBe(1);
    expect(await media(id)).toBe(before);
  });

  it("gönderim hatasında kredi düşmez; aynı anda en fazla 3 video; yetersiz kredi", async () => {
    const id = await newUser();
    const before = await media(id);
    const broken = {
      ...fakeVideo(),
      async submit(): Promise<VideoJob> {
        throw new Error("fal 500");
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await startVideo(db, depsOf(broken), id, input, now)).toEqual({
      ok: false,
      error: "providerFailed",
    });
    spy.mockRestore();
    expect(await media(id)).toBe(before);

    const video = fakeVideo();
    for (let i = 0; i < 3; i++)
      expect((await startVideo(db, depsOf(video), id, input, now)).ok).toBe(true);
    expect(await startVideo(db, depsOf(video), id, input, now)).toEqual({
      ok: false,
      error: "limit",
    });

    const poor = await registerUser(
      db,
      { name: "B", email: "b@example.com", password: "gizli-sifre-1" },
      now,
    );
    if (!poor.ok) throw new Error(poor.error);
    expect(await startVideo(db, depsOf(video), poor.userId, input, now)).toEqual({
      ok: false,
      error: "insufficient",
    });
    expect(await startVideo(db, depsOf(video), id, { text: "x", styleIndex: 7 }, now)).toEqual({
      ok: false,
      error: "invalidInput",
    });
  });

  it("başkasının videosu kontrol edilemez", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const res = await startVideo(db, depsOf(fakeVideo()), a, input, now);
    if (!res.ok) throw new Error(res.error);
    expect(await refreshVideo(db, depsOf(fakeVideo()), b, res.generation.id, now)).toEqual({
      ok: false,
      error: "notFound",
    });
  });

  it("webhook yalnız iş kimliğiyle kontrolü tetikler; sonuç sağlayıcıdan okunur", async () => {
    const id = await newUser();
    const video = fakeVideo();
    const res = await startVideo(db, depsOf(video), id, input, now);
    if (!res.ok) throw new Error(res.error);
    video.set({ state: "done", video: MP4 });
    const post = (body: unknown) =>
      new Request("http://localhost/webhooks/fal", { method: "POST", body: JSON.stringify(body) });
    const deps = { video: depsOf(video), db: async () => db, now: () => later(90_000) };

    expect((await handleFalWebhook(post({ request_id: "x" }), deps)).status).toBe(400);
    expect(
      (await handleFalWebhook(post({ request_id: "req-00000001", status: "OK" }), deps)).status,
    ).toBe(200);
    expect((await loadUserData(db, id, now)).generations[0]?.fileUrls).toHaveLength(1);
    expect(
      (await handleFalWebhook(post({ request_id: "req-00000001" }), { ...deps, video: null }))
        .status,
    ).toBe(404);
  });
});

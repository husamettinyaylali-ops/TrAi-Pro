// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_PROJECTS } from "@/lib/projects";
import { openDb, type Db } from "@/server/db.server";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "@/server/projects.server";
import {
  generateContent,
  listGenerations,
  markEmailVerified,
  moveGeneration,
  registerUser,
  renameGeneration,
} from "@/server/services.server";

const now = new Date("2026-10-16T09:00:00Z");
const at = (min: number) => new Date(now.getTime() + min * 60_000);
const dir = mkdtempSync(join(tmpdir(), "trai-projects-"));
let db: Db;

beforeEach(async () => {
  db = await openDb(`file:${join(dir, `${randomUUID()}.db`).replace(/\\/g, "/")}`);
});
afterEach(() => db.$client.close());
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows dosya kilidini geç bırakabilir.
  }
});

async function newUser(email: string) {
  const res = await registerUser(db, { name: "K", email, password: "gizli-sifre-1" }, now);
  if (!res.ok) throw new Error(res.error);
  await markEmailVerified(db, res.userId, now);
  return res.userId;
}

async function project(userId: string, name = "Bölüm 12") {
  const res = await createProject(db, userId, { name }, now);
  if (!res.ok) throw new Error(res.error);
  return res.project;
}

async function speech(userId: string, input: { projectId?: string; title?: string } = {}, t = now) {
  const res = await generateContent(
    db,
    userId,
    { type: "tts", text: "Merhaba dünya", voiceId: "defne", ...input },
    t,
  );
  if (!res.ok) throw new Error(res.error);
  return res.generation;
}

describe("projeler", () => {
  it("ad kırpılır; boş ya da uzun ad, uzun not geçersiz; kullanıcı başına sınır var", async () => {
    const a = await newUser("a@example.com");
    const res = await createProject(db, a, { name: "  Kanal tanıtımı  ", notes: "Senaryo" }, now);
    expect(res).toMatchObject({ ok: true, project: { name: "Kanal tanıtımı", notes: "Senaryo" } });
    expect(await createProject(db, a, { name: "   " }, now)).toEqual({
      ok: false,
      error: "invalidInput",
    });
    expect(await createProject(db, a, { name: "x".repeat(61) }, now)).toMatchObject({ ok: false });
    expect(
      await createProject(db, a, { name: "Not", notes: "x".repeat(4_001) }, now),
    ).toMatchObject({ ok: false, error: "invalidInput" });

    for (let i = 1; i < MAX_PROJECTS; i++) await project(a, `P${i}`);
    expect(await createProject(db, a, { name: "Fazla" }, now)).toEqual({
      ok: false,
      error: "limit",
    });
  });

  it("projeye üretilen kayıt projeye bağlanır, sayılır ve projeyi öne alır", async () => {
    const a = await newUser("a@example.com");
    const first = await project(a, "Eski");
    const second = await project(a, "Yeni");
    const g = await speech(a, { projectId: first.id, title: "  Giriş  " }, at(5));
    expect(g).toMatchObject({ projectId: first.id, title: "Giriş" });
    await speech(a); // projesiz

    const list = await listProjects(db, a);
    expect(list.map((p) => p.name)).toEqual(["Eski", "Yeni"]);
    expect(list[0]!.counts).toEqual({ tts: 1, stt: 0, sfx: 0, image: 0, video: 0 });
    expect(list[0]!.updatedAt).toBe(at(5).toISOString());
    expect(list[1]!.counts).toEqual({ tts: 0, stt: 0, sfx: 0, image: 0, video: 0 });
    expect((await getProject(db, a, second.id))?.counts.tts).toBe(0);

    const inProject = await listGenerations(db, a, { projectId: first.id });
    expect(inProject.items.map((x) => x.id)).toEqual([g.id]);
    expect((await listGenerations(db, a, { type: "tts" })).items).toHaveLength(2);
  });

  it("başkasının projesine üretim bağlanamaz; o projeye dokunulmaz", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const theirs = await project(b);
    const g = await speech(a, { projectId: theirs.id }, at(3));
    expect(g.projectId).toBeUndefined();
    expect((await getProject(db, b, theirs.id))?.updatedAt).toBe(now.toISOString());
    expect(await getProject(db, a, theirs.id)).toBeNull();
    expect((await listGenerations(db, a, { projectId: theirs.id })).items).toHaveLength(0);
  });

  it("üretim projeler arasında taşınır ve projeden çıkarılır; başkasınınki taşınamaz", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const mine = await project(a);
    const theirs = await project(b);
    const g = await speech(a);

    expect(await moveGeneration(db, a, g.id, mine.id, at(1))).toMatchObject({
      ok: true,
      generation: { projectId: mine.id },
    });
    expect(await moveGeneration(db, a, g.id, theirs.id, at(2))).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await moveGeneration(db, b, g.id, theirs.id, at(2))).toEqual({
      ok: false,
      error: "notFound",
    });
    expect((await listGenerations(db, a, { projectId: mine.id })).items).toHaveLength(1);

    const out = await moveGeneration(db, a, g.id, null, at(3));
    expect(out.ok && out.generation.projectId).toBeUndefined();
  });

  it("üretime ad verilir ve kaldırılır; uzun ad geçersiz, başkasınınki bulunamaz", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const g = await speech(a);
    expect(await renameGeneration(db, a, g.id, "  Final sürüm ")).toMatchObject({
      ok: true,
      generation: { title: "Final sürüm" },
    });
    expect(await renameGeneration(db, a, g.id, "x".repeat(81))).toEqual({
      ok: false,
      error: "invalidInput",
    });
    expect(await renameGeneration(db, b, g.id, "Benim")).toEqual({
      ok: false,
      error: "notFound",
    });
    const cleared = await renameGeneration(db, a, g.id, "");
    expect(cleared.ok && cleared.generation.title).toBeUndefined();
  });

  it("proje güncellenir; başkasının projesi güncellenemez ve silinemez", async () => {
    const a = await newUser("a@example.com");
    const b = await newUser("b@example.com");
    const p = await project(a);
    expect(
      await updateProject(db, a, p.id, { name: "Bölüm 13", notes: "Teslim cuma" }, at(1)),
    ).toMatchObject({ ok: true, project: { name: "Bölüm 13", notes: "Teslim cuma" } });
    expect(await updateProject(db, a, p.id, { name: "" }, at(1))).toEqual({
      ok: false,
      error: "invalidInput",
    });
    expect(await updateProject(db, b, p.id, { name: "Benim" }, at(1))).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await deleteProject(db, b, p.id)).toEqual({ ok: false, error: "notFound" });
    expect((await getProject(db, a, p.id))?.name).toBe("Bölüm 13");
  });

  it("proje silinince üretimleri silinmez, projesiz kalır", async () => {
    const a = await newUser("a@example.com");
    const p = await project(a);
    const g = await speech(a, { projectId: p.id });
    expect(await deleteProject(db, a, p.id)).toEqual({ ok: true });
    expect(await listProjects(db, a)).toHaveLength(0);
    const all = await listGenerations(db, a, { type: "tts" });
    expect(all.items.map((x) => [x.id, x.projectId])).toEqual([[g.id, undefined]]);
  });
});

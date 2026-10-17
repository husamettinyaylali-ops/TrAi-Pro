import { randomUUID } from "node:crypto";

import { and, count, desc, eq, isNotNull } from "drizzle-orm";

import { MAX_PROJECTS, PROJECT_NAME_MAX, PROJECT_NOTES_MAX } from "@/lib/projects";
import type { GenerationType, Project } from "@/lib/types";

import type { Db } from "./db.server";
import { generations, projects } from "./schema.server";

type Result<T, E extends string> = ({ ok: true } & T) | { ok: false; error: E };
type ProjectRow = typeof projects.$inferSelect;

const noCounts = (): Record<GenerationType, number> => ({ tts: 0, stt: 0, image: 0, video: 0 });

const toProject = (
  { userId: _u, ...p }: ProjectRow,
  counts: Record<GenerationType, number> = noCounts(),
): Project => ({ ...p, counts });

/** Ad kırpılır (1–60 karakter); not en fazla 4.000 karakter. Geçersizse null. */
function cleanInput(input: { name?: string | undefined; notes?: string | undefined }) {
  const name = input.name?.trim();
  if (name !== undefined && (name.length === 0 || [...name].length > PROJECT_NAME_MAX)) return null;
  const notes = input.notes?.replace(/\r\n/g, "\n").trim();
  if (notes !== undefined && [...notes].length > PROJECT_NOTES_MAX) return null;
  return { name, notes };
}

/** Kullanıcının projeleri, son etkinliğe göre; her projede türe göre üretim sayısı. */
export async function listProjects(db: Db, userId: string): Promise<Project[]> {
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt), desc(projects.id)),
    db
      .select({ projectId: generations.projectId, type: generations.type, n: count() })
      .from(generations)
      .where(and(eq(generations.userId, userId), isNotNull(generations.projectId)))
      .groupBy(generations.projectId, generations.type),
  ]);
  const byProject = new Map<string, Record<GenerationType, number>>();
  for (const c of counts) {
    const entry = byProject.get(c.projectId!) ?? noCounts();
    entry[c.type] = c.n;
    byProject.set(c.projectId!, entry);
  }
  return rows.map((r) => toProject(r, byProject.get(r.id)));
}

/** Kullanıcının tek projesi; başkasınınki ya da yoksa null. */
export async function getProject(db: Db, userId: string, id: string): Promise<Project | null> {
  const row = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .get();
  if (!row) return null;
  const counts = noCounts();
  const rows = await db
    .select({ type: generations.type, n: count() })
    .from(generations)
    .where(and(eq(generations.userId, userId), eq(generations.projectId, id)))
    .groupBy(generations.type);
  for (const c of rows) counts[c.type] = c.n;
  return toProject(row, counts);
}

export async function createProject(
  db: Db,
  userId: string,
  input: { name: string; notes?: string | undefined },
  now: Date,
): Promise<Result<{ project: Project }, "invalidInput" | "limit">> {
  const clean = cleanInput(input);
  if (!clean?.name) return { ok: false, error: "invalidInput" };
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ n: count() }).from(projects).where(eq(projects.userId, userId));
    if ((row?.n ?? 0) >= MAX_PROJECTS) return { ok: false, error: "limit" };
    const at = now.toISOString();
    const project: ProjectRow = {
      id: randomUUID(),
      userId,
      name: clean.name!,
      notes: clean.notes ?? "",
      createdAt: at,
      updatedAt: at,
    };
    await tx.insert(projects).values(project);
    return { ok: true, project: toProject(project) };
  });
}

/** Projenin adını ya da notunu değiştirir; verilmeyen alan aynı kalır. */
export async function updateProject(
  db: Db,
  userId: string,
  id: string,
  input: { name?: string | undefined; notes?: string | undefined },
  now: Date,
): Promise<Result<{ project: Project }, "notFound" | "invalidInput">> {
  const clean = cleanInput(input);
  if (!clean) return { ok: false, error: "invalidInput" };
  const changes: Partial<ProjectRow> = { updatedAt: now.toISOString() };
  if (clean.name !== undefined) changes.name = clean.name;
  if (clean.notes !== undefined) changes.notes = clean.notes;
  const res = await db
    .update(projects)
    .set(changes)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  if (res.rowsAffected !== 1) return { ok: false, error: "notFound" };
  const project = await getProject(db, userId, id);
  return project ? { ok: true, project } : { ok: false, error: "notFound" };
}

/**
 * Projeyi siler. Üretimler silinmez, projesiz kalır (kullanıcı ayrıca
 * silebilir); bağ aynı transaction'da boşaltılır.
 */
export async function deleteProject(
  db: Db,
  userId: string,
  id: string,
): Promise<Result<object, "notFound">> {
  return db.transaction(async (tx) => {
    const res = await tx
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)));
    if (res.rowsAffected !== 1) return { ok: false, error: "notFound" };
    await tx
      .update(generations)
      .set({ projectId: null })
      .where(and(eq(generations.userId, userId), eq(generations.projectId, id)));
    return { ok: true };
  });
}

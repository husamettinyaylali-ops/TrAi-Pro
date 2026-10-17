import { and, asc, eq } from "drizzle-orm";

import { clock } from "@/lib/clock";
import { MAX_ZIP_GENERATIONS } from "@/lib/projects";
import { LIMITS } from "@/lib/rate-limit";
import type { GenerationType } from "@/lib/types";

import { parseCues, toSrt } from "./captions.server";
import { getDb } from "./db.server";
import { fileStorage } from "./file-storage.server";
import { requestUser, type MediaDeps } from "./media.server";
import { getProject } from "./projects.server";
import { generations } from "./schema.server";
import { blocked, recordAttempt } from "./services.server";
import { zipStream, type ZipEntry } from "./zip.server";

type Lang = "tr" | "en";
type Row = typeof generations.$inferSelect;

const COPY = {
  tr: {
    folders: { tts: "ses", image: "gorsel", video: "video" },
    types: { tts: "Ses", image: "Görsel", video: "Video" },
    manifest: "icerik.txt",
    project: "Proje",
    exported: "Dışa aktarma",
    notes: "Proje notu",
    date: "Tarih",
    credits: "Kredi",
    files: "Dosya",
    text: "Metin / istem",
    demo: "Demo üretim: dosya yok",
    pending: "Hazırlanıyor: dosya henüz yok",
    failed: "Üretilemedi; kredi iade edildi",
    skipped: "Boyut sınırı ya da okuma hatası yüzünden eklenemeyen dosyalar",
    truncated: (n: number) => `Arşive yalnız ilk ${n} üretim alındı.`,
  },
  en: {
    folders: { tts: "audio", image: "images", video: "video" },
    types: { tts: "Audio", image: "Image", video: "Video" },
    manifest: "contents.txt",
    project: "Project",
    exported: "Exported",
    notes: "Project notes",
    date: "Date",
    credits: "Credits",
    files: "Files",
    text: "Text / prompt",
    demo: "Demo result: no file",
    pending: "In progress: no file yet",
    failed: "Failed; credits were refunded",
    skipped: "Files left out because of the size limit or a read error",
    truncated: (n: number) => `Only the first ${n} results were included.`,
  },
} satisfies Record<Lang, unknown>;

const TR_ASCII: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  İ: "i",
  ö: "o",
  ş: "s",
  ü: "u",
  Ç: "c",
  Ğ: "g",
  Ö: "o",
  Ş: "s",
  Ü: "u",
};

/** Dosya adı için ASCII kısaltma: Türkçe harfler sadeleşir, gerisi tireye döner. */
export function slugify(text: string, max = 40): string {
  const slug = text
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => TR_ASCII[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return slug || "kayit";
}

const fileKeys = (g: Row) => (g.audioKey ? [g.audioKey] : (g.files ?? []));
const ext = (key: string) => key.slice(key.lastIndexOf(".") + 1);

function when(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", {
    timeZone: "Europe/Istanbul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/**
 * Projedeki üretimlerin dosyaları tek ZIP'te, yalnız proje sahibine: türlere
 * göre klasörler ve en sonda proje notu, metinler ve dosya listesini içeren
 * bir içerik dosyası. Başkasının projesi için de "bulunamadı" döner.
 * `?lang=en` içerik dosyasını ve klasör adlarını İngilizce yazar.
 */
export async function serveProjectZip(
  request: Request,
  id: string,
  deps: MediaDeps = {},
): Promise<Response> {
  const db = deps.db ?? (await getDb());
  const now = deps.now ?? clock();
  const user = await requestUser(request, db, now);
  if (!user) return new Response("Oturum gerekli", { status: 401 });
  const project = await getProject(db, user.id, id);
  if (!project) return new Response("Bulunamadı", { status: 404 });

  const limitKey = `zip:user:${user.id}`;
  const limited = await blocked(db, [[limitKey, LIMITS.projectZipPerUser]], now);
  if (limited) {
    return new Response("Çok fazla istek", {
      status: 429,
      headers: { "retry-after": String(limited.retryAfterMinutes * 60) },
    });
  }
  await recordAttempt(db, limitKey, now);

  const lang: Lang = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "tr";
  const c = COPY[lang];
  const rows = await db
    .select()
    .from(generations)
    .where(and(eq(generations.userId, user.id), eq(generations.projectId, id)))
    .orderBy(asc(generations.createdAt), asc(generations.id))
    .limit(MAX_ZIP_GENERATIONS + 1);
  const list = rows.slice(0, MAX_ZIP_GENERATIONS);

  const storage = deps.storage ?? fileStorage();
  const entries: ZipEntry[] = [];
  const items = list.map((g, i) => {
    const keys = fileKeys(g);
    const base = `${c.folders[g.type as GenerationType]}/${String(i + 1).padStart(3, "0")}-${slugify(g.title ?? g.text)}`;
    const names = keys.map((k, j) => `${base}${keys.length > 1 ? `-${j + 1}` : ""}.${ext(k)}`);
    keys.forEach((k, j) => entries.push({ name: names[j]!, data: () => storage.read(k) }));
    // Seslendirmenin altyazısı sesin yanında SRT olarak.
    const captionsKey = g.captionsKey;
    if (captionsKey) {
      names.push(`${base}.srt`);
      entries.push({
        name: `${base}.srt`,
        data: async () => {
          const raw = await storage.read(captionsKey);
          const cues = raw ? parseCues(raw) : null;
          return cues ? new TextEncoder().encode(toSrt(cues)) : null;
        },
      });
    }
    return { g, names, n: i + 1 };
  });

  const manifest = (skipped: string[]): string => {
    const lines = [
      `TrAi Pro · ${c.project}: ${project.name}`,
      `${c.exported}: ${when(now.toISOString(), lang)}`,
    ];
    if (project.notes) lines.push("", `${c.notes}:`, project.notes);
    for (const { g, names, n } of items) {
      const status = g.status === "pending" ? c.pending : g.status === "failed" ? c.failed : c.demo;
      lines.push(
        "",
        "----------------------------------------",
        `${String(n).padStart(3, "0")} · ${c.types[g.type as GenerationType]}${g.title ? ` · ${g.title}` : ""}`,
        `${c.date}: ${when(g.createdAt, lang)} · ${c.credits}: ${g.cost}`,
        `${c.files}: ${names.length ? names.join(", ") : `(${status})`}`,
        `${c.text}:`,
        g.text,
      );
    }
    if (skipped.length) lines.push("", `${c.skipped}:`, ...skipped.map((s) => `- ${s}`));
    if (rows.length > MAX_ZIP_GENERATIONS) lines.push("", c.truncated(MAX_ZIP_GENERATIONS));
    return lines.join("\r\n") + "\r\n";
  };

  const stream = zipStream(entries, now, (skipped) => ({
    name: c.manifest,
    data: async () => new TextEncoder().encode(manifest(skipped)),
  }));
  const file = slugify(project.name, 60);
  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${file}.zip"; filename*=UTF-8''${encodeURIComponent(project.name)}.zip`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

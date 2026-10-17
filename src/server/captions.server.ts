/**
 * Seslendirmeden altyazı: sağlayıcının karakter zamanlarından kelimeler,
 * kelimelerden okunabilir altyazılar (en çok 2 × 42 karakter ve 6 sn; cümle
 * sonunda yeni altyazı), sonra SRT ya da WebVTT. Zamanlar milisaniyedir.
 */

/** Sağlayıcının karakter bazlı zamanlaması (saniye). */
export interface SpeechAlignment {
  characters: string[];
  starts: number[];
  ends: number[];
}

export interface Cue {
  start: number;
  end: number;
  /** En çok iki satır ("\n" ile). */
  text: string;
}

interface Word {
  text: string;
  start: number;
  end: number;
  /** Metinde satır sonundan sonra geliyor: yeni altyazı başlatır. */
  breakBefore: boolean;
}

export const CAPTION_LINE = 42;
const CAPTION_MAX = CAPTION_LINE * 2;
const CAPTION_MAX_MS = 6_000;
const CAPTION_MIN_MS = 1_000;
// Rakamdan sonraki nokta ("3. bölüm") cümle sonu sayılmaz.
const SENTENCE_END = /(?:[!?…]|(?<!\d)\.)["'”’»)\]]*$/u;
const CLAUSE_END = /(?:[,;:]["'”’»)\]]*|[–—])$/u;

const len = (s: string) => [...s].length;
const ms = (seconds: number) => Math.max(0, Math.round(seconds * 1000));

function words(a: SpeechAlignment, offsetSeconds: number): Word[] {
  const out: Word[] = [];
  let text = "";
  let start = 0;
  let end = 0;
  let breakNext = false;
  const push = () => {
    if (!text) return;
    out.push({ text, start: ms(start), end: ms(end), breakBefore: breakNext });
    breakNext = false;
    text = "";
  };
  a.characters.forEach((ch, k) => {
    if (!ch.trim()) {
      push();
      if (ch.includes("\n") && out.length) breakNext = true;
      return;
    }
    if (!text) start = offsetSeconds + (a.starts[k] ?? 0);
    text += ch;
    end = offsetSeconds + (a.ends[k] ?? 0);
  });
  push();
  return out;
}

/** Uzun altyazıyı ortaya en yakın boşluktan iki satıra böler. */
function splitLines(text: string): string {
  if (len(text) <= CAPTION_LINE) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = text.indexOf(" "); i !== -1; i = text.indexOf(" ", i + 1)) {
    if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  }
  return best === -1 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/**
 * Parçaların zamanlamasından altyazılar. Her parçanın zamanı, birleşik
 * dosyadaki başlangıcı (`offset`, saniye) kadar kaydırılır.
 */
export function buildCues(parts: { alignment: SpeechAlignment; offset: number }[]): Cue[] {
  const all = parts.flatMap((p) => words(p.alignment, p.offset));
  const raw: Cue[] = [];
  let cur: Word[] = [];
  const joined = () => cur.map((w) => w.text).join(" ");
  const flush = () => {
    if (cur.length) raw.push({ start: cur[0]!.start, end: cur.at(-1)!.end, text: joined() });
    cur = [];
  };
  for (const w of all) {
    if (
      cur.length &&
      (w.breakBefore ||
        len(joined()) + 1 + len(w.text) > CAPTION_MAX ||
        w.end - cur[0]!.start > CAPTION_MAX_MS)
    ) {
      flush();
    }
    cur.push(w);
    const n = len(joined());
    if ((SENTENCE_END.test(w.text) && n >= 20) || (CLAUSE_END.test(w.text) && n >= 50)) flush();
  }
  flush();
  // Çok kısa altyazı okunabilsin diye en az 1 sn kalır; sonrakiyle çakışmaz.
  return raw.map((c, i) => {
    const next = raw[i + 1];
    const end = Math.max(c.end, c.start + CAPTION_MIN_MS);
    return {
      start: c.start,
      end: Math.max(c.start + 1, next ? Math.min(end, next.start) : end),
      text: splitLines(c.text),
    };
  });
}

function stamp(t: number, sep: "," | "."): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor(t / 60_000) % 60;
  const s = Math.floor(t / 1000) % 60;
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(t % 1000, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\r\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\r\n${c.text.replace(/\n/g, "\r\n")}\r\n`,
    )
    .join("\r\n");
}

const escapeVtt = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues
    .map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${escapeVtt(c.text)}\n`)
    .join("\n")}`;
}

/** Depodaki altyazı dosyası: `{ "cues": [...] }`. Bozuksa null. */
export function parseCues(raw: Uint8Array): Cue[] | null {
  try {
    const body = JSON.parse(new TextDecoder().decode(raw)) as { cues?: unknown };
    if (!Array.isArray(body.cues)) return null;
    const ok = body.cues.every(
      (c: Partial<Cue>) =>
        typeof c.start === "number" && typeof c.end === "number" && typeof c.text === "string",
    );
    return ok ? (body.cues as Cue[]) : null;
  } catch {
    return null;
  }
}

export const encodeCues = (cues: Cue[]) => new TextEncoder().encode(JSON.stringify({ cues }));

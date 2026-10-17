import { spawn } from "node:child_process";

import type { Cue } from "./captions.server";
import { env } from "./env.server";

/**
 * Kısa video oluşturucu: seslendirme, görseller ve altyazıdan MP4 (ffmpeg).
 * Bu modül yalnız komut ve altyazı dosyasını hazırlar, ffmpeg'i çalıştırır;
 * kayıt ve dosyalar editor.server.ts'tedir.
 */

export const COMPOSE_FORMATS = {
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1": [1080, 1080],
} as const satisfies Record<string, readonly [number, number]>;
export type ComposeFormat = keyof typeof COMPOSE_FORMATS;

export const COMPOSE_MAX_IMAGES = 30;
/** Videonun en uzun süresi (sn); ses daha uzunsa oluşturulmaz. */
export const COMPOSE_MAX_SECONDS = 600;
export const COMPOSE_FPS = 30;

export interface CaptionStyle {
  show: boolean;
  position: "bottom" | "middle";
  size: "s" | "m" | "l";
}

const SIZES = { s: 0.05, m: 0.065, l: 0.08 } as const;

/**
 * Görsellerin süreleri: ses süresi eşit bölünür, kare sınırına yuvarlanır
 * ve toplam ses süresine eşit kalır.
 */
export function imageDurations(totalSeconds: number, n: number, fps = COMPOSE_FPS): number[] {
  const frames = Math.max(n, Math.round(totalSeconds * fps));
  const base = Math.floor(frames / n);
  const extra = frames - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / fps);
}

function assTime(ms: number): string {
  const cs = Math.round(Math.max(0, ms) / 10);
  const h = Math.floor(cs / 360_000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs % 100)}`;
}

/** ASS biçim komutları kullanıcı metninden çıkarılır; satır sonu ASS satır sonu olur. */
const assText = (text: string) =>
  text.replace(/\\/g, "/").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");

/**
 * Videoya yazılacak altyazı (ASS): beyaz, kalın, siyah kenarlı; altta ya da
 * ortada. Boyut ve kenar boşlukları videonun çözünürlüğüne göre; dikey
 * videoda alt boşluk platform düğmelerinin üstünde kalacak kadar büyük.
 */
export function assSubtitles(cues: Cue[], format: ComposeFormat, style: CaptionStyle): string {
  const [w, h] = COMPOSE_FORMATS[format];
  const size = Math.round(Math.min(w, h) * SIZES[style.size]);
  const outline = Math.max(2, Math.round(size * 0.09));
  const middle = style.position === "middle";
  const marginV = middle ? 0 : Math.round(h * (h > w ? 0.14 : 0.08));
  const marginLR = Math.round(w * 0.08);
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,DejaVu Sans,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outline},0,${middle ? 5 : 2},${marginLR},${marginLR},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map(
      (c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${assText(c.text)}`,
    ),
    "",
  ].join("\n");
}

/**
 * ffmpeg argümanları. Kabuk kullanılmaz; dosya adları çalışma klasörüne
 * göredir (altyazı yolunda kaçış gerekmesin). Hareketsiz görsel döngüyle
 * süresince, hareketli görsel yavaş yakınlaşmayla (zoompan) gösterilir;
 * görseller kadrajı dolduracak şekilde ortadan kırpılır.
 */
export function ffmpegArgs(input: {
  images: string[];
  durations: number[];
  audio: string;
  subtitles: string | null;
  format: ComposeFormat;
  motion: boolean;
  output: string;
}): string[] {
  const [w, h] = COMPOSE_FORMATS[input.format];
  const args = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1"];
  input.images.forEach((img, i) => {
    if (input.motion) args.push("-i", img);
    else
      args.push(
        "-loop",
        "1",
        "-framerate",
        String(COMPOSE_FPS),
        "-t",
        input.durations[i]!.toFixed(3),
        "-i",
        img,
      );
  });
  args.push("-i", input.audio);

  const chains = input.images.map((_, i) => {
    const frames = Math.max(1, Math.round(input.durations[i]! * COMPOSE_FPS));
    const fit = (fw: number, fh: number) =>
      `scale=${fw}:${fh}:force_original_aspect_ratio=increase,crop=${fw}:${fh}`;
    const body = input.motion
      ? // Titremesin diye iki kat büyük kadrajdan yakınlaşılır; görsel boyunca %10.
        `${fit(w * 2, h * 2)},zoompan=z='min(zoom+${(0.1 / frames).toFixed(6)},1.1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${COMPOSE_FPS}`
      : fit(w, h);
    return `[${i}:v]${body},setsar=1,format=yuv420p[v${i}]`;
  });
  const n = input.images.length;
  chains.push(
    `${input.images.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0[vc]`,
    input.subtitles ? `[vc]ass=${input.subtitles}[v]` : "[vc]null[v]",
  );
  args.push(
    "-filter_complex",
    chains.join(";"),
    "-map",
    "[v]",
    "-map",
    `${n}:a`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(COMPOSE_FPS),
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-shortest",
    input.output,
  );
  return args;
}

/** ffmpeg'i çalıştırır; ilerleme (işlenen saniye) bildirilir, hata son satırla döner. */
export type FfmpegRun = (
  args: string[],
  cwd: string,
  onProgress: (seconds: number) => void,
  signal: AbortSignal,
) => Promise<void>;

export const ffmpegBinary = () => env("FFMPEG_PATH") ?? "ffmpeg";

export function ffmpegRunner(bin = ffmpegBinary()): FfmpegRun {
  return (args, cwd, onProgress, signal) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        cwd,
        signal,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let pending = "";
      let errors = "";
      child.stdout.setEncoding("utf8").on("data", (d: string) => {
        pending += d;
        let at: number;
        while ((at = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, at).trim();
          pending = pending.slice(at + 1);
          // out_time_ms da mikrosaniyedir (ffmpeg'in eski adı).
          const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line);
          if (m) onProgress(Number(m[1]) / 1e6);
        }
      });
      child.stderr.setEncoding("utf8").on("data", (d: string) => {
        errors = (errors + d).slice(-2000);
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`ffmpeg ${code}: ${errors.trim().split("\n").pop() ?? ""}`)),
      );
    });
}

export interface FfmpegInfo {
  version: string;
  /** Altyazıyı videoya yazmak için libass (ass süzgeci) var mı. */
  subtitles: boolean;
}

function capture(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    try {
      const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
      child.on("error", () => resolve(null));
      child.on("close", (code) => resolve(code === 0 ? out : null));
    } catch {
      resolve(null);
    }
  });
}

let detected: Promise<FfmpegInfo | null> | null = null;

/** ffmpeg kurulu mu (sürüm ve altyazı desteği); sonuç süreç boyunca saklanır. */
export function detectFfmpeg(bin = ffmpegBinary()): Promise<FfmpegInfo | null> {
  detected ??= (async () => {
    const version = await capture(bin, ["-hide_banner", "-version"]);
    if (!version) return null;
    const filters = (await capture(bin, ["-hide_banner", "-filters"])) ?? "";
    return {
      version: /ffmpeg version (\S+)/.exec(version)?.[1] ?? "?",
      subtitles: /^\s*\S*\s+ass\s/m.test(filters),
    };
  })();
  return detected;
}

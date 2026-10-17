import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { FlipHorizontal2, Loader2, RotateCcw, RotateCw, Save, Undo2 } from "lucide-react";

import { btnPrimary, field } from "@/components/site/shell";
import { useI18n } from "@/lib/i18n";
import { useApp, type Generation } from "@/lib/store";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  RATIOS,
  clampCenter,
  cropRect,
  outputSize,
  rotatedSize,
  wrapLines,
  type Ratio,
  type Rect,
  type Rotation,
} from "./image-geometry";
import { SavedNotice } from "./saved-notice";
import { smallBtn, useEditError } from "./utils";

const POSITIONS = ["top", "middle", "bottom"] as const;
type Position = (typeof POSITIONS)[number];
const FORMATS = ["image/jpeg", "image/png"] as const;
type Format = (typeof FORMATS)[number];
const PREVIEW_MAX_H = 460;
const CAPTION_MAX = 120;
/** Tuvale yazı, sitenin başlık yazı tipiyle. */
const FONT = '"Space Grotesk", "Inter", system-ui, sans-serif';

interface Caption {
  text: string;
  /** Kırpılan alanın yüksekliğine göre yüzde. */
  size: number;
  position: Position;
}

/** Kaynak görseli döndürülmüş ve yatay çevrilmiş olarak tuvale çizer. */
function drawSource(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rotation: Rotation,
  flip: boolean,
  scale: number,
) {
  const { w, h } = rotatedSize(img.naturalWidth, img.naturalHeight, rotation);
  const iw = img.naturalWidth * scale;
  const ih = img.naturalHeight * scale;
  ctx.save();
  ctx.translate((w * scale) / 2, (h * scale) / 2);
  if (flip) ctx.scale(-1, 1);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  ctx.restore();
}

/** Kapak yazısı: kırpılan alanın içinde, yarı saydam koyu bant üstünde, beyaz ve ortalı. */
function drawCaption(ctx: CanvasRenderingContext2D, rect: Rect, caption: Caption) {
  const text = caption.text.trim();
  if (!text) return;
  const px = Math.max(10, Math.round((rect.h * caption.size) / 100));
  ctx.save();
  ctx.font = `700 ${px}px ${FONT}`;
  const lines = wrapLines(text, rect.w * 0.88, (s) => ctx.measureText(s).width);
  const lineH = px * 1.2;
  const pad = px * 0.5;
  const blockH = lines.length * lineH + pad * 2;
  const margin = rect.h * 0.05;
  const top =
    caption.position === "top"
      ? rect.y + margin
      : caption.position === "middle"
        ? rect.y + (rect.h - blockH) / 2
        : rect.y + rect.h - margin - blockH;
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(rect.x, top, rect.w, blockH);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, rect.x + rect.w / 2, top + pad + lineH * (i + 0.5)));
  ctx.restore();
}

/**
 * Görsel düzenleyici: kırpma oranı ve yakınlaştırma (alan sürükleyerek ya da
 * ok tuşlarıyla kaydırılır), döndürme, yatay çevirme ve kapak yazısı. Önizleme
 * kaydedilecek görselin aynısıdır; görsel tarayıcıda hazırlanıp yeni sürüm
 * olarak yüklenir.
 */
export function ImageEditor({ g }: { g: Generation }) {
  const { t } = useI18n();
  const e = t.editor.image;
  const editError = useEditError();
  const { saveImageEdit } = useApp();
  const urls = g.fileUrls ?? [];
  const [index, setIndex] = useState(0);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [flip, setFlip] = useState(false);
  const [ratio, setRatio] = useState<Ratio>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ cx: 0.5, cy: 0.5 });
  const [caption, setCaption] = useState<Caption>({ text: "", size: 7, position: "bottom" });
  const [format, setFormat] = useState<Format>("image/jpeg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Generation | null>(null);
  const [box, setBox] = useState(600);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  const url = urls[index];
  useEffect(() => {
    if (!url) return;
    let live = true;
    const el = new Image();
    el.decoding = "async";
    el.onload = () => live && setImg(el);
    el.onerror = () => live && setLoadError(true);
    el.src = url;
    return () => {
      live = false;
    };
  }, [url]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBox(el.clientWidth));
    ro.observe(el);
    setBox(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);

  const dims = img ? rotatedSize(img.naturalWidth, img.naturalHeight, rotation) : null;
  const scale = dims ? Math.min(box / dims.w, PREVIEW_MAX_H / dims.h) : 1;
  const c = dims ? clampCenter(dims.w, dims.h, ratio, zoom, center.cx, center.cy) : center;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !img || !dims) return;
    const dpr = window.devicePixelRatio || 1;
    const w = dims.w * scale;
    const h = dims.h * scale;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${Math.round(w)}px`;
    canvas.style.height = `${Math.round(h)}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSource(ctx, img, rotation, flip, scale);
    const r = cropRect(dims.w, dims.h, ratio, zoom, c.cx, c.cy);
    const view = { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale };
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(view.x, view.y, view.w, view.h);
    ctx.fill("evenodd");
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(view.x + 1, view.y + 1, view.w - 2, view.h - 2);
    drawCaption(ctx, view, caption);
  });

  const move = (dx: number, dy: number, from = c) => {
    if (!dims) return;
    setCenter(clampCenter(dims.w, dims.h, ratio, zoom, from.cx + dx, from.cy + dy));
  };
  const onPointerDown = (ev: PointerEvent<HTMLCanvasElement>) => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = { x: ev.clientX, y: ev.clientY, ...c };
  };
  const onPointerMove = (ev: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || !dims) return;
    move((ev.clientX - d.x) / (dims.w * scale), (ev.clientY - d.y) / (dims.h * scale), d);
  };
  const onKeyDown = (ev: KeyboardEvent<HTMLCanvasElement>) => {
    const step = ev.shiftKey ? 0.1 : 0.02;
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const k = keys[ev.key];
    if (!k) return;
    ev.preventDefault();
    move(k[0], k[1]);
  };

  const changed =
    rotation !== 0 || flip || ratio !== null || zoom > 1 || caption.text.trim() !== "";
  const reset = () => {
    setRotation(0);
    setFlip(false);
    setRatio(null);
    setZoom(1);
    setCenter({ cx: 0.5, cy: 0.5 });
    setCaption((x) => ({ ...x, text: "" }));
  };

  const exportBlob = (): Promise<Blob | null> => {
    if (!img || !dims) return Promise.resolve(null);
    const full = document.createElement("canvas");
    full.width = dims.w;
    full.height = dims.h;
    const fctx = full.getContext("2d");
    if (!fctx) return Promise.resolve(null);
    drawSource(fctx, img, rotation, flip, 1);
    const r = cropRect(dims.w, dims.h, ratio, zoom, c.cx, c.cy);
    const out = outputSize(r.w, r.h);
    const canvas = document.createElement("canvas");
    canvas.width = out.w;
    canvas.height = out.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(full, r.x, r.y, r.w, r.h, 0, 0, out.w, out.h);
    drawCaption(ctx, { x: 0, y: 0, w: out.w, h: out.h }, caption);
    return new Promise((resolve) => canvas.toBlob(resolve, format, 0.92));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const blob = await exportBlob();
    if (!blob) {
      setBusy(false);
      return setError(t.editor.errors.failed);
    }
    const form = new FormData();
    form.append("sourceId", g.id);
    form.append(
      "file",
      new File([blob], `duzenlenmis.${format === "image/png" ? "png" : "jpg"}`, { type: format }),
    );
    const res = await saveImageEdit(form);
    setBusy(false);
    if (res.ok) setSaved(res.generation);
    else setError(editError(res));
  };

  const segment = (on: boolean) => `${smallBtn} ${on ? "border-cyan bg-cyan/10 text-cyan" : ""}`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="image-preview" className="space-y-3">
          <h2 id="image-preview" className="sr-only">
            {e.preview}
          </h2>
          {urls.length > 1 && (
            <div role="group" aria-label={e.pick} className="flex flex-wrap gap-2">
              {urls.map((u, i) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={index === i}
                  onClick={() => {
                    setImg(null);
                    setIndex(i);
                  }}
                  className={segment(index === i)}
                >
                  {e.pickN(i + 1)}
                </button>
              ))}
            </div>
          )}
          <div
            ref={wrapRef}
            className="grid min-h-48 place-items-center overflow-hidden rounded-3xl bg-muted/50 p-2"
          >
            {loadError ? (
              <p role="alert" className="text-sm text-destructive">
                {e.loadError}
              </p>
            ) : !img ? (
              <div
                role="status"
                aria-label={t.loading}
                className="shimmer h-64 w-full rounded-2xl"
              />
            ) : (
              <canvas
                ref={canvasRef}
                tabIndex={0}
                role="img"
                aria-label={e.canvasLabel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
                onKeyDown={onKeyDown}
                className="max-w-full cursor-move touch-none rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">{e.dragHint}</p>
        </section>

        <section
          aria-labelledby="image-tools"
          className="glass glow-border space-y-5 rounded-3xl p-4 sm:p-6"
        >
          <h2 id="image-tools" className="sr-only">
            {e.tools}
          </h2>
          <div>
            <p id="image-ratio" className="mb-2 text-sm font-medium">
              {e.ratio}
            </p>
            <div role="group" aria-labelledby="image-ratio" className="flex flex-wrap gap-2">
              {RATIOS.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={ratio === r}
                  onClick={() => setRatio(r)}
                  className={segment(ratio === r)}
                >
                  {e.ratios[i]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <label htmlFor="image-zoom" className="font-medium">
                {e.zoom}
              </label>
              <output htmlFor="image-zoom" className="tabular-nums text-muted-foreground">
                {Math.round(zoom * 100)}%
              </output>
            </div>
            <input
              id="image-zoom"
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              value={zoom}
              onChange={(ev) => setZoom(Number(ev.target.value))}
              className="mt-1 h-6 w-full accent-violet"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRotation((r) => ((r + 270) % 360) as Rotation)}
              aria-label={e.rotateLeft}
              title={e.rotateLeft}
              className={smallBtn}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setRotation((r) => ((r + 90) % 360) as Rotation)}
              aria-label={e.rotateRight}
              title={e.rotateRight}
              className={smallBtn}
            >
              <RotateCw className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-pressed={flip}
              onClick={() => setFlip((f) => !f)}
              className={segment(flip)}
            >
              <FlipHorizontal2 className="h-4 w-4" aria-hidden />
              {e.flip}
            </button>
            <button type="button" onClick={reset} disabled={!changed} className={smallBtn}>
              <Undo2 className="h-4 w-4" aria-hidden />
              {e.reset}
            </button>
          </div>
          <div>
            <label htmlFor="image-caption" className="mb-1.5 block text-sm font-medium">
              {e.caption}
            </label>
            <textarea
              id="image-caption"
              rows={2}
              maxLength={CAPTION_MAX}
              value={caption.text}
              placeholder={e.captionPlaceholder}
              onChange={(ev) => setCaption((x) => ({ ...x, text: ev.target.value }))}
              className={`${field} resize-none`}
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <label htmlFor="image-size" className="font-medium">
                {e.size}
              </label>
              <output htmlFor="image-size" className="tabular-nums text-muted-foreground">
                {caption.size}%
              </output>
            </div>
            <input
              id="image-size"
              type="range"
              min={4}
              max={14}
              step={1}
              value={caption.size}
              onChange={(ev) => setCaption((x) => ({ ...x, size: Number(ev.target.value) }))}
              className="mt-1 h-6 w-full accent-violet"
            />
          </div>
          <div>
            <p id="image-position" className="mb-2 text-sm font-medium">
              {e.position}
            </p>
            <div role="group" aria-labelledby="image-position" className="flex flex-wrap gap-2">
              {POSITIONS.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={caption.position === p}
                  onClick={() => setCaption((x) => ({ ...x, position: p }))}
                  className={segment(caption.position === p)}
                >
                  {e.positions[i]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p id="image-format" className="mb-2 text-sm font-medium">
              {e.format}
            </p>
            <div role="group" aria-labelledby="image-format" className="flex flex-wrap gap-2">
              {FORMATS.map((f, i) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={format === f}
                  onClick={() => setFormat(f)}
                  className={segment(format === f)}
                >
                  {e.formats[i]}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {saved ? (
        <SavedNotice g={saved} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !img || !changed}
            className={btnPrimary}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            {busy ? t.editor.saving : t.editor.save}
          </button>
          <p className="text-sm text-muted-foreground">{changed ? t.editor.free : e.unchanged}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

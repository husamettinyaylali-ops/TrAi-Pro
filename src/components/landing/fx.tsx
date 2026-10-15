import { Link } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

export function NeuralCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const mouse = { x: -999, y: -999 };
    const resize = () => {
      c.width = c.offsetWidth * devicePixelRatio;
      c.height = c.offsetHeight * devicePixelRatio;
    };
    resize();
    const pts = Array.from({ length: 70 }, () => ({
      x: Math.random() * c.width,
      y: Math.random() * c.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
    }));
    const css = getComputedStyle(document.documentElement);
    const cyan = css.getPropertyValue("--cyan").trim();
    const violet = css.getPropertyValue("--violet").trim();
    const onMove = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      mouse.x = (e.clientX - r.left) * devicePixelRatio;
      mouse.y = (e.clientY - r.top) * devicePixelRatio;
    };
    const tick = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      const D = 140 * devicePixelRatio;
      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > c.width) p.vx *= -1;
        if (p.y < 0 || p.y > c.height) p.vy *= -1;
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i]!,
            b = pts[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < D) {
            ctx.strokeStyle = violet;
            ctx.globalAlpha = (1 - d / D) * 0.35;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        const q = pts[i]!;
        const dm = Math.hypot(q.x - mouse.x, q.y - mouse.y);
        if (dm < D * 1.5) {
          ctx.strokeStyle = cyan;
          ctx.globalAlpha = (1 - dm / (D * 1.5)) * 0.8;
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = cyan;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 1.6 * devicePixelRatio, 0, 7);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const m = (e: MouseEvent) => {
      if (ref.current)
        ref.current.style.transform = `translate(${e.clientX - 200}px, ${e.clientY - 200}px)`;
    };
    window.addEventListener("mousemove", m);
    return () => window.removeEventListener("mousemove", m);
  }, []);
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-0 hidden h-[400px] w-[400px] rounded-full bg-violet/15 blur-3xl transition-transform duration-200 ease-out md:block"
    />
  );
}

export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export function Waveform({ playing, bars = 40 }: { playing: boolean; bars?: number }) {
  return (
    <div className="flex h-12 items-center gap-[3px]">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full bg-gradient-brand ${playing ? "wave-bar" : ""}`}
          style={{
            height: `${25 + ((i * 37) % 75)}%`,
            animationDelay: `${(i % 10) * 0.08}s`,
            opacity: playing ? 1 : 0.4,
          }}
        />
      ))}
    </div>
  );
}

export function Logo() {
  return (
    <Link
      to="/"
      aria-label="TrAi Pro"
      className="flex items-center gap-2 font-display text-xl font-bold"
    >
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-brand text-sm text-primary-foreground shadow-glow">
        Tr
      </span>
      <span>
        Tr<span className="text-gradient">AI</span>
      </span>
      <span className="rounded-md bg-gradient-brand px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-glow">
        Pro
      </span>
    </Link>
  );
}

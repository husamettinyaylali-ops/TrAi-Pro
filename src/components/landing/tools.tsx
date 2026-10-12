import { useState } from "react";
import { Mic, Upload, Video, ImageIcon, Play, Pause, Sparkles, Loader2, Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Waveform, Reveal } from "./fx";
import g1 from "@/assets/gen1.jpg";
import g2 from "@/assets/gen2.jpg";
import g3 from "@/assets/gen3.jpg";
import g4 from "@/assets/gen4.jpg";

export const gens = [g1, g2, g3, g4];

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`glass glow-border rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 ${className}`}>{children}</div>
);

function Head({ icon: I, title, desc }: { icon: typeof Mic; title: string; desc: string }) {
  return (
    <div className="mb-5 flex items-start gap-4">
      <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-brand shadow-glow">
        <I className="h-5 w-5 text-primary-foreground" />
        <span className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-cyan" />
      </div>
      <div>
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

const btn = "inline-flex items-center gap-2 rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-105 disabled:opacity-60";
const field = "w-full rounded-xl border border-input bg-muted/60 px-4 py-2.5 text-sm outline-none focus:border-ring";

function TTS() {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  const [gender, setGender] = useState("female");
  return (
    <Card>
      <Head icon={Mic} title={t.t1} desc={t.t1d} />
      <div className="mb-4 flex gap-2">
        {(["male", "female", "child"] as const).map((g) => (
          <button key={g} onClick={() => setGender(g)}
            className={`rounded-full border px-4 py-1.5 text-xs font-medium transition ${gender === g ? "border-cyan bg-cyan/15 text-cyan" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {t[g]}
          </button>
        ))}
      </div>
      <select className={field}>
        <option>Defne · TR-İstanbul</option><option>Emre · TR-Ankara</option><option>Sarah · EN-US</option><option>James · EN-UK</option>
      </select>
      <div className="mt-4 flex items-center gap-4 rounded-2xl bg-muted/50 p-3">
        <button onClick={() => setPlaying(!playing)} className="pulse-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-primary-foreground">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <Waveform playing={playing} bars={36} />
      </div>
    </Card>
  );
}

function Clone() {
  const { t } = useI18n();
  const [step, setStep] = useState(-1);
  const start = () => {
    setStep(0);
    [1, 2, 3].forEach((s) => setTimeout(() => setStep(s), s * 1100));
  };
  return (
    <Card>
      <Head icon={Upload} title={t.t2} desc={t.t2d} />
      <button onClick={start} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); start(); }}
        className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-violet/40 bg-violet/5 py-10 transition hover:border-cyan hover:bg-cyan/5">
        <Upload className="mb-3 h-8 w-8 text-cyan" />
        <span className="font-medium">{t.dropTitle}</span>
        <span className="mt-1 text-xs text-muted-foreground">{t.dropSub}</span>
      </button>
      {step >= 0 && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-md animate-in fade-in">
          <div className="glass glow-border w-full max-w-md rounded-3xl p-8">
            <div className="mb-6 flex items-center justify-between">
              <h4 className="text-lg font-semibold">{t.t2}</h4>
              <button onClick={() => setStep(-1)} aria-label={t.close}><X className="h-5 w-5" /></button>
            </div>
            <ol className="space-y-4">
              {t.cloneSteps.map((s, i) => (
                <li key={s} className="flex items-center gap-3">
                  <span className={`grid h-8 w-8 place-items-center rounded-full text-xs ${i < step || step === 3 ? "bg-gradient-brand text-primary-foreground" : i === step ? "border border-cyan text-cyan" : "border border-border text-muted-foreground"}`}>
                    {i < step || step === 3 ? <Check className="h-4 w-4" /> : i === step ? <Loader2 className="h-4 w-4 animate-spin" /> : i + 1}
                  </span>
                  <span className={i <= step ? "" : "text-muted-foreground"}>{s}</span>
                </li>
              ))}
            </ol>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-gradient-brand transition-all duration-700" style={{ width: `${((step + 1) / 4) * 100}%` }} />
            </div>
            {step === 3 && (
              <div className="mt-6 text-center">
                <p className="mb-3 font-semibold text-gradient">{t.cloneDone}</p>
                <Waveform playing bars={30} />
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function T2V() {
  const { t } = useI18n();
  const [style, setStyle] = useState(0);
  const [prog, setProg] = useState(-1);
  const run = () => {
    setProg(0);
    let p = 0;
    const id = setInterval(() => { p += 4; setProg(p); if (p >= 100) clearInterval(id); }, 80);
  };
  return (
    <Card>
      <Head icon={Video} title={t.t3} desc={t.t3d} />
      <input className={field} defaultValue={t.videoPrompt} key={t.videoPrompt} />
      <div className="mt-3 flex flex-wrap gap-2">
        {t.styles.map((s, i) => (
          <button key={s} onClick={() => setStyle(i)} className={`rounded-full border px-3 py-1 text-xs ${style === i ? "border-magenta bg-magenta/15 text-magenta" : "border-border text-muted-foreground"}`}>{s}</button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {gens.map((g, i) => (
          <div key={i} className="aspect-video overflow-hidden rounded-lg">
            {prog >= (i + 1) * 25 ? <img src={g} alt="" loading="lazy" className="h-full w-full object-cover animate-in fade-in zoom-in-95" /> : <div className="shimmer h-full w-full" />}
          </div>
        ))}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-gradient-brand transition-all" style={{ width: `${Math.max(prog, 0)}%` }} />
      </div>
      <button onClick={run} disabled={prog >= 0 && prog < 100} className={`${btn} mt-4`}>
        {prog >= 0 && prog < 100 ? <><Loader2 className="h-4 w-4 animate-spin" />{prog}%</> : <><Sparkles className="h-4 w-4" />{t.try}</>}
      </button>
    </Card>
  );
}

function ImgGen() {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "load" | "done">("idle");
  return (
    <Card>
      <Head icon={ImageIcon} title={t.t4} desc={t.t4d} />
      <div className="flex gap-2">
        <input className={field} defaultValue={t.imgPrompt} key={t.imgPrompt} />
        <button className={btn} onClick={() => { setState("load"); setTimeout(() => setState("done"), 1600); }}>
          {state === "load" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{t.imagine}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {gens.map((g, i) => (
          <div key={i} className="aspect-square overflow-hidden rounded-xl">
            {state === "load" ? <div className="shimmer h-full w-full" /> :
              <img src={g} alt="AI" loading="lazy" width={816} height={816} className={`h-full w-full object-cover transition duration-700 hover:scale-110 ${state === "idle" ? "opacity-40 blur-sm" : ""}`} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ToolsSection() {
  const { t } = useI18n();
  return (
    <section id="features" className="relative mx-auto max-w-7xl px-6 py-28">
      <Reveal className="mb-14 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan">{t.toolsKicker}</p>
        <h2 className="mt-3 text-4xl font-bold md:text-5xl">{t.toolsTitle}</h2>
      </Reveal>
      <div className="grid gap-6 md:grid-cols-2">
        <Reveal><TTS /></Reveal>
        <Reveal delay={100}><div id="cloning"><Clone /></div></Reveal>
        <Reveal><div id="media"><T2V /></div></Reveal>
        <Reveal delay={100}><ImgGen /></Reveal>
      </div>
    </section>
  );
}

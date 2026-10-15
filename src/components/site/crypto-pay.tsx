import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Check, Clock, Copy, Loader2 } from "lucide-react";
import { toDataURL } from "qrcode";

import { useFormat, useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";
import type { TopUpIntent } from "@/lib/types";

import { btnOutline, btnPrimary, field } from "./shell";

function CopyRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Pano izni yoksa kullanıcı değeri elle seçebilir.
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 py-2 pl-4 pr-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`break-all font-mono ${strong ? "text-xl font-bold" : "text-sm"}`}>{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`${t.payment.crypto.copy}: ${label}`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:text-cyan"
      >
        {copied ? <Check className="h-4 w-4 text-cyan" /> : <Copy className="h-4 w-4" />}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? t.payment.crypto.copied : ""}
      </span>
    </div>
  );
}

/** Talebin bitişine kalan süre (ms); saniyede bir güncellenir. */
function useRemaining(expiresAt: string): number {
  const [left, setLeft] = useState(() => Date.parse(expiresAt) - Date.now());
  useEffect(() => {
    const tick = () => setLeft(Date.parse(expiresAt) - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return left;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * USDT (BEP20) ile bakiye yükleme: adres, benzersiz tutar, QR ve işlem
 * kimliğiyle doğrulama. Alıcı adresi sunucu yapılandırmasından gelir.
 */
export function CryptoPayPanel({
  intent,
  address,
  onClose,
  onDone,
}: {
  intent: TopUpIntent;
  address: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const { claimUsdt } = useApp();
  const c = t.payment.crypto;
  const [qr, setQr] = useState<string | null>(null);
  const [hash, setHash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remaining = useRemaining(intent.expiresAt);
  const expired = remaining <= 0;

  useEffect(() => {
    let alive = true;
    toDataURL(address, { margin: 1, width: 240 })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [address]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await claimUsdt(hash);
    setBusy(false);
    if (res.ok) return onDone(c.done(f.usd(res.intent.amountCents / 100)));
    if (res.error === "tooManyAttempts")
      return setError(t.auth.errors.tooManyAttempts(res.retryAfterMinutes));
    if (res.error === "network" || res.error === "unauthorized")
      return setError(t.auth.errors.network);
    setError(c.errors[res.error]);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{c.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{c.steps}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
        {qr ? (
          <img
            src={qr}
            alt={c.qrAlt}
            width={160}
            height={160}
            className="mx-auto h-40 w-40 rounded-xl"
          />
        ) : (
          <div className="shimmer mx-auto h-40 w-40 rounded-xl" aria-hidden />
        )}
        <div className="space-y-2">
          <CopyRow label={c.network} value={c.networkValue} />
          <CopyRow label={c.address} value={address} />
        </div>
      </div>

      <CopyRow label={c.amount} value={`${intent.payAmount} USDT`} strong />
      <p className="text-xs text-muted-foreground">{c.exactNote}</p>

      <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {c.warning}
      </p>

      <p
        className={`flex items-center gap-2 text-sm ${expired ? "text-destructive" : "text-muted-foreground"}`}
        aria-live="polite"
      >
        <Clock className="h-4 w-4" aria-hidden />
        {expired ? c.expired : c.expiresIn(mmss(remaining))}
      </p>

      {!expired && (
        <form onSubmit={submit} noValidate className="space-y-3">
          <div>
            <label htmlFor="tx-hash" className="mb-1.5 block text-sm font-medium">
              {c.txHash}
            </label>
            <input
              id="tx-hash"
              className={`${field} font-mono`}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              value={hash}
              onChange={(e) => setHash(e.target.value)}
              aria-describedby="tx-hash-hint"
              {...(error ? { "aria-invalid": true } : {})}
            />
            <p id="tx-hash-hint" className="mt-1.5 text-xs text-muted-foreground">
              {c.txHashHint}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || !hash.trim()} className={`${btnPrimary} w-full`}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? c.verifying : c.verify}
          </button>
        </form>
      )}

      <button type="button" onClick={onClose} className={`${btnOutline} w-full`}>
        {c.newAmount}
      </button>
    </div>
  );
}

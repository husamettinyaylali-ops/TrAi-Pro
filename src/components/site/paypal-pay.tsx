import { useEffect, useRef, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";

import { useFormat, useI18n } from "@/lib/i18n";
import { loadPaypalSdk, type PaypalButtons, type PaypalButtonsOptions } from "@/lib/paypal-sdk";
import { useApp } from "@/lib/store";
import type { ClaimErrorCode, TopUpIntent } from "@/lib/types";
import { useRemaining } from "@/lib/use-remaining";

import { ExpiryLine } from "./crypto-pay";
import { btnOutline } from "./shell";

type Message = { text: string; soft: boolean };

/**
 * PayPal hesabı ya da kartla bakiye yükleme. Sipariş sunucuda talep tutarıyla
 * açılır; kullanıcı onaylayınca sunucu tahsil edip bakiyeye yazar.
 */
export function PaypalPayPanel({
  intent,
  clientId,
  sandbox,
  onClose,
  onDone,
}: {
  intent: TopUpIntent;
  clientId: string;
  sandbox: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const { startPaypal, capturePaypal } = useApp();
  const p = t.payment.paypal;
  const box = useRef<HTMLDivElement>(null);
  const [sdk, setSdk] = useState<"loading" | "ready" | "unavailable">("loading");
  const [message, setMessage] = useState<Message | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<string | null>(null);
  const remaining = useRemaining(intent.expiresAt);
  const expired = remaining <= 0;
  // createOrder hatası kendi mesajını yazdıysa SDK'nın ardından gelen onError'ı onu ezmez.
  const reported = useRef(false);

  const errorText = (error: string, retryAfterMinutes?: number): Message => {
    if (error === "tooManyAttempts") {
      return { text: t.auth.errors.tooManyAttempts(retryAfterMinutes ?? 1), soft: false };
    }
    if (error === "network" || error === "unauthorized") {
      return { text: t.auth.errors.network, soft: false };
    }
    const errors: Partial<Record<ClaimErrorCode, string>> = p.errors;
    return {
      text: errors[error as ClaimErrorCode] ?? t.payment.failed,
      soft: error === "unconfirmed",
    };
  };

  const capture = async (orderId: string): Promise<"declined" | void> => {
    setCapturing(true);
    const res = await capturePaypal(orderId);
    setCapturing(false);
    if (res.ok) return onDone(t.payment.crypto.done(f.usd(res.intent.creditCents / 100)));
    setPendingOrder(res.error === "unconfirmed" ? orderId : null);
    setMessage(
      res.error === "tooManyAttempts"
        ? errorText(res.error, res.retryAfterMinutes)
        : errorText(res.error),
    );
    if (res.error === "declined") return "declined";
  };

  const handlers: Omit<PaypalButtonsOptions, "style"> = {
    createOrder: async () => {
      reported.current = false;
      setMessage(null);
      const res = await startPaypal(intent.id);
      if (res.ok) return res.orderId;
      reported.current = true;
      setMessage(
        res.error === "tooManyAttempts"
          ? errorText(res.error, res.retryAfterMinutes)
          : errorText(res.error),
      );
      throw new Error(res.error);
    },
    onApprove: async (data, actions) => {
      // Kart reddedilirse PayPal aynı siparişle başka kaynak seçtirir.
      if ((await capture(data.orderID)) === "declined") await actions.restart();
    },
    onCancel: () => setMessage({ text: p.cancelled, soft: true }),
    onError: () => {
      if (!reported.current) setMessage({ text: p.errors.failed, soft: false });
    },
  };
  // Düğmeler bir kez çizilir; her çağrı en güncel işleyiciye gider.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (expired) return;
    let alive = true;
    let buttons: PaypalButtons | null = null;
    loadPaypalSdk(clientId)
      .then(async (paypal) => {
        if (!alive || !box.current) return;
        buttons = paypal.Buttons({
          style: { layout: "vertical", shape: "pill", label: "pay", height: 48 },
          createOrder: () => latest.current.createOrder(),
          onApprove: (data, actions) => latest.current.onApprove(data, actions),
          onCancel: () => latest.current.onCancel?.(),
          onError: (err) => latest.current.onError?.(err),
        });
        await buttons.render(box.current);
        if (alive) setSdk("ready");
      })
      .catch(() => alive && setSdk("unavailable"));
    return () => {
      alive = false;
      buttons?.close().catch(() => {});
    };
  }, [clientId, expired]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{p.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{p.steps}</p>
      </div>

      <div className="rounded-2xl bg-muted/40 px-4 py-3">
        <p className="text-xs text-muted-foreground">{p.amount}</p>
        <p className="font-mono text-xl font-bold">{f.usd(intent.creditCents / 100)}</p>
      </div>

      {sandbox && (
        <p className="flex items-start gap-2 rounded-xl border border-border px-4 py-3 text-xs text-muted-foreground">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {p.sandbox}
        </p>
      )}

      <ExpiryLine remaining={remaining} />

      {message && (
        <p
          role={message.soft ? "status" : "alert"}
          className={`text-sm ${message.soft ? "text-muted-foreground" : "text-destructive"}`}
        >
          {message.text}
        </p>
      )}

      {capturing && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {p.capturing}
        </p>
      )}

      {pendingOrder && !capturing && (
        <button
          type="button"
          onClick={() => void capture(pendingOrder)}
          className={`${btnOutline} w-full`}
        >
          {p.recheck}
        </button>
      )}

      {!expired && sdk === "unavailable" && (
        <p role="alert" className="text-sm text-destructive">
          {p.unavailable}
        </p>
      )}
      {!expired && sdk === "loading" && (
        <div className="shimmer h-28 rounded-2xl" aria-busy="true" aria-label={p.loading} />
      )}
      {/* PayPal düğmeleri buraya çizilir; boşken yer kaplamaz. */}
      {!expired && sdk !== "unavailable" && <div ref={box} />}

      <button type="button" onClick={onClose} className={`${btnOutline} w-full`}>
        {t.payment.crypto.newAmount}
      </button>
    </div>
  );
}

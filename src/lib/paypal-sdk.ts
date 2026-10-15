/** PayPal JS SDK'nın kullandığımız kısmı. */
export interface PaypalButtonsOptions {
  style?: Record<string, string | number>;
  createOrder: () => Promise<string>;
  onApprove: (
    data: { orderID: string },
    actions: { restart: () => Promise<void> | void },
  ) => Promise<void>;
  onCancel?: () => void;
  onError?: (err: unknown) => void;
}

export interface PaypalButtons {
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
}

export interface PaypalNamespace {
  Buttons(options: PaypalButtonsOptions): PaypalButtons;
}

declare global {
  interface Window {
    paypal?: PaypalNamespace;
  }
}

let loading: Promise<PaypalNamespace> | null = null;

/**
 * SDK'yı ilk gerektiğinde bir kez yükler. Kart ödemesi PayPal düğmelerindeki
 * "Banka/Kredi kartı" seçeneğiyle gelir; taksit (Pay Later) ve Venmo kapalıdır.
 * Ortam (sandbox/canlı) istemci kimliğinden anlaşılır.
 */
export function loadPaypalSdk(clientId: string): Promise<PaypalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  loading ??= new Promise<PaypalNamespace>((resolve, reject) => {
    const params = new URLSearchParams({
      "client-id": clientId,
      currency: "USD",
      intent: "capture",
      components: "buttons",
      "disable-funding": "paylater,venmo",
    });
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?${params}`;
    script.async = true;
    script.onload = () =>
      window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK yüklenemedi"));
    script.onerror = () => {
      script.remove();
      loading = null;
      reject(new Error("PayPal SDK yüklenemedi"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

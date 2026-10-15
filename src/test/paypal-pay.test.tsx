import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PaypalPayPanel } from "@/components/site/paypal-pay";
import { I18nProvider } from "@/lib/i18n";
import type { PaypalButtonsOptions } from "@/lib/paypal-sdk";

const startPaypal = vi.fn();
const capturePaypal = vi.fn();
vi.mock("@/lib/store", () => ({ useApp: () => ({ startPaypal, capturePaypal }) }));

/** Sahte SDK: düğmeye verilen işleyicileri saklar. */
let options: PaypalButtonsOptions | null = null;
const loadPaypalSdk = vi.fn();
vi.mock("@/lib/paypal-sdk", () => ({ loadPaypalSdk: (id: string) => loadPaypalSdk(id) }));

const intent = {
  id: "intent-1",
  method: "paypal" as const,
  amountCents: 1_000,
  payAmount: "10.00",
  creditCents: 1_000,
  payCurrency: "USD" as const,
  status: "pending" as const,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
};

function renderPanel(onDone = vi.fn(), sandbox = true) {
  render(
    <I18nProvider>
      <PaypalPayPanel
        intent={intent}
        clientId="client-id"
        sandbox={sandbox}
        onClose={vi.fn()}
        onDone={onDone}
      />
    </I18nProvider>,
  );
  return onDone;
}

describe("PayPal ödeme paneli", () => {
  beforeEach(() => {
    options = null;
    startPaypal.mockReset();
    capturePaypal.mockReset();
    loadPaypalSdk.mockReset().mockResolvedValue({
      Buttons: (o: PaypalButtonsOptions) => {
        options = o;
        return { render: async () => {}, close: async () => {} };
      },
    });
  });

  it("tutarı ve sandbox uyarısını gösterir, düğmeleri istemci kimliğiyle yükler", async () => {
    renderPanel();
    expect(screen.getByText("$10,00")).toBeInTheDocument();
    expect(screen.getByText(/sandbox/)).toBeInTheDocument();
    await waitFor(() => expect(options).not.toBeNull());
    expect(loadPaypalSdk).toHaveBeenCalledWith("client-id");
  });

  it("sipariş sunucuda açılır; onaydan sonra tahsil edilip bildirilir", async () => {
    startPaypal.mockResolvedValue({ ok: true, orderId: "ORDER123456" });
    capturePaypal.mockResolvedValue({ ok: true, intent: { ...intent, status: "completed" } });
    const onDone = renderPanel();
    await waitFor(() => expect(options).not.toBeNull());

    await expect(options!.createOrder()).resolves.toBe("ORDER123456");
    expect(startPaypal).toHaveBeenCalledWith("intent-1");
    await act(() => options!.onApprove({ orderID: "ORDER123456" }, { restart: vi.fn() }));
    expect(capturePaypal).toHaveBeenCalledWith("ORDER123456");
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining("$10,00"));
  });

  it("kart reddinde mesaj gösterir ve PayPal'a yeniden seçtirir", async () => {
    capturePaypal.mockResolvedValue({ ok: false, error: "declined" });
    renderPanel();
    await waitFor(() => expect(options).not.toBeNull());
    const restart = vi.fn();
    await act(() => options!.onApprove({ orderID: "ORDER123456" }, { restart }));
    expect(restart).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("reddetti");
  });

  it("incelemedeki ödeme için tekrar kontrol düğmesi çıkar", async () => {
    capturePaypal
      .mockResolvedValueOnce({ ok: false, error: "unconfirmed" })
      .mockResolvedValueOnce({ ok: true, intent: { ...intent, status: "completed" } });
    const onDone = renderPanel();
    await waitFor(() => expect(options).not.toBeNull());
    await act(() => options!.onApprove({ orderID: "ORDER123456" }, { restart: vi.fn() }));
    expect(screen.getByRole("status")).toHaveTextContent("inceleniyor");

    await act(async () => screen.getByRole("button", { name: "Tekrar kontrol et" }).click());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(capturePaypal).toHaveBeenCalledTimes(2);
  });

  it("sipariş açılamazsa sunucunun mesajı kalır, SDK'nın genel hatası onu ezmez", async () => {
    startPaypal.mockResolvedValue({ ok: false, error: "noPending" });
    renderPanel();
    await waitFor(() => expect(options).not.toBeNull());
    await act(async () => {
      await options!.createOrder().catch(() => options!.onError?.(new Error("x")));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("süresi doldu");
  });

  it("SDK yüklenemezse başka yöntem önerir", async () => {
    loadPaypalSdk.mockRejectedValue(new Error("engellendi"));
    renderPanel(vi.fn(), false);
    expect(await screen.findByRole("alert")).toHaveTextContent("PayPal yüklenemedi");
    expect(screen.queryByText(/sandbox/)).toBeNull();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CryptoPayPanel } from "@/components/site/crypto-pay";
import { I18nProvider } from "@/lib/i18n";

const claimUsdt = vi.fn();
vi.mock("@/lib/store", () => ({ useApp: () => ({ claimUsdt }) }));

const ADDRESS = "0x1111111111111111111111111111111111111111";
const intent = (minutes: number) => ({
  id: "t1",
  method: "usdt_bep20" as const,
  amountCents: 1_000,
  payAmount: "10.0347",
  payCurrency: "USDT" as const,
  status: "pending" as const,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
});

function renderPanel(minutes = 60, onDone = vi.fn()) {
  render(
    <I18nProvider>
      <CryptoPayPanel intent={intent(minutes)} address={ADDRESS} onClose={vi.fn()} onDone={onDone} />
    </I18nProvider>,
  );
  return onDone;
}

describe("USDT ödeme paneli", () => {
  beforeEach(() => claimUsdt.mockReset());

  it("ağı, adresi, benzersiz tutarı ve kalan süreyi gösterir", () => {
    renderPanel();
    expect(screen.getByText("BSC – Binance Smart Chain (BEP20)")).toBeInTheDocument();
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(screen.getByText("10.0347 USDT")).toBeInTheDocument();
    expect(screen.getByText(/daha geçerli/)).toBeInTheDocument();
  });

  it("doğrulama hatası anlaşılır mesajla gösterilir", async () => {
    claimUsdt.mockResolvedValue({ ok: false, error: "amountMismatch" });
    renderPanel();
    fireEvent.change(screen.getByLabelText("İşlem kimliği (Txn Hash)"), { target: { value: "0xabc" } });
    fireEvent.click(screen.getByRole("button", { name: "Ödemeyi doğrula" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("bekleyen tutarınla eşleşmiyor");
    expect(claimUsdt).toHaveBeenCalledWith("0xabc");
  });

  it("başarıda yüklenen tutarla bildirilir", async () => {
    claimUsdt.mockResolvedValue({ ok: true, intent: { ...intent(60), status: "completed" } });
    const onDone = renderPanel();
    fireEvent.change(screen.getByLabelText("İşlem kimliği (Txn Hash)"), { target: { value: "0xabc" } });
    fireEvent.click(screen.getByRole("button", { name: "Ödemeyi doğrula" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringContaining("$10,00")));
  });

  it("süresi dolan talepte doğrulama formu gösterilmez", () => {
    renderPanel(-1);
    expect(screen.getByText(/süresi doldu/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ödemeyi doğrula" })).toBeNull();
  });
});

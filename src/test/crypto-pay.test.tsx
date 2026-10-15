import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BinancePayPanel, CryptoPayPanel } from "@/components/site/crypto-pay";
import { I18nProvider } from "@/lib/i18n";

const claimUsdt = vi.fn();
const claimBinance = vi.fn();
vi.mock("@/lib/store", () => ({ useApp: () => ({ claimUsdt, claimBinance }) }));

const ADDRESS = "0x1111111111111111111111111111111111111111";
const intent = (minutes: number) => ({
  id: "t1",
  method: "usdt_bep20" as const,
  amountCents: 1_000,
  payAmount: "10.0347",
  creditCents: 1_003,
  payCurrency: "USDT" as const,
  status: "pending" as const,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
});

function renderPanel(minutes = 60, onDone = vi.fn()) {
  render(
    <I18nProvider>
      <CryptoPayPanel
        intent={intent(minutes)}
        address={ADDRESS}
        onClose={vi.fn()}
        onDone={onDone}
      />
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
    fireEvent.change(screen.getByLabelText("İşlem kimliği (Txn Hash)"), {
      target: { value: "0xabc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ödemeyi doğrula" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("bekleyen tutarınla eşleşmiyor");
    expect(claimUsdt).toHaveBeenCalledWith("0xabc");
  });

  it("başarıda yüklenen tutarla bildirilir", async () => {
    claimUsdt.mockResolvedValue({ ok: true, intent: { ...intent(60), status: "completed" } });
    const onDone = renderPanel();
    fireEvent.change(screen.getByLabelText("İşlem kimliği (Txn Hash)"), {
      target: { value: "0xabc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ödemeyi doğrula" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringContaining("$10,03")));
  });

  it("süresi dolan talepte doğrulama formu gösterilmez", () => {
    renderPanel(-1);
    expect(screen.getByText(/süresi doldu/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ödemeyi doğrula" })).toBeNull();
  });
});

describe("Binance Pay paneli", () => {
  const binanceIntent = {
    ...intent(60),
    id: "b1",
    method: "binance_pay" as const,
    payAmount: "10.37",
    creditCents: 1_037,
  };

  function renderBinance(onDone = vi.fn()) {
    render(
      <I18nProvider>
        <BinancePayPanel
          intent={binanceIntent}
          binanceId="123456789"
          onClose={vi.fn()}
          onDone={onDone}
        />
      </I18nProvider>,
    );
    return onDone;
  }

  beforeEach(() => claimBinance.mockReset());
  afterEach(() => vi.useRealTimers());

  it("Binance kimliğini, 2 ondalıklı tutarı ve bakiyeye yazılacak tutarı gösterir", () => {
    renderBinance();
    expect(screen.getByText("123456789")).toBeInTheDocument();
    expect(screen.getByText("10.37 USDT")).toBeInTheDocument();
    expect(screen.getByText(/bakiyene \$10,37 eklenir/)).toBeInTheDocument();
    expect(claimBinance).not.toHaveBeenCalled();
  });

  it("ödeme henüz yoksa bilgi verir ve 30 saniyede bir kendiliğinden kontrol eder", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    claimBinance
      .mockResolvedValueOnce({ ok: false, error: "notFound" })
      .mockResolvedValueOnce({ ok: true, intent: { ...binanceIntent, status: "completed" } });
    const onDone = renderBinance();

    fireEvent.click(screen.getByRole("button", { name: "Ödemeyi yaptım, kontrol et" }));
    expect(await screen.findByRole("status")).toHaveTextContent("henüz görünmüyor");
    expect(screen.getByText(/30 saniyede bir/)).toBeInTheDocument();
    expect(claimBinance).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(claimBinance).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringContaining("$10,37")));
  });

  it("talep artık geçerli değilse otomatik kontrol durur", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    claimBinance.mockResolvedValue({ ok: false, error: "noPending" });
    renderBinance();
    fireEvent.click(screen.getByRole("button", { name: "Ödemeyi yaptım, kontrol et" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bekleyen bir Binance Pay talebin yok",
    );
    await act(() => vi.advanceTimersByTimeAsync(90_000));
    expect(claimBinance).toHaveBeenCalledTimes(1);
  });
});

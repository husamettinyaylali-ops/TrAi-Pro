import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SetupCheck } from "@/components/admin/setup-check";
import { I18nProvider } from "@/lib/i18n";
import type { SetupItem } from "@/lib/types";

const items: SetupItem[] = [
  {
    id: "site",
    state: "ready",
    missing: [],
    warnings: [],
    info: [{ key: "admins", value: "1" }],
    testable: false,
  },
  { id: "tts", state: "ready", missing: [], warnings: [], info: [], testable: true },
  { id: "fal", state: "missing", missing: ["FAL_KEY"], warnings: [], info: [], testable: false },
  {
    id: "paypal",
    state: "warning",
    missing: [],
    warnings: ["paypalSandbox"],
    info: [{ key: "mode", value: "sandbox" }],
    testable: true,
  },
  {
    id: "binance",
    state: "optional",
    missing: ["BINANCE_PAY_ID"],
    warnings: [],
    info: [],
    testable: false,
  },
];
const test = vi.fn();

vi.mock("@/lib/admin", () => ({
  useAdminSetup: () => ({
    isPending: false,
    isFetching: false,
    data: { ok: true, production: true, items },
    refetch: vi.fn(),
  }),
  useTestSetup: () => test,
}));

function renderSetup() {
  render(
    <I18nProvider>
      <SetupCheck />
    </I18nProvider>,
  );
}
const card = (title: string) => screen.getByRole("heading", { name: title }).closest("li")!;

describe("kurulum durumu bölümü", () => {
  it("özet kullanılmayanları saymaz; durum, eksik anahtar ve uyarı yazılı", () => {
    renderSetup();
    expect(screen.getByText("2 / 4 hazır")).toBeInTheDocument();
    expect(within(card("Görsel ve video (fal.ai)")).getByText("Eksik")).toBeInTheDocument();
    expect(within(card("Görsel ve video (fal.ai)")).getByText("FAL_KEY")).toBeInTheDocument();
    expect(within(card("PayPal ve kart")).getByText(/sandbox\) modunda/)).toBeInTheDocument();
    expect(within(card("Binance Pay")).getByText("Kullanılmıyor")).toBeInTheDocument();
    // Test edilemeyen serviste düğme yok.
    expect(within(card("Görsel ve video (fal.ai)")).queryByRole("button")).toBeNull();
  });

  it("bağlantı testi sonucu ve deneme sınırı açıklanır", async () => {
    test.mockResolvedValueOnce({ ok: true, result: { ok: true, code: "voices", value: "12" } });
    renderSetup();
    const tts = card("Ses üretimi (ElevenLabs)");
    fireEvent.click(within(tts).getByRole("button", { name: "Bağlantıyı test et" }));
    expect(await within(tts).findByRole("status")).toHaveTextContent("Bağlandı: 12 ses bulundu.");
    expect(test).toHaveBeenCalledWith("tts");

    test.mockResolvedValueOnce({ ok: false, error: "tooManyAttempts", retryAfterMinutes: 4 });
    const paypal = card("PayPal ve kart");
    fireEvent.click(within(paypal).getByRole("button", { name: "Bağlantıyı test et" }));
    expect(await within(paypal).findByRole("alert")).toHaveTextContent("4");
  });
});

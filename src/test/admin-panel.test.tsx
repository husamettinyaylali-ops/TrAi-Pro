import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n";
import type { AdminUserDetail } from "@/lib/types";
import { AdminPanel } from "@/routes/admin";

let admin = true;
vi.mock("@/lib/store", () => ({ useApp: () => ({ admin }) }));

const adjust = vi.fn();
const complete = vi.fn();
const dashboard = {
  ok: true as const,
  overview: {
    users: 12,
    deletedUsers: 1,
    liabilityCents: 4_250,
    topUps24hCents: 1_037,
    pendingIntents: 2,
  },
  actions: [],
};
let dashboardData: unknown = dashboard;
const detail: AdminUserDetail = {
  user: {
    id: "u1",
    name: "Ayşe",
    email: "ayse@example.com",
    createdAt: "2026-10-01T09:00:00Z",
    verified: true,
    deletedAt: null,
    balanceCents: 500,
  },
  entries: [],
  intents: [
    {
      id: "i1",
      method: "usdt_bep20",
      amountCents: 1_000,
      payAmount: "10.0347",
      creditCents: 1_003,
      payCurrency: "USDT",
      status: "expired",
      createdAt: "2026-10-15T09:00:00Z",
      expiresAt: "2026-10-15T10:00:00Z",
      providerRef: null,
    },
  ],
  orders: [],
  actions: [],
};
vi.mock("@/lib/admin", () => ({
  useAdminDashboard: () => ({ isPending: false, data: dashboardData }),
  useAdminSearch: () => ({
    isPending: false,
    isError: false,
    isFetching: false,
    data: { ok: true, users: [detail.user] },
  }),
  useAdminUser: (id: string | null) =>
    id ? { isPending: false, isError: false, data: { ok: true, detail } } : { isPending: false },
  useAdjustBalance: () => adjust,
  useAdminIntentSearch: () => ({
    isPending: false,
    isError: false,
    isFetching: false,
    data: { ok: true, intents: [] },
  }),
  useCompleteIntent: () => complete,
}));

function renderPanel() {
  render(
    <I18nProvider>
      <AdminPanel />
    </I18nProvider>,
  );
}

describe("yönetim paneli", () => {
  beforeEach(() => {
    admin = true;
    dashboardData = dashboard;
    adjust.mockReset();
    complete.mockReset();
  });

  it("yönetici değilse ya da sunucu reddederse yalnız erişim uyarısı gösterilir", () => {
    admin = false;
    renderPanel();
    expect(screen.getByRole("alert")).toHaveTextContent("yalnız yöneticilere açık");
    expect(screen.queryByText("Aktif kullanıcı")).toBeNull();

    admin = true;
    dashboardData = { ok: false, error: "forbidden" };
    renderPanel();
    expect(screen.getAllByRole("alert")[1]).toHaveTextContent("yalnız yöneticilere açık");
  });

  it("özeti gösterir; seçilen kullanıcıya bakiye düzeltmesi gerekçeyle gönderilir", async () => {
    adjust.mockResolvedValue({ ok: true, balanceCents: 250 });
    renderPanel();
    expect(screen.getByText("Aktif kullanıcı").nextSibling).toHaveTextContent("12");
    expect(screen.getByText("$42,50")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ayşe/ }));
    fireEvent.change(screen.getByLabelText("Tutar (USD)"), { target: { value: "-2,50" } });
    fireEvent.change(screen.getByLabelText("Gerekçe"), {
      target: { value: "Yanlış yükleme geri alındı" },
    });
    const submit = screen.getByRole("button", { name: "Bakiyeden $2,50 düş" });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(adjust).toHaveBeenCalledWith({
        userId: "u1",
        amountCents: -250,
        reason: "Yanlış yükleme geri alındı",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Yeni bakiye: $2,50");
  });

  it("sunucu hatası anlaşılır mesajla gösterilir", async () => {
    adjust.mockResolvedValue({ ok: false, error: "negativeBalance" });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Ayşe/ }));
    fireEvent.change(screen.getByLabelText("Tutar (USD)"), { target: { value: "-10" } });
    fireEvent.change(screen.getByLabelText("Gerekçe"), { target: { value: "Destek #4" } });
    fireEvent.click(screen.getByRole("button", { name: "Bakiyeden $10,00 düş" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("eksiye düşer");
  });

  it("süresi dolan talep işlem kimliği ve gerekçeyle elle tamamlanır", async () => {
    complete.mockResolvedValue({ ok: true, intent: { ...detail.intents[0], status: "completed" } });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Ayşe/ }));
    fireEvent.click(screen.getByRole("button", { name: "Elle tamamla" }));
    fireEvent.change(screen.getByLabelText("İşlem kimliği (Txn Hash)"), {
      target: { value: "0xabc" },
    });
    fireEvent.change(screen.getAllByLabelText("Gerekçe")[1]!, {
      target: { value: "BscScan'de doğrulandı" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tamamla ve bakiyeye $10,03 yaz" }));
    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith({
        intentId: "i1",
        providerRef: "0xabc",
        reason: "BscScan'de doğrulandı",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("bakiyeye $10,03 yazıldı");
  });
});

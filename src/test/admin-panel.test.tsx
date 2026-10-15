import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n";
import type { AdminUserDetail } from "@/lib/types";
import { AdminPanel } from "@/routes/admin";

let admin = true;
vi.mock("@/lib/store", () => ({ useApp: () => ({ admin }) }));

const adjust = vi.fn();
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
  intents: [],
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
});

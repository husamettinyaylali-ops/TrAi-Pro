import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { ProjectSidebar } from "@/components/studio/sidebar";
import { I18nProvider } from "@/lib/i18n";
import type { Project } from "@/lib/types";

const createProject = vi.fn();
const project = (
  id: string,
  name: string,
  counts = { tts: 0, stt: 0, image: 0, video: 0 },
): Project => ({
  id,
  name,
  notes: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  counts,
});
const projects = [
  project("p1", "Bölüm 12", { tts: 3, stt: 0, image: 0, video: 1 }),
  project("p2", "Kanal tanıtımı"),
];

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/lib/store", () => ({
  useApp: () => ({ createProject, data: { grants: [] } }),
  useProjects: () => ({ data: projects, isPending: false, isError: false }),
}));

function renderSidebar(activeId?: string) {
  const onSelect = vi.fn();
  render(
    <I18nProvider>
      <ProjectSidebar activeId={activeId} onSelect={onSelect} open={false} onClose={vi.fn()} />
    </I18nProvider>,
  );
  return onSelect;
}

describe("stüdyo proje çubuğu", () => {
  beforeEach(() => createProject.mockReset());

  it("projeler yalnız olan türlerle sayılır; seçili olan işaretlidir; seçim bildirilir", () => {
    const onSelect = renderSidebar("p1");
    const active = screen.getByRole("button", { name: /^Bölüm 12/ });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveTextContent("3 ses · 1 video");
    expect(screen.getByRole("button", { name: /^Kanal tanıtımı/ })).toHaveTextContent(
      "Henüz üretim yok",
    );
    fireEvent.click(screen.getByRole("button", { name: /^Kanal tanıtımı/ }));
    expect(onSelect).toHaveBeenLastCalledWith("p2");
    fireEvent.click(screen.getByRole("button", { name: "Tüm üretimler" }));
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it("arama projeleri süzer; eşleşme yoksa söyler", () => {
    renderSidebar();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "kanal" } });
    expect(screen.queryByRole("button", { name: /^Bölüm 12/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Kanal tanıtımı/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "yok" } });
    expect(screen.getByText("Eşleşen proje yok.")).toBeInTheDocument();
  });

  it("yeni proje açılır ve seçilir; boş ad sunucuya gitmez", async () => {
    createProject.mockResolvedValueOnce({ ok: true, project: project("p3", "Podcast") });
    const onSelect = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Yeni proje" }));
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Proje adı 1–60");
    expect(createProject).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Proje adı"), { target: { value: "Podcast" } });
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("p3"));
    expect(createProject).toHaveBeenCalledWith({ name: "Podcast" });
  });

  it("kredi özeti ve kredi alma bağlantısı", () => {
    renderSidebar();
    expect(screen.getByText("Ses AI kredisi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Kredi Al/i })).toHaveAttribute("href", "/pricing");
  });
});

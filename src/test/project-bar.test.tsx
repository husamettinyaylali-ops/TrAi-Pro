import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { ProjectBar } from "@/components/labs/project-bar";
import { I18nProvider } from "@/lib/i18n";
import type { Project } from "@/lib/types";

const createProject = vi.fn();
const project = (id: string, name: string, notes = ""): Project => ({
  id,
  name,
  notes,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  counts: { tts: 0, image: 0, video: 0 },
});
const projects = [project("p1", "Bölüm 12", "Teslim cuma"), project("p2", "Tanıtım")];

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/lib/store", () => ({
  useApp: () => ({ createProject }),
  useProjects: () => ({ data: projects }),
}));

function renderBar(projectId?: string) {
  const onSelect = vi.fn();
  render(
    <I18nProvider>
      <ProjectBar projectId={projectId} onSelect={onSelect} />
    </I18nProvider>,
  );
  return onSelect;
}

describe("stüdyo proje çubuğu", () => {
  beforeEach(() => createProject.mockReset());

  it("projeler listelenir; seçim bildirilir; seçili projenin notu ve bağlantısı görünür", () => {
    const onSelect = renderBar("p1");
    const select = screen.getByLabelText("Proje");
    expect(select).toHaveValue("p1");
    expect(
      screen.getByText(
        "Yeni üretimler “Bölüm 12” projesine kaydedilir; geçmiş yalnız bu projeyi gösterir.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Teslim cuma")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projeyi aç" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "p2" } });
    expect(onSelect).toHaveBeenLastCalledWith("p2");
    fireEvent.change(select, { target: { value: "" } });
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it("yeni proje açılır ve seçilir", async () => {
    createProject.mockResolvedValueOnce({ ok: true, project: project("p3", "Kapanış") });
    const onSelect = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Yeni proje" }));
    fireEvent.change(screen.getByLabelText("Proje adı"), { target: { value: "Kapanış" } });
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("p3"));
    expect(createProject).toHaveBeenCalledWith({ name: "Kapanış" });
    expect(screen.queryByLabelText("Proje adı")).toBeNull();
  });

  it("boş ad sunucuya gitmez; sınır aşımı açıklanır", async () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Yeni proje" }));
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Proje adı 1–60");
    expect(createProject).not.toHaveBeenCalled();

    createProject.mockResolvedValueOnce({ ok: false, error: "limit" });
    fireEvent.change(screen.getByLabelText("Proje adı"), { target: { value: "Fazla" } });
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    expect(await screen.findByText("En fazla 100 proje açabilirsin.")).toBeInTheDocument();
  });
});

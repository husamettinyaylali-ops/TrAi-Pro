import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { MergeEditor } from "@/components/editor/merge-editor";
import { regenerateInput } from "@/components/studio/hooks";
import { I18nProvider } from "@/lib/i18n";
import type { Generation } from "@/lib/types";

const mergeSpeech = vi.fn();
let items: Generation[] = [];

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("@/lib/store", () => ({
  useApp: () => ({ mergeSpeech }),
  useHistory: () => ({
    items,
    loading: false,
    error: false,
    retry: () => {},
    hasMore: false,
    loadingMore: false,
    loadMore: () => {},
  }),
}));

const clip = (id: string, title: string, minute: number): Generation => ({
  id,
  type: "tts",
  text: `${title} metni`,
  title,
  audioUrl: `/media/audio/${id}`,
  cost: 10,
  createdAt: new Date(Date.UTC(2026, 9, 17, 9, minute)).toISOString(),
});

function renderEditor() {
  render(
    <I18nProvider>
      <MergeEditor projectId="p1" />
    </I18nProvider>,
  );
}

describe("sesleri birleştir", () => {
  beforeEach(() => {
    mergeSpeech.mockReset();
    // Geçmiş yeniden eskiye gelir; düzenleyici eskiden yeniye gösterir. Demo ve bekleyen ses listelenmez.
    items = [
      clip("c", "Kapanış", 3),
      { ...clip("p", "Hazırlanan", 2), status: "pending" },
      { ...clip("d", "Demo", 2), audioUrl: undefined },
      clip("b", "Bölüm 1", 1),
      clip("a", "Giriş", 0),
    ];
  });

  it("eskiden yeniye listeler; en az iki ses ister", async () => {
    renderEditor();
    const list = screen.getAllByRole("listitem").map((li) => within(li).getByRole("checkbox"));
    expect(list.map((c) => c.getAttribute("aria-label") ?? c.id)).toEqual([
      "merge-a",
      "merge-b",
      "merge-c",
    ]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Giriş/ }));
    fireEvent.click(screen.getByRole("button", { name: "Birleştir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("En az iki ses seç.");
    expect(mergeSpeech).not.toHaveBeenCalled();
  });

  it("seçilenleri gösterilen sırayla, seçilen boşluk ve varsayılan adla gönderir", async () => {
    mergeSpeech.mockResolvedValueOnce({
      ok: true,
      generation: { ...clip("m", "Birleşik", 5), edit: "merge" },
    });
    renderEditor();
    fireEvent.click(screen.getByRole("checkbox", { name: /Giriş/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Kapanış/ }));
    // Kapanış'ı en üste taşı: c, a, b
    fireEvent.click(screen.getByRole("button", { name: "Kapanış: yukarı taşı" }));
    fireEvent.click(screen.getByRole("button", { name: "Kapanış: yukarı taşı" }));
    fireEvent.click(screen.getByRole("button", { name: "1 sn" }));
    expect(screen.getByRole("button", { name: "1 sn" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Birleştir" }));
    await waitFor(() =>
      expect(mergeSpeech).toHaveBeenCalledWith({
        ids: ["c", "a"],
        gapMs: 1000,
        projectId: "p1",
        title: "Birleştirilmiş ses (2 parça)",
      }),
    );
    expect(await screen.findByText(/Birleştirilmiş ses kaydedildi/)).toBeInTheDocument();
  });

  it("birleştirilemeyen sesler için nedeni söyler", async () => {
    mergeSpeech.mockResolvedValueOnce({ ok: false, error: "invalidInput" });
    renderEditor();
    fireEvent.click(screen.getByRole("checkbox", { name: /Giriş/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Bölüm 1/ }));
    fireEvent.change(screen.getByLabelText("Yeni sesin adı"), { target: { value: "Bölüm" } });
    fireEvent.click(screen.getByRole("button", { name: "Birleştir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/birleştirilemedi/);
    expect(mergeSpeech).toHaveBeenCalledWith(expect.objectContaining({ title: "Bölüm" }));
  });

  it("birleştirilmiş ses yeniden üretilmez", () => {
    expect(regenerateInput({ ...clip("m", "B", 0), voiceId: "defne", edit: "merge" })).toBeNull();
    expect(
      regenerateInput({ ...clip("t", "K", 0), voiceId: "defne", edit: "trim" }),
    ).not.toBeNull();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GenerationCard } from "@/components/studio/card";
import { regenerateInput } from "@/components/studio/hooks";
import { I18nProvider } from "@/lib/i18n";
import type { Generation } from "@/lib/types";
import { stockVoices } from "@/lib/voices";

const generate = vi.fn();
const deleteGeneration = vi.fn();
const moveGeneration = vi.fn(async () => ({ ok: true }));

vi.mock("@/lib/store", () => ({
  useApp: () => ({ generate, deleteGeneration, moveGeneration, renameGeneration: vi.fn() }),
  useProjects: () => ({ data: [] }),
}));

const now = new Date().toISOString();
const speech: Generation = {
  id: "s1",
  type: "tts",
  text: "Merhaba dünya",
  voiceId: "defne",
  title: "Giriş",
  projectId: "p1",
  cost: 13,
  createdAt: now,
};

function renderCard(g: Generation) {
  const onEdit = vi.fn();
  render(
    <I18nProvider>
      <GenerationCard g={g} voices={stockVoices} showProject={false} onEdit={onEdit} />
    </I18nProvider>,
  );
  return onEdit;
}

describe("stüdyo üretim kartı", () => {
  beforeEach(() => {
    generate.mockReset();
  });

  it("demo seste indirme nedeniyle kapalı; düzenle kaydı verir; yeniden üret aynı ayarlarla", async () => {
    generate.mockResolvedValueOnce({ ok: true, generation: { ...speech, id: "s2" } });
    const onEdit = renderCard(speech);
    expect(
      screen.getByRole("button", { name: "İndirilecek dosya yok: demo üretimde dosya oluşmaz" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    expect(onEdit).toHaveBeenCalledWith(speech);
    fireEvent.click(screen.getByRole("button", { name: "Yeniden üret" }));
    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith({
        type: "tts",
        text: "Merhaba dünya",
        voiceId: "defne",
        projectId: "p1",
        title: "Giriş",
      }),
    );
  });

  it("metni kopyalar ve bunu söyler", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    renderCard(speech);
    fireEvent.click(screen.getByRole("button", { name: "Metni kopyala" }));
    expect(await screen.findByText("Kopyalandı")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("Merhaba dünya");
  });

  it("yeniden üretim hatası kartta gösterilir", async () => {
    generate.mockResolvedValueOnce({ ok: false, error: "insufficient" });
    renderCard(speech);
    fireEvent.click(screen.getByRole("button", { name: "Yeniden üret" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/kredi/i);
  });

  it("gerçek görseller bağlantı; tek videoda doğrudan indirme bağlantısı", () => {
    renderCard({
      id: "i1",
      type: "image",
      text: "kırmızı tilki",
      fileUrls: ["/media/file/i1/0", "/media/file/i1/1"],
      cost: 2,
      createdAt: now,
    });
    expect(screen.getAllByRole("img", { name: "kırmızı tilki" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "İndir" })).toBeInTheDocument();
  });

  it("hazırlanan videoda işlem yok; başarısız iş iadeyi söyler", () => {
    const { unmount } = render(
      <I18nProvider>
        <GenerationCard
          g={{ id: "v1", type: "video", text: "gemi", status: "pending", cost: 15, createdAt: now }}
          voices={[]}
          showProject={false}
          onEdit={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Video hazırlanıyor");
    expect(screen.queryByRole("button", { name: "Yeniden üret" })).toBeNull();
    unmount();
    renderCard({
      id: "v2",
      type: "video",
      text: "gemi",
      status: "failed",
      cost: 15,
      createdAt: now,
    });
    expect(screen.getByText("Video üretilemedi; 15 kredi iade edildi.")).toBeInTheDocument();
  });

  it("altyazılı seste indirme menüsü MP3, SRT ve VTT sunar", async () => {
    renderCard({
      ...speech,
      audioUrl: "/media/audio/s1",
      subtitleUrl: "/media/subtitle/s1",
    });
    const trigger = screen.getByRole("button", { name: "İndir" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const links = await screen.findAllByRole("menuitem");
    expect(links.map((l) => [l.textContent?.trim(), l.getAttribute("href")])).toEqual([
      ["Ses (MP3)", "/media/audio/s1?download=1"],
      ["Altyazı (SRT)", "/media/subtitle/s1?format=srt&download=1"],
      ["Altyazı (VTT)", "/media/subtitle/s1?format=vtt&download=1"],
    ]);
  });

  it("altyazısı olmayan seste tek indirme bağlantısı", () => {
    renderCard({ ...speech, audioUrl: "/media/audio/s1" });
    expect(screen.getByRole("link", { name: "İndir" })).toHaveAttribute(
      "href",
      "/media/audio/s1?download=1",
    );
  });

  it("uzun seslendirme ilerlemeyi gösterir; başarısızsa iadeyi söyler", () => {
    const { unmount } = render(
      <I18nProvider>
        <GenerationCard
          g={{ ...speech, status: "pending", progress: { done: 2, total: 5 }, cost: 24_000 }}
          voices={stockVoices}
          showProject={false}
          onEdit={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Uzun metin seslendiriliyor: 2 / 5 parça.",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "2");
    expect(screen.queryByRole("button", { name: "Yeniden üret" })).toBeNull();
    unmount();
    renderCard({ ...speech, status: "failed", cost: 24_000 });
    expect(
      screen.getByText("Seslendirme tamamlanamadı; 24.000 kredi iade edildi."),
    ).toBeInTheDocument();
  });
});

describe("yeniden üretim girdisi", () => {
  it("ses, adet ve stil kayıttan; ses kimliği yoksa yeniden üretilemez", () => {
    expect(regenerateInput({ ...speech, voiceId: undefined })).toBeNull();
    expect(
      regenerateInput({
        id: "i",
        type: "image",
        text: "t",
        images: [0, 1, 2],
        cost: 3,
        createdAt: now,
      }),
    ).toMatchObject({ type: "image", count: 1 });
    expect(
      regenerateInput({
        id: "i",
        type: "image",
        text: "t",
        fileUrls: ["a", "b"],
        cost: 2,
        createdAt: now,
      }),
    ).toMatchObject({ type: "image", count: 2 });
    expect(
      regenerateInput({ id: "v", type: "video", text: "t", style: "2", cost: 15, createdAt: now }),
    ).toMatchObject({ type: "video", styleIndex: 2 });
  });
});

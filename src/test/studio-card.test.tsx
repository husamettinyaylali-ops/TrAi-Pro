import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { GenerationCard } from "@/components/studio/card";
import { regenerateInput } from "@/components/studio/hooks";
import { I18nProvider } from "@/lib/i18n";
import type { Generation } from "@/lib/types";
import { stockVoices } from "@/lib/voices";

const generate = vi.fn();
const deleteGeneration = vi.fn();
const moveGeneration = vi.fn(async () => ({ ok: true }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    className,
  }: {
    children: ReactNode;
    to: string;
    params?: { id: string };
    className?: string;
  }) => (
    <a href={params ? to.replace("$id", params.id) : to} className={className}>
      {children}
    </a>
  ),
}));
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

  it("demo seste indirme ve editör nedeniyle kapalı; metni düzenle kaydı verir; yeniden üret aynı ayarlarla", async () => {
    generate.mockResolvedValueOnce({ ok: true, generation: { ...speech, id: "s2" } });
    const onEdit = renderCard(speech);
    expect(
      screen.getByRole("button", { name: "İndirilecek dosya yok: demo üretimde dosya oluşmaz" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Demo üretimde düzenlenecek dosya yok" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Metni düzenle" }));
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
    expect(screen.getByRole("link", { name: "Editörde aç" })).toHaveAttribute("href", "/editor/i1");
    expect(screen.getByRole("button", { name: "İstemi düzenle" })).toBeInTheDocument();
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

  it("altyazısı olmayan seste tek indirme bağlantısı; gerçek ses editörde açılır", () => {
    renderCard({ ...speech, audioUrl: "/media/audio/s1" });
    expect(screen.getByRole("link", { name: "İndir" })).toHaveAttribute(
      "href",
      "/media/audio/s1?download=1",
    );
    expect(screen.getByRole("link", { name: "Editörde aç" })).toHaveAttribute("href", "/editor/s1");
  });

  it("düzenleyicide oluşan sürüm künyede belirtilir", () => {
    renderCard({ ...speech, audioUrl: "/media/audio/s3", edit: "trim", cost: 0 });
    expect(screen.getByText(/Kırpıldı · 0 kr/)).toBeInTheDocument();
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

  it("kısa video: yüzde ilerleme, başarısızlık; bitince istemi düzenlenmez ve yeniden üretilmez", () => {
    const base = {
      id: "k1",
      type: "video" as const,
      text: "Teknoloji Masası'na hoş geldiniz.",
      edit: "compose" as const,
      cost: 0,
      createdAt: now,
    };
    const { unmount } = render(
      <I18nProvider>
        <GenerationCard
          g={{ ...base, status: "pending", progress: { done: 40, total: 100 } }}
          voices={[]}
          showProject={false}
          onEdit={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Video oluşturuluyor… %40");
    unmount();
    const failed = render(
      <I18nProvider>
        <GenerationCard
          g={{ ...base, status: "failed" }}
          voices={[]}
          showProject={false}
          onEdit={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(/Video oluşturulamadı/)).toBeInTheDocument();
    failed.unmount();
    renderCard({ ...base, fileUrls: ["/media/file/k1/0"] });
    expect(screen.getByText(/Kısa video · 0 kr/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İstemi düzenle" })).toBeNull();
    expect(screen.getByRole("button", { name: "Yeniden üret" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "İndir" })).toHaveAttribute(
      "href",
      "/media/file/k1/0?download=1",
    );
  });
});

describe("yazıya dökülen kayıt kartı", () => {
  const transcript: Generation = {
    id: "t1",
    type: "stt",
    text: Array.from({ length: 8 }, (_, i) => `Paragraf ${i + 1}.`).join("\n\n"),
    title: "Röportaj",
    language: "tur",
    audioUrl: "/media/audio/t1",
    subtitleUrl: "/media/subtitle/t1",
    cost: 62,
    createdAt: now,
  };

  it("metin, dil ve ses; indirme menüsü önce metin ve altyazı; istem ve yeniden üretim yok", async () => {
    renderCard(transcript);
    expect(screen.getByText(/Sesten Yazı · Türkçe · 62 kr/)).toBeInTheDocument();
    expect(screen.getByText(/Paragraf 8\./)).toBeInTheDocument();
    const more = screen.getByRole("button", { name: "Tümünü göster" });
    fireEvent.click(more);
    expect(screen.getByRole("button", { name: "Daralt" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/Dinle: Röportaj/)).toHaveAttribute("src", "/media/audio/t1");
    expect(screen.queryByRole("button", { name: "Metni düzenle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Yeniden üret" })).toBeNull();
    expect(screen.getByRole("link", { name: "Editörde aç" })).toHaveAttribute("href", "/editor/t1");

    fireEvent.keyDown(screen.getByRole("button", { name: "İndir" }), { key: "Enter" });
    const links = await screen.findAllByRole("menuitem");
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      "Metin (TXT)",
      "Altyazı (SRT)",
      "Altyazı (VTT)",
      "Ses (MP3)",
    ]);
    expect(links[0]).toHaveAttribute("download", "trai-pro-t1.txt");
    expect(decodeURIComponent(links[0]!.getAttribute("href")!)).toBe(
      `data:text/plain;charset=utf-8,${transcript.text}`,
    );
  });

  it("hazırlanırken bekleme, başarısızsa iade söylenir", () => {
    const { unmount } = render(
      <I18nProvider>
        <GenerationCard
          g={{ ...transcript, text: "", status: "pending" }}
          voices={[]}
          showProject={false}
          onEdit={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Kayıt yazıya dökülüyor");
    unmount();
    renderCard({ ...transcript, text: "", status: "failed", audioUrl: undefined });
    expect(screen.getByText(/Yazıya dökülemedi .*62 kredi iade edildi\./)).toBeInTheDocument();
    // Başarısız işte indirilecek dosya ve kopyalanacak metin yok.
    expect(screen.queryByRole("button", { name: /İndir/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Metni kopyala" })).toBeNull();
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

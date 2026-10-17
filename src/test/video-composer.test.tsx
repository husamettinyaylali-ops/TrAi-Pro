import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { VideoComposer } from "@/components/editor/video-composer";
import { I18nProvider } from "@/lib/i18n";
import type { Generation } from "@/lib/types";

const composeVideo = vi.fn();
let compose = { available: true, subtitles: true };
let audios: Generation[] = [];
let images: Generation[] = [];

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("@/lib/studio-config", () => ({
  useStudioConfig: () => ({ isPending: false, data: { compose } }),
}));
vi.mock("@/lib/store", () => ({
  useApp: () => ({ composeVideo }),
  useHistory: (type: string) => ({
    items: type === "tts" ? audios : images,
    loading: false,
    error: false,
    retry: () => {},
    hasMore: false,
    loadingMore: false,
    loadMore: () => {},
  }),
}));

const at = new Date(Date.UTC(2026, 9, 17, 9)).toISOString();

function renderComposer() {
  render(
    <I18nProvider>
      <VideoComposer projectId="p1" />
    </I18nProvider>,
  );
}

describe("kısa video oluşturucu", () => {
  beforeEach(() => {
    composeVideo.mockReset();
    compose = { available: true, subtitles: true };
    audios = [
      {
        id: "a1",
        type: "tts",
        text: "Teknoloji Masası'na hoş geldiniz.",
        title: "Giriş",
        audioUrl: "/media/audio/a1",
        subtitleUrl: "/media/subtitle/a1",
        cost: 30,
        createdAt: at,
      },
      { id: "a2", type: "tts", text: "Demo ses", cost: 8, createdAt: at },
    ];
    images = [
      {
        id: "g1",
        type: "image",
        text: "kapak",
        title: "Kapak",
        fileUrls: ["/media/file/g1/0", "/media/file/g1/1"],
        cost: 2,
        createdAt: at,
      },
    ];
  });

  it("ffmpeg yoksa kapalı olduğunu söyler", () => {
    compose = { available: false, subtitles: false };
    renderComposer();
    expect(screen.getByText(/Video oluşturucu bu sunucuda kapalı/)).toBeInTheDocument();
  });

  it("görsel seçmeden göndermez; seçilen sıra ve ayarlarla gönderir", async () => {
    composeVideo.mockResolvedValueOnce({
      ok: true,
      generation: { id: "v1", type: "video", text: "", status: "pending", cost: 0, createdAt: at },
    });
    renderComposer();
    // Demo ses listelenmez; altyazılı gerçek ses seçili gelir.
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Video oluştur" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("En az bir görsel seç.");

    fireEvent.click(screen.getByRole("button", { name: "Kapak (Görsel 2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Kapak (Görsel 1)" }));
    expect(screen.getByRole("button", { name: "Kapak (Görsel 2)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Yatay 16:9" }));
    const group = (name: string) => within(screen.getByRole("group", { name }));
    fireEvent.click(group("Altyazının yeri").getByRole("button", { name: "Orta" }));
    fireEvent.click(group("Altyazı boyutu").getByRole("button", { name: "Büyük" }));
    fireEvent.click(screen.getByLabelText("Görsellerde hafif yakınlaşma"));
    fireEvent.click(screen.getByRole("button", { name: "Video oluştur" }));
    await waitFor(() =>
      expect(composeVideo).toHaveBeenCalledWith({
        audioId: "a1",
        images: [
          { id: "g1", index: 1 },
          { id: "g1", index: 0 },
        ],
        format: "16:9",
        captions: { show: true, position: "middle", size: "l" },
        motion: false,
        projectId: "p1",
        title: "Giriş",
      }),
    );
    expect(await screen.findByText(/Video hazırlanıyor/)).toBeInTheDocument();
  });

  it("sunucu altyazı yazamıyorsa altyazı kapalı gönderilir", async () => {
    compose = { available: true, subtitles: false };
    composeVideo.mockResolvedValueOnce({ ok: false, error: "limit" });
    renderComposer();
    expect(screen.getByText(/videoya altyazı yazamıyor/)).toBeInTheDocument();
    expect(screen.getByLabelText("Altyazıyı videoya yaz")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Kapak (Görsel 1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Video oluştur" }));
    await waitFor(() =>
      expect(composeVideo).toHaveBeenCalledWith(
        expect.objectContaining({ captions: { show: false, position: "bottom", size: "m" } }),
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Aynı anda bir video hazırlanabilir",
    );
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { MediaStudio } from "@/components/labs/tools";
import { I18nProvider } from "@/lib/i18n";
import type { History } from "@/lib/store";
import type { Generation } from "@/lib/types";

const generate = vi.fn();
const checkVideo = vi.fn(async () => {});
const retry = vi.fn();
const loadMore = vi.fn();
const renameGeneration = vi.fn(async () => ({ ok: true }));
const moveGeneration = vi.fn(async () => ({ ok: true }));
/** useHistory'ye verilen tür ve proje süzgeci. */
const historyArgs: [string | undefined, string | undefined][] = [];
const projects = [
  {
    id: "p1",
    name: "Bölüm 12",
    notes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    counts: { tts: 0, image: 1, video: 0 },
  },
];
let generations: Generation[] = [];
/** Geçmiş kancasının durumu (yükleniyor, hata, daha fazla) testte ayarlanır. */
let historyState: Partial<History> = {};
const grant = {
  id: "g1",
  kind: "media" as const,
  packageId: "media-2d",
  credits: 100,
  remaining: 100,
  grantedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};
// Kilit ekranındaki bağlantı için yönlendirici gerekmez.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, hash }: { children: ReactNode; to: string; hash?: string }) => (
    <a href={hash ? `${to}#${hash}` : to}>{children}</a>
  ),
}));
let grants = [grant];
vi.mock("@/lib/store", () => ({
  useApp: () => ({
    data: { grants },
    generate,
    checkVideo,
    deleteGeneration: vi.fn(),
    renameGeneration,
    moveGeneration,
  }),
  useHistory: (type?: string, projectId?: string): History => {
    historyArgs.push([type, projectId]);
    return {
      items: generations.filter((g) => g.type === type),
      loading: false,
      error: false,
      retry,
      hasMore: false,
      loadingMore: false,
      loadMore,
      ...historyState,
    };
  },
  useProjects: () => ({ data: projects }),
}));
let imageMode: "live" | "demo" = "live";
vi.mock("@/lib/studio-config", () => ({
  useStudioConfig: () => ({
    data: { tts: "demo", cloning: false, image: imageMode, video: imageMode, voices: [] },
  }),
}));

function renderStudio(type: "image" | "video" = "image") {
  render(
    <I18nProvider>
      <MediaStudio type={type} />
    </I18nProvider>,
  );
}

describe("görsel stüdyosu", () => {
  beforeEach(() => {
    generate.mockReset();
    imageMode = "live";
    grants = [grant];
    historyState = {};
    generations = [
      {
        id: "gen-1",
        type: "image",
        text: "kırmızı tilki",
        fileUrls: ["/media/file/gen-1/0", "/media/file/gen-1/1"],
        cost: 2,
        createdAt: new Date().toISOString(),
      },
    ];
  });

  it("canlı kipte gerçek görselleri indirme bağlantısıyla gösterir, demo notu çıkmaz", () => {
    renderStudio();
    const imgs = screen.getAllByRole("img", { name: "kırmızı tilki" });
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "/media/file/gen-1/0",
      "/media/file/gen-1/1",
    ]);
    expect(screen.getByRole("link", { name: "Görseli indir 1" })).toHaveAttribute(
      "href",
      "/media/file/gen-1/0?download=1",
    );
    expect(screen.queryByText(/Demo önizleme/)).toBeNull();
  });

  it("demo kipte demo notu görünür", () => {
    imageMode = "demo";
    renderStudio();
    expect(screen.getByText(/Demo önizleme/)).toBeInTheDocument();
  });

  it("içerik reddi ve servis hatası kredinin düşmediğini söyler", async () => {
    generate.mockResolvedValueOnce({ ok: false, error: "contentRejected" });
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /Görsel Üret|Üret/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("içerik kurallarına takıldı");

    generate.mockResolvedValueOnce({ ok: false, error: "providerFailed" });
    fireEvent.click(screen.getByRole("button", { name: /Görsel Üret|Üret/ }));
    expect(await screen.findByText(/Üretim servisi şu an yanıt vermiyor/)).toBeInTheDocument();
  });

  describe("projeler ve düzeltme", () => {
    const titled: Generation = {
      id: "gen-2",
      type: "image",
      text: "mavi kuş",
      title: "Kapak",
      projectId: "p1",
      fileUrls: [
        "/media/file/gen-2/0",
        "/media/file/gen-2/1",
        "/media/file/gen-2/2",
        "/media/file/gen-2/3",
      ],
      cost: 4,
      createdAt: new Date().toISOString(),
    };
    const openMenu = () =>
      fireEvent.keyDown(screen.getByRole("button", { name: "Diğer işlemler" }), { key: "Enter" });

    it("projede çalışırken geçmiş o projeyi ister, üretim projeye kaydedilir", async () => {
      historyArgs.length = 0;
      generate.mockResolvedValueOnce({ ok: true, generation: { ...titled, id: "gen-3" } });
      render(
        <I18nProvider>
          <MediaStudio type="image" projectId="p1" />
        </I18nProvider>,
      );
      expect(historyArgs).toContainEqual(["image", "p1"]);
      fireEvent.click(screen.getByRole("button", { name: /Görsel Üret/ }));
      await waitFor(() =>
        expect(generate).toHaveBeenCalledWith(
          expect.objectContaining({ type: "image", projectId: "p1" }),
        ),
      );
    });

    it("düzenle: istem ve adet forma gelir; yeni sürüm eski kaydın projesinde ve adıyla üretilir", async () => {
      generations = [titled];
      generate.mockResolvedValueOnce({ ok: true, generation: { ...titled, id: "gen-4" } });
      renderStudio();
      // Süzgeçsiz geçmişte kaydın projesi görünür; ad verildiği için metin altta soluk.
      expect(screen.getByText("Bölüm 12")).toBeInTheDocument();
      expect(screen.getByText("Kapak")).toBeInTheDocument();

      openMenu();
      fireEvent.click(await screen.findByRole("menuitem", { name: "Düzenle ve yeniden üret" }));
      expect(screen.getByLabelText("İstem")).toHaveValue("mavi kuş");
      expect(screen.getByLabelText("Adet")).toHaveValue("4");
      expect(screen.getByText("“Kapak” düzenleniyor.")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Görsel Üret/ }));
      await waitFor(() =>
        expect(generate).toHaveBeenCalledWith({
          type: "image",
          text: "mavi kuş",
          count: 4,
          projectId: "p1",
          title: "Kapak",
        }),
      );
      await waitFor(() => expect(screen.queryByText("“Kapak” düzenleniyor.")).toBeNull());
    });

    it("yeniden adlandır: ad alanı açılır, Enter ile bir kez kaydedilir", async () => {
      renameGeneration.mockClear();
      generations = [titled];
      renderStudio();
      openMenu();
      fireEvent.click(await screen.findByRole("menuitem", { name: "Yeniden adlandır" }));
      const input = screen.getByRole("textbox", { name: "Yeni ad" });
      expect(input).toHaveValue("Kapak");
      fireEvent.change(input, { target: { value: "Final kapak" } });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.blur(input);
      await waitFor(() => expect(renameGeneration).toHaveBeenCalledWith("gen-2", "Final kapak"));
      expect(renameGeneration).toHaveBeenCalledOnce();
    });

    it("demo üretimde indirme kapalı ve nedeni yazılı", () => {
      generations = [{ ...titled, fileUrls: undefined, images: [0, 1] }];
      renderStudio();
      expect(
        screen.getByRole("button", { name: "İndirilecek dosya yok: demo üretimde dosya oluşmaz" }),
      ).toBeDisabled();
    });
  });

  describe("geçmiş durumları", () => {
    it("ilk sayfa yüklenirken iskelet gösterir, boş metni göstermez", () => {
      generations = [];
      historyState = { loading: true };
      renderStudio();
      expect(screen.getByRole("status", { name: "Yükleniyor…" })).toBeInTheDocument();
      expect(screen.queryByText(/Henüz görsel yok/)).toBeNull();
    });

    it("yüklenemezse hata ve tekrar dene düğmesi", () => {
      retry.mockClear();
      generations = [];
      historyState = { error: true };
      renderStudio();
      expect(screen.getByRole("alert")).toHaveTextContent("Geçmiş yüklenemedi.");
      fireEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
      expect(retry).toHaveBeenCalledOnce();
    });

    it("daha eski sayfa varsa düğmeyle istenir; yüklenirken düğme kapalı", () => {
      loadMore.mockClear();
      historyState = { hasMore: true };
      const { unmount } = render(
        <I18nProvider>
          <MediaStudio type="image" />
        </I18nProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Daha eski üretimleri göster" }));
      expect(loadMore).toHaveBeenCalledOnce();
      unmount();

      historyState = { hasMore: true, loadingMore: true };
      renderStudio();
      expect(screen.getByRole("button", { name: "Daha eski üretimleri göster" })).toBeDisabled();
    });

    it("paketi olmayan ve üretimi olmayan kullanıcıya kilit; geçmiş yüklenirken kilit çıkmaz", () => {
      grants = [];
      generations = [];
      historyState = { loading: true };
      const { unmount } = render(
        <I18nProvider>
          <MediaStudio type="image" />
        </I18nProvider>,
      );
      expect(screen.queryByRole("link", { name: "Paketleri gör" })).toBeNull();
      unmount();

      historyState = {};
      renderStudio();
      expect(screen.getByRole("link", { name: "Paketleri gör" })).toBeInTheDocument();
    });
  });

  describe("video", () => {
    const base = { type: "video" as const, text: "gemi", style: "0", cost: 15 };

    it("hazırlanan video için bekleme kartı gösterir ve durumu kontrol eder; silinemez", async () => {
      checkVideo.mockClear();
      generations = [{ ...base, id: "v1", status: "pending", createdAt: new Date().toISOString() }];
      renderStudio("video");
      expect(screen.getByRole("status")).toHaveTextContent("Video hazırlanıyor");
      expect(screen.queryByRole("button", { name: "Sil" })).toBeNull();
      await waitFor(() => expect(checkVideo).toHaveBeenCalledWith("v1"));
    });

    it("biten video oynatıcı ve indirme bağlantısıyla; başarısız iş iadeyi bildirir", () => {
      generations = [
        {
          ...base,
          id: "v2",
          fileUrls: ["/media/file/v2/0"],
          createdAt: new Date().toISOString(),
        },
        { ...base, id: "v3", status: "failed", createdAt: new Date().toISOString() },
      ];
      const { container } = render(
        <I18nProvider>
          <MediaStudio type="video" />
        </I18nProvider>,
      );
      expect(container.querySelector("video")).toHaveAttribute("src", "/media/file/v2/0");
      expect(screen.getByRole("link", { name: "Videoyu indir" })).toHaveAttribute(
        "href",
        "/media/file/v2/0?download=1",
      );
      expect(screen.getByText("Video üretilemedi; 15 kredi iade edildi.")).toBeInTheDocument();
    });
  });
});

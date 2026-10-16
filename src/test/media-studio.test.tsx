import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MediaStudio } from "@/components/labs/tools";
import { I18nProvider } from "@/lib/i18n";
import type { Generation } from "@/lib/types";

const generate = vi.fn();
let generations: Generation[] = [];
const grant = {
  id: "g1",
  kind: "media" as const,
  packageId: "media-2d",
  credits: 100,
  remaining: 100,
  grantedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};
vi.mock("@/lib/store", () => ({
  useApp: () => ({
    data: { grants: [grant], generations },
    generate,
    deleteGeneration: vi.fn(),
  }),
}));
let imageMode: "live" | "demo" = "live";
vi.mock("@/lib/studio-config", () => ({
  useStudioConfig: () => ({ data: { tts: "demo", cloning: false, image: imageMode, voices: [] } }),
}));

function renderStudio() {
  render(
    <I18nProvider>
      <MediaStudio type="image" />
    </I18nProvider>,
  );
}

describe("görsel stüdyosu", () => {
  beforeEach(() => {
    generate.mockReset();
    imageMode = "live";
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
    expect(await screen.findByText(/Görsel servisi şu an yanıt vermiyor/)).toBeInTheDocument();
  });
});

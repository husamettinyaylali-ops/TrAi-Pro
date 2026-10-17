import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { Composer } from "@/components/studio/composer";
import type { Tool } from "@/components/studio/hooks";
import { I18nProvider } from "@/lib/i18n";
import type { Generation } from "@/lib/types";

const generate = vi.fn();
const mediaGrant = {
  id: "g1",
  kind: "media" as const,
  packageId: "media-2d",
  credits: 100,
  remaining: 100,
  grantedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};
let grants: (typeof mediaGrant)[] = [];

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/lib/store", () => ({
  useApp: () => ({ data: { grants, clones: [] }, generate }),
}));
vi.mock("@/lib/studio-config", () => ({
  useStudioConfig: () => ({
    isPending: false,
    data: { tts: "demo", cloning: false, image: "demo", video: "demo", voices: [] },
  }),
}));

function renderComposer(
  props: Partial<{ tool: Tool; editing: Generation | null; projectId: string }> = {},
) {
  const handlers = { onTool: vi.fn(), onCancelEdit: vi.fn(), onBusy: vi.fn() };
  render(
    <I18nProvider>
      <Composer
        tool={props.tool ?? "tts"}
        projectId={props.projectId}
        editing={props.editing ?? null}
        focusSignal={0}
        {...handlers}
      />
    </I18nProvider>,
  );
  return handlers;
}

const box = () => screen.getByRole("textbox", { name: /Seslendirmek|Görseli anlat|Videoyu anlat/ });

describe("stüdyo yazma kutusu", () => {
  beforeEach(() => {
    generate.mockReset();
    grants = [];
    window.localStorage.clear();
  });

  it("Ctrl+Enter ile seçili projeye seslendirir; başarıda kutu temizlenir", async () => {
    generate.mockResolvedValueOnce({
      ok: true,
      generation: {
        id: "n1",
        type: "tts",
        text: "Merhaba",
        voiceId: "defne",
        cost: 7,
        createdAt: "",
      },
    });
    const { onBusy } = renderComposer({ projectId: "p1" });
    fireEvent.change(box(), { target: { value: "Merhaba" } });
    expect(screen.getByText("7 / 5.000 karakter")).toBeInTheDocument();
    expect(screen.getByText("7 kredi")).toBeInTheDocument();
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ type: "tts", text: "Merhaba", projectId: "p1" }),
      ),
    );
    await waitFor(() => expect(box()).toHaveValue(""));
    expect(onBusy).toHaveBeenNthCalledWith(1, "tts");
    expect(onBusy).toHaveBeenLastCalledWith(null);
  });

  it("ses ayarları istekle gider ve tarayıcıda hatırlanır; varsayılan ayar gönderilmez", async () => {
    generate.mockResolvedValue({
      ok: true,
      generation: {
        id: "n3",
        type: "tts",
        text: "Selam",
        voiceId: "defne",
        cost: 5,
        createdAt: "",
      },
    });
    renderComposer();
    fireEvent.change(box(), { target: { value: "Selam" } });
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(generate.mock.calls[0]![0]).toMatchObject({ settings: undefined });

    fireEvent.click(screen.getByRole("button", { name: "Ses ayarları" }));
    fireEvent.change(screen.getByLabelText("Hız"), { target: { value: "1.1" } });
    expect(screen.getByRole("button", { name: "Ses ayarları (Özel ayar)" })).toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "Selam" } });
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(generate.mock.calls[1]![0]).toMatchObject({
      settings: { speed: 1.1, stability: 0.5, similarity: 0.75, style: 0 },
    });
    expect(JSON.parse(window.localStorage.getItem("trai.voice-settings")!)).toMatchObject({
      speed: 1.1,
    });
  });

  it("boş metin gönderilmez; Enter tek başına yeni satırdır", () => {
    renderComposer();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Seslendir" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Seslendirmek için metin gir.");
    expect(generate).not.toHaveBeenCalled();
  });

  it("düzeltmede kaydın metni gelir; yeni sürüm eski kaydın projesi ve adıyla üretilir", async () => {
    generate.mockResolvedValueOnce({
      ok: true,
      generation: { id: "n2", type: "image", text: "mavi kuş", cost: 4, createdAt: "" },
    });
    grants = [mediaGrant];
    const editing: Generation = {
      id: "g7",
      type: "image",
      text: "mavi kuş",
      title: "Kapak",
      projectId: "p9",
      images: [0, 1, 2, 3],
      cost: 4,
      createdAt: new Date().toISOString(),
    };
    const { onCancelEdit } = renderComposer({ tool: "image", editing, projectId: "p1" });
    expect(box()).toHaveValue("mavi kuş");
    expect(screen.getByText("“Kapak” düzenleniyor.")).toBeInTheDocument();
    expect(screen.getByLabelText("Adet")).toHaveValue("4");
    fireEvent.click(screen.getByRole("button", { name: "Görsel üret" }));
    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith({
        type: "image",
        text: "mavi kuş",
        count: 4,
        projectId: "p9",
        title: "Kapak",
      }),
    );
    await waitFor(() => expect(onCancelEdit).toHaveBeenCalled());
  });

  it("paketsiz görsel isteği sunucuya gitmez, paketlere yönlendirir", () => {
    renderComposer({ tool: "image" });
    fireEvent.change(box(), { target: { value: "neon şehir" } });
    fireEvent.click(screen.getByRole("button", { name: "Görsel üret" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Video & Görsel paketi gerekir");
    expect(screen.getByRole("link", { name: "Paketleri gör" })).toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
  });

  it("sunucu hatası kutuda gösterilir; metin korunur", async () => {
    generate.mockResolvedValueOnce({ ok: false, error: "providerFailed" });
    renderComposer();
    fireEvent.change(box(), { target: { value: "Deneme" } });
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(/servis/i);
    expect(box()).toHaveValue("Deneme");
  });

  it("araç seçimi bildirilir; klon aracında metin alanı yoktur", () => {
    const { onTool } = renderComposer({ tool: "clone" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    expect(onTool).toHaveBeenCalledWith("video");
  });
});

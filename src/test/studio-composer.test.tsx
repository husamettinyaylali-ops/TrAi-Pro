import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { Composer } from "@/components/studio/composer";
import type { Tool } from "@/components/studio/hooks";
import { I18nProvider } from "@/lib/i18n";
import type { Generation } from "@/lib/types";

const generate = vi.fn();
const transcribe = vi.fn();
const prepareUpload = vi.fn();
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
let ttsMode: "demo" | "live" = "demo";
let sttOn = true;
let sfxOn = true;

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/lib/store", () => ({
  useApp: () => ({ data: { grants, clones: [] }, generate, transcribe }),
}));
vi.mock("@/lib/audio-upload", async (orig) => ({
  ...(await orig<typeof import("@/lib/audio-upload")>()),
  prepareUpload: (file: Blob) => prepareUpload(file),
}));
vi.mock("@/lib/studio-config", () => ({
  useStudioConfig: () => ({
    isPending: false,
    data: {
      tts: ttsMode,
      cloning: false,
      image: "demo",
      video: "demo",
      voices: ttsMode === "live" ? [{ id: "v1", name: "Ayla", gender: "female" }] : [],
      stt: sttOn,
      sfx: sfxOn,
    },
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
    transcribe.mockReset();
    prepareUpload.mockReset();
    grants = [];
    ttsMode = "demo";
    sttOn = true;
    sfxOn = true;
    window.localStorage.clear();
  });

  it("demo kipte uzun metin anında önizlenir; parça notu çıkmaz", () => {
    const long = Array.from({ length: 400 }, (_, i) => `Bu ${i + 1}. cümledir.`).join(" ");
    renderComposer();
    fireEvent.change(box(), { target: { value: long } });
    expect(screen.queryByText(/Uzun metin/)).toBeNull();
  });

  it("canlı kipte 5.000 karakteri aşan metnin kaç parçada seslendirileceği söylenir", () => {
    ttsMode = "live";
    const long = Array.from({ length: 400 }, (_, i) => `Bu ${i + 1}. cümledir.`).join(" ");
    renderComposer();
    fireEvent.change(box(), { target: { value: "Kısa metin." } });
    expect(screen.queryByText(/Uzun metin/)).toBeNull();
    fireEvent.change(box(), { target: { value: long } });
    expect(
      screen.getByText("Uzun metin: 2 parçada arka planda seslendirilir."),
    ).toBeInTheDocument();
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
    expect(screen.getByText("7 / 50.000 karakter")).toBeInTheDocument();
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

  it("sesten yazı: dosya hazırlanır, süreye göre ücret; dil ve projeyle yüklenir", async () => {
    const file = new File([new Uint8Array(10)], "roportaj.mp4", { type: "video/mp4" });
    const wav = new Blob([new Uint8Array(4)], { type: "audio/wav" });
    prepareUpload.mockResolvedValueOnce({ upload: wav, seconds: 61.2 });
    transcribe.mockResolvedValueOnce({
      ok: true,
      generation: { id: "t1", type: "stt", text: "", status: "pending", cost: 62, createdAt: "" },
    });
    const { onBusy } = renderComposer({ tool: "stt", projectId: "p1" });
    expect(screen.queryByRole("textbox")).toBeNull();
    const send = screen.getByRole("button", { name: "Yazıya dök" });
    expect(send).toBeDisabled();

    fireEvent.change(document.getElementById("stt-file")!, { target: { files: [file] } });
    expect(await screen.findByText("roportaj.mp4")).toBeInTheDocument();
    expect(prepareUpload).toHaveBeenCalledWith(file);
    expect(screen.getByText("62 kredi")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Kaydın dili" }), {
      target: { value: "en" },
    });
    fireEvent.click(send);
    await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
    const form = transcribe.mock.calls[0]![0] as FormData;
    // Büyük dosyanın yalnız sesi gider; kayıt adı özgün dosyadan.
    expect((form.get("file") as File).name).toBe("kayit.wav");
    expect(form.get("name")).toBe("roportaj.mp4");
    expect(form.get("language")).toBe("en");
    expect(form.get("projectId")).toBe("p1");
    expect(onBusy).toHaveBeenCalledWith("stt");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ses ya da video dosyası seç" })).toBeVisible(),
    );
  });

  it("sesten yazı: okunamayan dosya nedeniyle; kapalı sunucuda gönderilmez", async () => {
    const { PrepareFailure } = await import("@/lib/audio-upload");
    prepareUpload.mockRejectedValueOnce(new PrepareFailure("tooLong"));
    renderComposer({ tool: "stt" });
    fireEvent.change(document.getElementById("stt-file")!, {
      target: { files: [new File([new Uint8Array(4)], "uzun.mp3")] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("en çok 1 saat");
    cleanup();

    sttOn = false;
    prepareUpload.mockResolvedValueOnce({ upload: new Blob([]), seconds: 3 });
    renderComposer({ tool: "stt" });
    expect(screen.getByText("Sesten yazıya bu sunucuda şu an kapalı.")).toBeInTheDocument();
    fireEvent.change(document.getElementById("stt-file")!, {
      target: { files: [new File([new Uint8Array(4)], "a.mp3")] },
    });
    expect(await screen.findByText("a.mp3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yazıya dök" })).toBeDisabled();
  });

  it("ses efekti: süre ve döngüyle üretir, ücret süreye göre; düzeltmede seçenekler gelir", async () => {
    generate.mockResolvedValue({
      ok: true,
      generation: { id: "e1", type: "sfx", text: "yağmur", cost: 200, createdAt: "" },
    });
    renderComposer({ tool: "sfx", projectId: "p1" });
    const prompt = screen.getByRole("textbox", { name: /Efekti anlat/ });
    expect(screen.getByText("200 kredi")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5" } });
    expect(screen.getByText("200 kredi")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "10" } });
    expect(screen.getByText("400 kredi")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Döngü" }));
    fireEvent.change(prompt, { target: { value: "  yağmur  " } });
    fireEvent.click(screen.getByRole("button", { name: "Efekt üret" }));
    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith({
        type: "sfx",
        text: "yağmur",
        duration: 10,
        loop: true,
        projectId: "p1",
        title: undefined,
      }),
    );
    cleanup();

    // Kırpılmış efektin listede olmayan süresi de seçili gelir.
    renderComposer({
      tool: "sfx",
      editing: {
        id: "e2",
        type: "sfx",
        text: "dalga",
        effect: { duration: 3.4, loop: false },
        cost: 160,
        createdAt: "",
      },
    });
    expect(screen.getByRole("textbox", { name: /Efekti anlat/ })).toHaveValue("dalga");
    expect(screen.getByRole("combobox")).toHaveValue("3.4");
    expect(screen.getByText("160 kredi")).toBeInTheDocument();
  });

  it("ses efekti kapalı sunucuda gönderilmez ve nedeni yazılır", () => {
    sfxOn = false;
    renderComposer({ tool: "sfx" });
    expect(screen.getByText("Ses efekti bu sunucuda şu an kapalı.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Efekt üret" })).toBeDisabled();
  });

  it("araç seçimi bildirilir; klon aracında metin alanı yoktur", () => {
    const { onTool } = renderComposer({ tool: "clone" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    expect(onTool).toHaveBeenCalledWith("video");
  });
});

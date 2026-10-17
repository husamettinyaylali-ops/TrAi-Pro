import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { AudioEditor } from "@/components/editor/audio-editor";
import { I18nProvider } from "@/lib/i18n";
import type { Generation } from "@/lib/types";

const trimSpeech = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("@/lib/store", () => ({ useApp: () => ({ trimSpeech }) }));

const g: Generation = {
  id: "s1",
  type: "tts",
  text: "Merhaba. Bugün deniyoruz.",
  audioUrl: "/media/audio/s1",
  subtitleUrl: "/media/subtitle/s1",
  cost: 25,
  createdAt: new Date().toISOString(),
};
const cues = [
  { start: 0, end: 1500, text: "Merhaba." },
  { start: 6000, end: 7500, text: "Bugün deniyoruz." },
];

function renderEditor() {
  const view = render(
    <I18nProvider>
      <AudioEditor g={g} />
    </I18nProvider>,
  );
  // jsdom ses çözmez: süre oynatıcının üst verisinden gelir.
  const audio = view.container.querySelector("audio")!;
  Object.defineProperty(audio, "duration", { value: 8 });
  fireEvent.loadedMetadata(audio);
  return view;
}

describe("ses düzenleyici", () => {
  beforeEach(() => {
    trimSpeech.mockReset();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("format=json") ? Response.json({ cues }) : new Response(null, { status: 404 }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("değişiklik yokken kaydetmez; kırpınca kırpılan satırı bildirir ve aralıkla kaydeder", async () => {
    trimSpeech.mockResolvedValueOnce({ ok: true, generation: { ...g, id: "s2", edit: "trim" } });
    renderEditor();
    expect(await screen.findByDisplayValue("Merhaba.")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Yeni sürüm olarak kaydet" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Başlangıç"), { target: { value: "2000" } });
    expect(screen.getByText("0:02,0 – 0:08,0 · 6,0 sn")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Merhaba.")).toBeNull();
    expect(
      screen.getByText("1 satır kırpılan bölümde kalıyor ve yeni sürüme girmeyecek."),
    ).toBeInTheDocument();

    fireEvent.click(save);
    await waitFor(() =>
      expect(trimSpeech).toHaveBeenCalledWith({
        id: "s1",
        startMs: 2000,
        endMs: 8000,
        cues: undefined,
      }),
    );
    expect(await screen.findByText(/Yeni sürüm kaydedildi/)).toBeInTheDocument();
  });

  it("bitiş başlangıca 0,5 sn'den fazla yaklaşamaz", async () => {
    renderEditor();
    await screen.findByDisplayValue("Merhaba.");
    fireEvent.change(screen.getByLabelText("Başlangıç"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Bitiş"), { target: { value: "5100" } });
    expect(screen.getByText("0:05,0 – 0:05,5 · 0,5 sn")).toBeInTheDocument();
  });

  it("düzeltilen altyazı tüm satırlarla gönderilir; hata mesajı gösterilir", async () => {
    trimSpeech.mockResolvedValueOnce({ ok: false, error: "notFound" });
    renderEditor();
    fireEvent.change(await screen.findByDisplayValue("Bugün deniyoruz."), {
      target: { value: "Bugün editörü deniyoruz." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Yeni sürüm olarak kaydet" }));
    await waitFor(() =>
      expect(trimSpeech).toHaveBeenCalledWith({
        id: "s1",
        startMs: 0,
        endMs: 8000,
        cues: [cues[0], { ...cues[1], text: "Bugün editörü deniyoruz." }],
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Kaynak dosya bulunamadı.");
  });

  it("ses çözülemezse dalga yerine not; sessizlik düğmesi kapalı", async () => {
    renderEditor();
    expect(await screen.findByText(/kırpma yine çalışır/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sessiz baş ve sonu kırp" })).toBeDisabled();
  });
});

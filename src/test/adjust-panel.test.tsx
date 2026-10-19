import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdjustPanel } from "@/components/studio/adjust-panel";
import { I18nProvider } from "@/lib/i18n";
import type { Generation } from "@/lib/types";
import type { Voice } from "@/lib/voices";

const adjustAudio = vi.fn();
const generate = vi.fn();
let ffmpeg = true;

vi.mock("@/lib/store", () => ({
  useApp: () => ({ adjustAudio, generate }),
}));
vi.mock("@/lib/studio-config", () => ({
  useStudioConfig: () => ({
    isPending: false,
    data: { tts: "live", compose: { available: ffmpeg, subtitles: true } },
  }),
}));

const VOICES: Voice[] = [
  { id: "ayla", name: "Ayla", lang: "multi", gender: "female" },
  { id: "deniz", name: "Deniz", lang: "multi", gender: "male" },
];

const speech: Generation = {
  id: "s1",
  type: "tts",
  text: "Merhaba dünya",
  voiceId: "deniz",
  voiceSettings: { speed: 1.1, stability: 0.5, similarity: 0.75, style: 0 },
  audioUrl: "/media/audio/s1",
  projectId: "p1",
  title: "Giriş",
  cost: 13,
  createdAt: new Date().toISOString(),
};

function renderPanel(g: Generation = speech) {
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <AdjustPanel g={g} voices={VOICES} id="adjust-test" onClose={onClose} />
    </I18nProvider>,
  );
  return onClose;
}

describe("ses ayarı paneli", () => {
  beforeEach(() => {
    adjustAudio.mockReset();
    generate.mockReset();
    ffmpeg = true;
  });

  it("ücretsiz ayar: değişiklik yokken kaydedilmez; hız, ses düzeyi ve geçişle yeni sürüm", async () => {
    adjustAudio.mockResolvedValueOnce({ ok: true, generation: { ...speech, id: "s2" } });
    renderPanel();
    const save = screen.getByRole("button", { name: "Yeni sürüm olarak kaydet" });
    expect(save).toBeDisabled();
    expect(screen.getByText(/Kaydetmek için hızı/)).toBeInTheDocument();
    const free = within(screen.getByRole("group", { name: "Yeniden seslendirmeden" }));
    fireEvent.change(free.getByLabelText("Hız"), { target: { value: "1.25" } });
    fireEvent.change(screen.getByLabelText("Ses düzeyi"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("Başta ve sonda yumuşak geçiş"));
    expect(screen.getByText("1,25x")).toBeInTheDocument();
    expect(screen.getByText("+3 dB")).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() =>
      expect(adjustAudio).toHaveBeenCalledWith({ id: "s1", speed: 1.25, gainDb: 3, fade: true }),
    );
    expect(await screen.findByText(/Yeni sürüm kaydedildi/)).toBeInTheDocument();
  });

  it("sunucu kapalıysa ve demo seste nedeni söylenir", () => {
    ffmpeg = false;
    const { unmount } = render(
      <I18nProvider>
        <AdjustPanel g={speech} voices={VOICES} id="a" onClose={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText(/Ücretsiz ayar bu sunucuda kapalı/)).toBeInTheDocument();
    unmount();
    ffmpeg = true;
    renderPanel({ ...speech, audioUrl: undefined });
    expect(screen.getByText(/Demo üretimde ses dosyası yok/)).toBeInTheDocument();
  });

  it("yeniden seslendir: kaydın sesi ve ayarları gelir; değişen ayarla aynı projede ve adla üretir", async () => {
    generate.mockResolvedValueOnce({ ok: true, generation: { ...speech, id: "s3" } });
    const onClose = renderPanel();
    expect(screen.getByRole("button", { name: /Seslendiren: Deniz/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Kararlılık"), { target: { value: "0.8" } });
    fireEvent.click(screen.getByRole("button", { name: "Yeniden seslendir · 13 kredi" }));
    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith({
        type: "tts",
        text: "Merhaba dünya",
        voiceId: "deniz",
        settings: { speed: 1.1, stability: 0.8, similarity: 0.75, style: 0 },
        projectId: "p1",
        title: "Giriş",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("yazıya dökülen kayıtta yalnız ücretsiz ayar var", () => {
    renderPanel({ ...speech, type: "stt", voiceId: undefined });
    expect(screen.getByLabelText("Hız")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Yeniden seslendir" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Yeniden seslendir/ })).toBeNull();
  });
});

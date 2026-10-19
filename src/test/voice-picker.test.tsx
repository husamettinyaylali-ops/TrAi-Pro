import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { VoicePicker } from "@/components/studio/voice-picker";
import { I18nProvider } from "@/lib/i18n";
import type { Voice } from "@/lib/voices";

const speak = vi.fn();
vi.mock("@/lib/voices", async (orig) => ({
  ...(await orig<typeof import("@/lib/voices")>()),
  speak: (...args: unknown[]) => speak(...args),
  stopSpeaking: () => {},
}));

/** Sahte <audio>: oluşturulan örnek adreslerini ve olay dinleyicilerini tutar. */
const created: FakeAudio[] = [];
class FakeAudio {
  listeners = new Map<string, () => void>();
  paused = true;
  constructor(readonly src: string) {
    created.push(this);
  }
  fire(type: string) {
    this.listeners.get(type)?.();
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, fn);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

const VOICES: Voice[] = [
  { id: "ayla", name: "Ayla", lang: "multi", gender: "female" },
  { id: "deniz", name: "Deniz", lang: "multi", gender: "male" },
  { id: "selin", name: "Selin", lang: "multi", gender: "female" },
  { id: "kerem", name: "Kerem", lang: "multi", gender: "male" },
  { id: "ece", name: "Ece", lang: "multi", gender: "female" },
  { id: "mert", name: "Mert", lang: "multi", gender: "male" },
  { id: "clone-1", name: "Benim sesim", lang: "multi", gender: null, cloned: true },
];

function Harness({ live, onChange }: { live: boolean; onChange: (id: string) => void }) {
  const [value, setValue] = useState("ayla");
  return (
    <VoicePicker
      voices={VOICES}
      value={value}
      live={live}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
    />
  );
}

function renderPicker(live = true) {
  const onChange = vi.fn();
  render(
    <I18nProvider>
      <Harness live={live} onChange={onChange} />
    </I18nProvider>,
  );
  return onChange;
}

const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Seslendiren: Ayla · Kadın · Çok dilli" }));

describe("seslendiren seçici", () => {
  beforeEach(() => {
    created.length = 0;
    speak.mockReset();
    vi.stubGlobal("Audio", FakeAudio);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("süzgeç ve arama listeyi daraltır; ses seçilince liste kapanır", () => {
    const onChange = renderPicker();
    open();
    const list = () => within(screen.getByRole("radiogroup", { name: "Sesler" }));
    expect(list().getAllByRole("radio")).toHaveLength(7);
    expect(list().getByRole("radio", { name: /Ayla/ })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Erkek" }));
    expect(
      list()
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["DenizErkek · Çok dilli", "KeremErkek · Çok dilli", "MertErkek · Çok dilli"]);
    fireEvent.click(screen.getByRole("button", { name: "Klonlarım" }));
    expect(list().getAllByRole("radio")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Tümü" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "se" } });
    expect(
      list()
        .getAllByRole("radio")
        .map((r) => r.textContent?.split("Kadın")[0]),
    ).toEqual(["Selin", "Benim sesimKlon · Çok dilli"]);

    fireEvent.click(list().getByRole("radio", { name: /Selin/ }));
    expect(onChange).toHaveBeenCalledWith("selin");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByRole("button", { name: /Seslendiren: Selin/ })).toBeInTheDocument();
  });

  it("dinle: sunucudaki örnek sitenin diliyle çalar, aynı anda tek örnek; hata söylenir", async () => {
    renderPicker();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Deniz sesini dinle" }));
    expect(created.at(-1)!.src).toBe("/media/voice-preview/deniz?lang=tr");
    expect(screen.getByText(/Örnek hazırlanıyor/)).toBeInTheDocument();
    act(() => created.at(-1)!.fire("playing"));
    expect(screen.getByRole("button", { name: "Deniz örneğini durdur" })).toBeInTheDocument();

    // Başka ses dinlenince önceki durur.
    fireEvent.click(screen.getByRole("button", { name: "Kerem sesini dinle" }));
    expect(created[0]!.paused).toBe(true);
    expect(created.at(-1)!.src).toBe("/media/voice-preview/kerem?lang=tr");
    act(() => created.at(-1)!.fire("error"));
    expect(screen.getByRole("alert")).toHaveTextContent("Örnek çalınamadı");
    expect(screen.getByRole("button", { name: "Kerem sesini dinle" })).toBeInTheDocument();
  });

  it("demo kipte örneği tarayıcı sesi okur", () => {
    renderPicker(false);
    open();
    expect(screen.getByText(/Demo önizleme/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ayla sesini dinle" }));
    expect(speak).toHaveBeenCalledWith(
      expect.stringContaining("Merhaba!"),
      expect.objectContaining({ id: "ayla" }),
      expect.any(Function),
    );
    expect(created).toHaveLength(0);
  });
});

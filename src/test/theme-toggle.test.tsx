import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ThemeToggle } from "@/components/site/shell";
import { I18nProvider } from "@/lib/i18n";

describe("tema düğmesi", () => {
  afterEach(() => {
    document.documentElement.className = "";
    localStorage.clear();
  });

  it("bir kopyadan değişince diğer kopya da güncellenir; tercih saklanır", async () => {
    document.documentElement.className = "dark";
    render(
      <I18nProvider>
        <ThemeToggle />
        <ThemeToggle />
      </I18nProvider>,
    );
    const [header, menu] = screen.getAllByRole("button", { name: "Açık temaya geç" });
    fireEvent.click(menu!);

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(localStorage.getItem("traipro:theme")).toBe("light");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Koyu temaya geç" })).toHaveLength(2),
    );

    // Başlıktaki kopyayla geri dönüş tek tıklamada çalışır.
    fireEvent.click(screen.getAllByRole("button", { name: "Koyu temaya geç" })[0]!);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await waitFor(() => expect(header).toHaveAccessibleName("Açık temaya geç"));
  });
});

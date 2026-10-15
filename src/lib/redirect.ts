/** Yalnız site içi yolları kabul eder; dış adrese yönlendirmeyi engeller. */
export function safeRedirect(raw: unknown, fallback = "/labs"): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

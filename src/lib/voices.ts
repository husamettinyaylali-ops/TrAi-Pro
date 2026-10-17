export interface Voice {
  id: string;
  name: string;
  lang: string;
  gender: "female" | "male" | null;
  cloned?: boolean;
}

export const stockVoices: Voice[] = [
  { id: "defne", name: "Defne", lang: "tr-TR", gender: "female" },
  { id: "emre", name: "Emre", lang: "tr-TR", gender: "male" },
  { id: "zeynep", name: "Zeynep", lang: "tr-TR", gender: "female" },
  { id: "kerem", name: "Kerem", lang: "tr-TR", gender: "male" },
  { id: "sarah", name: "Sarah", lang: "en-US", gender: "female" },
  { id: "james", name: "James", lang: "en-GB", gender: "male" },
  { id: "lucia", name: "Lucía", lang: "es-ES", gender: "female" },
  { id: "hans", name: "Hans", lang: "de-DE", gender: "male" },
];

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Tarayıcının konuşma sentezi ile önizleme çalar (`rate` ses ayarındaki hız).
 * Gerçek üretim için API bağlanmalı.
 */
export function speak(text: string, voice: Voice, onEnd: () => void, rate = 1): void {
  if (!canSpeak()) return onEnd();
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice.lang;
  u.pitch = voice.gender === "male" ? 0.8 : voice.gender === "female" ? 1.15 : 1;
  u.rate = rate;
  const all = synth.getVoices();
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  u.voice =
    all.find((v) => norm(v.lang) === norm(voice.lang)) ??
    all.find((v) => norm(v.lang).startsWith(norm(voice.lang).slice(0, 2))) ??
    null;
  u.onend = onEnd;
  u.onerror = onEnd;
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

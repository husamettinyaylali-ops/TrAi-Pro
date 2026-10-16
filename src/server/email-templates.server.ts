import type { Lang } from "@/lib/i18n";
import type { CreditKind } from "@/lib/credits";
import { signupBonus } from "@/lib/packages";
import type { TopUpMethod } from "@/lib/types";

import type { EmailMessage } from "./email.server";

type Template = Omit<EmailMessage, "to">;

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const locale = (lang: Lang) => (lang === "tr" ? "tr-TR" : "en-US");

/**
 * E-posta istemcileri CSS değişkenlerini desteklemediği için şablon renksizdir;
 * yalnız yazı tipi ve satır aralığı satır içi verilir.
 */
function html(title: string, paragraphs: string[], action?: { url: string; label: string }) {
  const body = paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n");
  const button = action
    ? `<p><a href="${esc(action.url)}"><strong>${esc(action.label)}</strong></a></p>\n<p style="font-size:13px">${esc(action.url)}</p>`
    : "";
  return `<!doctype html>
<html><body style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;max-width:560px;margin:auto;padding:24px">
<h2>${esc(title)}</h2>
${body}
${button}
<p style="font-size:12px">TrAi Pro</p>
</body></html>`;
}

export function verifyEmailTemplate(lang: Lang, name: string, url: string): Template {
  const credits = new Intl.NumberFormat(locale(lang)).format(signupBonus.credits);
  if (lang === "tr") {
    const lines = [
      `Merhaba ${name},`,
      `Hesabını etkinleştirmek ve ${credits} deneme kredisini almak için e-posta adresini doğrula.`,
      "Bağlantı 24 saat geçerlidir. Bu kaydı sen yapmadıysan bu e-postayı yok sayabilirsin.",
    ];
    return {
      subject: "TrAi Pro: e-posta adresini doğrula",
      text: `${lines[0]}\n\n${lines[1]}\n${url}\n\n${lines[2]}`,
      html: html("E-posta adresini doğrula", lines, { url, label: "E-postamı doğrula" }),
    };
  }
  const lines = [
    `Hi ${name},`,
    `Verify your email address to activate your account and get ${credits} trial credits.`,
    "The link is valid for 24 hours. If you didn't sign up, you can ignore this email.",
  ];
  return {
    subject: "TrAi Pro: verify your email address",
    text: `${lines[0]}\n\n${lines[1]}\n${url}\n\n${lines[2]}`,
    html: html("Verify your email address", lines, { url, label: "Verify my email" }),
  };
}

export function resetPasswordTemplate(lang: Lang, name: string, url: string): Template {
  if (lang === "tr") {
    const lines = [
      `Merhaba ${name},`,
      "Şifreni sıfırlamak için aşağıdaki bağlantıyı aç.",
      "Bağlantı 1 saat geçerlidir ve bir kez kullanılabilir. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; şifren değişmez.",
    ];
    return {
      subject: "TrAi Pro: şifre sıfırlama",
      text: `${lines[0]}\n\n${lines[1]}\n${url}\n\n${lines[2]}`,
      html: html("Şifre sıfırlama", lines, { url, label: "Yeni şifre belirle" }),
    };
  }
  const lines = [
    `Hi ${name},`,
    "Open the link below to reset your password.",
    "The link is valid for 1 hour and can be used once. If you didn't request this, you can ignore this email; your password won't change.",
  ];
  return {
    subject: "TrAi Pro: reset your password",
    text: `${lines[0]}\n\n${lines[1]}\n${url}\n\n${lines[2]}`,
    html: html("Reset your password", lines, { url, label: "Set a new password" }),
  };
}

export function passwordChangedTemplate(
  lang: Lang,
  name: string,
  when: Date,
  resetUrl: string,
): Template {
  const date = new Intl.DateTimeFormat(locale(lang), {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(when);
  if (lang === "tr") {
    const lines = [
      `Merhaba ${name},`,
      `Hesabının şifresi ${date} tarihinde değiştirildi. Bunu sen yaptıysan bir şey yapmana gerek yok.`,
      "Sen yapmadıysan hemen şifreni sıfırla:",
    ];
    return {
      subject: "TrAi Pro: şifren değiştirildi",
      text: `${lines.join("\n\n")}\n${resetUrl}`,
      html: html("Şifren değiştirildi", lines, { url: resetUrl, label: "Şifremi sıfırla" }),
    };
  }
  const lines = [
    `Hi ${name},`,
    `Your account password was changed on ${date}. If this was you, there's nothing to do.`,
    "If it wasn't you, reset your password right away:",
  ];
  return {
    subject: "TrAi Pro: your password was changed",
    text: `${lines.join("\n\n")}\n${resetUrl}`,
    html: html("Your password was changed", lines, { url: resetUrl, label: "Reset my password" }),
  };
}

const usd = (lang: Lang, cents: number) =>
  new Intl.NumberFormat(locale(lang), { style: "currency", currency: "USD" }).format(cents / 100);
const dateTime = (lang: Lang, d: Date) =>
  new Intl.DateTimeFormat(locale(lang), {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(d);

const METHOD_NAMES: Record<Lang, Record<TopUpMethod, string>> = {
  tr: {
    usdt_bep20: "USDT (BEP20)",
    binance_pay: "Binance Pay",
    paypal: "PayPal / Kart",
    demo: "Demo",
  },
  en: {
    usdt_bep20: "USDT (BEP20)",
    binance_pay: "Binance Pay",
    paypal: "PayPal / Card",
    demo: "Demo",
  },
};

/** Bakiye yükleme makbuzu: yöntem, yazılan tutar, güncel bakiye ve işlem numarası. */
export function topUpReceiptTemplate(
  lang: Lang,
  name: string,
  r: {
    method: TopUpMethod;
    creditCents: number;
    balanceCents: number;
    reference: string;
    when: Date;
    historyUrl: string;
  },
): Template {
  const amount = usd(lang, r.creditCents);
  const balance = usd(lang, r.balanceCents);
  const ref = r.reference.slice(0, 8).toUpperCase();
  const method = METHOD_NAMES[lang][r.method];
  if (lang === "tr") {
    const lines = [
      `Merhaba ${name},`,
      `${method} ile yaptığın ödeme doğrulandı ve bakiyene ${amount} eklendi.`,
      `Güncel bakiye: ${balance}`,
      `İşlem numarası: ${ref} · ${dateTime(lang, r.when)}`,
    ];
    return {
      subject: `TrAi Pro: bakiyene ${amount} yüklendi`,
      text: `${lines.join("\n\n")}\n\n${r.historyUrl}`,
      html: html("Bakiye yüklendi", lines, { url: r.historyUrl, label: "Ödeme geçmişini gör" }),
    };
  }
  const lines = [
    `Hi ${name},`,
    `Your ${method} payment was verified and ${amount} was added to your balance.`,
    `Current balance: ${balance}`,
    `Transaction number: ${ref} · ${dateTime(lang, r.when)}`,
  ];
  return {
    subject: `TrAi Pro: ${amount} added to your balance`,
    text: `${lines.join("\n\n")}\n\n${r.historyUrl}`,
    html: html("Balance topped up", lines, { url: r.historyUrl, label: "View payment history" }),
  };
}

/** Paket alım makbuzu: paket, kredi, son kullanma, ödenen tutar ve kalan bakiye. */
export function purchaseReceiptTemplate(
  lang: Lang,
  name: string,
  r: {
    kind: CreditKind;
    credits: number;
    days: number;
    priceCents: number;
    balanceCents: number;
    expiresAt: Date;
    studioUrl: string;
  },
): Template {
  const n = new Intl.NumberFormat(locale(lang)).format(r.credits);
  const expires = dateTime(lang, r.expiresAt);
  if (lang === "tr") {
    const pack = r.kind === "voice" ? `Ses AI · ${n} kredi` : `Video & Görsel AI · ${r.days} gün`;
    const lines = [
      `Merhaba ${name},`,
      `${pack} paketin hazır: ${n} kredi hesabına eklendi. Son kullanma: ${expires}.`,
      `Ödenen: ${usd(lang, r.priceCents)} (bakiyeden) · Kalan bakiye: ${usd(lang, r.balanceCents)}`,
    ];
    return {
      subject: `TrAi Pro: ${pack} paketin hazır`,
      text: `${lines.join("\n\n")}\n\n${r.studioUrl}`,
      html: html("Paketin hazır", lines, { url: r.studioUrl, label: "Stüdyoya git" }),
    };
  }
  const pack =
    r.kind === "voice"
      ? `Voice AI · ${n} credits`
      : `Video & Image AI · ${r.days} ${r.days === 1 ? "day" : "days"}`;
  const lines = [
    `Hi ${name},`,
    `Your ${pack} pack is ready: ${n} credits were added to your account. Expires: ${expires}.`,
    `Paid: ${usd(lang, r.priceCents)} (from balance) · Remaining balance: ${usd(lang, r.balanceCents)}`,
  ];
  return {
    subject: `TrAi Pro: your ${pack} pack is ready`,
    text: `${lines.join("\n\n")}\n\n${r.studioUrl}`,
    html: html("Your pack is ready", lines, { url: r.studioUrl, label: "Open Studio" }),
  };
}

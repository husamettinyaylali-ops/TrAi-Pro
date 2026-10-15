import type { Lang } from "@/lib/i18n";
import { signupBonus } from "@/lib/packages";

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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import nodemailer from "nodemailer";

import { env, isProduction } from "./env.server";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(msg: EmailMessage): Promise<void>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  pass: string | undefined;
  from: string;
}

/** SMTP_HOST ve EMAIL_FROM yoksa SMTP kapalıdır. */
export function smtpSettings(): SmtpSettings | null {
  const host = env("SMTP_HOST");
  const from = env("EMAIL_FROM");
  if (!host || !from) return null;
  const port = Number(env("SMTP_PORT") ?? 587);
  return {
    host,
    port,
    // 465 doğrudan TLS; 587 STARTTLS ile şifrelenir.
    secure: env("SMTP_SECURE") === "on" || port === 465,
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    from,
  };
}

export function smtpMailer(s: SmtpSettings): Mailer {
  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    ...(s.user ? { auth: { user: s.user, pass: s.pass ?? "" } } : {}),
  });
  return {
    async send(msg) {
      await transport.sendMail({ from: s.from, ...msg });
    },
  };
}

/** Geliştirmede SMTP yoksa e-postalar gönderilmez, bu klasöre dosya olarak yazılır. */
export function outboxMailer(dir = join("data", "outbox")): Mailer {
  return {
    async send(msg) {
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const base = join(dir, `${stamp}-${msg.to.replace(/[^a-z0-9@._-]/gi, "_")}`);
      writeFileSync(`${base}.html`, msg.html, "utf8");
      writeFileSync(`${base}.txt`, `Kime: ${msg.to}\nKonu: ${msg.subject}\n\n${msg.text}`, "utf8");
      console.info(
        `[e-posta] SMTP yok; ${msg.to} için "${msg.subject}" ${base}.html dosyasına yazıldı.`,
      );
    },
  };
}

/** Testlerde gönderilenleri toplar. */
export function memoryMailer(): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(msg) {
      sent.push(msg);
    },
  };
}

const unconfigured: Mailer = {
  async send() {
    throw new Error("E-posta servisi yapılandırılmamış: SMTP_HOST ve EMAIL_FROM gerekli.");
  },
};

/** SMTP ayarlıysa SMTP; değilse geliştirmede dosya kutusu, yayında hata. */
export function getMailer(): Mailer {
  const s = smtpSettings();
  if (s) return smtpMailer(s);
  return isProduction() ? unconfigured : outboxMailer();
}

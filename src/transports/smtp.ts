/**
 * SMTP transport via nodemailer.
 *
 * nodemailer is an optional peer dependency: apps that only use HTTP providers
 * do not install it. It is imported on first send, and a missing module turns
 * into an install hint instead of a crash at import time.
 */
import type { EmailMessage, EmailTransport } from "../types";
import { recipientCount } from "../types";

export interface SmtpTransportConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  /** Implicit TLS. Defaults to `port === 465`. */
  secure?: boolean;
  from: string;
}

interface SmtpSender {
  sendMail(mail: Record<string, unknown>): Promise<unknown>;
}

interface NodemailerLike {
  createTransport(options: Record<string, unknown>): SmtpSender;
}

async function loadNodemailer(): Promise<NodemailerLike> {
  try {
    const mod = (await import("nodemailer")) as unknown as { default?: NodemailerLike } & NodemailerLike;
    return mod.default ?? mod;
  } catch (cause) {
    throw new Error("nodemailer is required for the smtp transport (install it: pnpm add nodemailer)", { cause });
  }
}

export function createSmtpTransport(config: SmtpTransportConfig): EmailTransport {
  let sender: SmtpSender | undefined;

  return {
    name: "smtp",
    async send(message: EmailMessage): Promise<void> {
      if (recipientCount(message) === 0) return;

      if (!sender) {
        const nodemailer = await loadNodemailer();
        sender = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure ?? config.port === 465,
          auth: config.user ? { user: config.user, pass: config.pass } : undefined,
        });
      }

      await sender.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        ...(message.text ? { text: message.text } : {}),
        ...(message.html ? { html: message.html } : {}),
        ...(message.headers ? { headers: message.headers } : {}),
      });
    },
  };
}

/**
 * SMTP transport via nodemailer.
 *
 * nodemailer is an optional peer dependency: apps that only use HTTP providers
 * do not install it. It is imported on first send, and a missing module turns
 * into an install hint instead of a crash at import time.
 */
import type { EmailMessage, EmailTransport } from "../types";
import { recipientCount } from "../types";
import { DEFAULT_TIMEOUT_MS } from "./rest";

export interface SmtpTransportConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  /** Implicit TLS. Defaults to `port === 465`. */
  secure?: boolean;
  from: string;
  /** Connection, greeting and socket timeout in ms. Default 15000. */
  timeoutMs?: number;
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
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`nodemailer is required for the smtp transport (install it: pnpm add nodemailer): ${detail}`, { cause });
  }
}

export function createSmtpTransport(config: SmtpTransportConfig): EmailTransport {
  let sender: SmtpSender | undefined;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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
          connectionTimeout: timeoutMs,
          greetingTimeout: timeoutMs,
          socketTimeout: timeoutMs,
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

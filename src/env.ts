/**
 * Environment → transport selection. Pure: reads only the `env` object passed in.
 *
 * EMAIL_TRANSPORT pins one transport; a missing key then throws instead of
 * silently falling back. Without it, the first configured one wins:
 *   BREVO_API_KEY                         → Brevo
 *   MAILJET_API_KEY + MAILJET_API_SECRET  → Mailjet
 *   RESEND_API_KEY                        → Resend
 *   SMTP_HOST                             → SMTP (nodemailer)
 *   nothing                               → console
 */
import { createConsoleTransport } from "./transports/console";
import { createBrevoTransport } from "./transports/brevo";
import { createMailjetTransport } from "./transports/mailjet";
import { createResendTransport } from "./transports/resend";
import { createSmtpTransport } from "./transports/smtp";
import type { EmailLogger, EmailTransport, EmailTransportName } from "./types";

export type EmailEnv = Record<string, string | undefined>;

export interface ResolveOptions {
  /** Sender used when neither EMAIL_FROM nor SMTP_FROM is set. */
  defaultFrom: string;
  /** Logger for the console transport. */
  logger?: EmailLogger;
  /** fetch override for the HTTP transports (tests). */
  fetchImpl?: typeof fetch;
}

export const TRANSPORT_NAMES: readonly EmailTransportName[] = ["brevo", "mailjet", "resend", "smtp", "console"];

type SendingTransportName = Exclude<EmailTransportName, "console">;

/** Env names a pinned transport needs (for the error message). */
const REQUIRED_ENV: Record<SendingTransportName, string> = {
  brevo: "BREVO_API_KEY",
  mailjet: "MAILJET_API_KEY + MAILJET_API_SECRET",
  resend: "RESEND_API_KEY",
  smtp: "SMTP_HOST",
};

function read(env: EmailEnv, name: string): string | undefined {
  const value = env[name];
  return value && value.length > 0 ? value : undefined;
}

/** Sender address. SMTP_FROM is kept for older deployments. */
export function emailFromEnv(env: EmailEnv, defaultFrom: string): string {
  return read(env, "EMAIL_FROM") ?? read(env, "SMTP_FROM") ?? defaultFrom;
}

export function resolveTransportFromEnv(env: EmailEnv, options: ResolveOptions): EmailTransport {
  const from = emailFromEnv(env, options.defaultFrom);
  const fetchOption = options.fetchImpl ? { fetchImpl: options.fetchImpl } : {};

  const builders: Record<SendingTransportName, () => EmailTransport | undefined> = {
    brevo: () => {
      const apiKey = read(env, "BREVO_API_KEY");
      return apiKey ? createBrevoTransport({ apiKey, from, ...fetchOption }) : undefined;
    },
    mailjet: () => {
      const apiKey = read(env, "MAILJET_API_KEY");
      const apiSecret = read(env, "MAILJET_API_SECRET");
      // Key and secret only make sense as a pair.
      return apiKey && apiSecret ? createMailjetTransport({ apiKey, apiSecret, from, ...fetchOption }) : undefined;
    },
    resend: () => {
      const apiKey = read(env, "RESEND_API_KEY");
      return apiKey ? createResendTransport({ apiKey, from, ...fetchOption }) : undefined;
    },
    smtp: () => {
      const host = read(env, "SMTP_HOST");
      if (!host) return undefined;
      const secure = read(env, "SMTP_SECURE");
      return createSmtpTransport({
        host,
        port: Number(read(env, "SMTP_PORT") ?? "587"),
        user: read(env, "SMTP_USER"),
        pass: read(env, "SMTP_PASS"),
        // Unset keeps the transport default (secure on port 465).
        ...(secure !== undefined ? { secure: secure === "true" } : {}),
        from,
      });
    },
  };
  const consoleTransport = () => createConsoleTransport(options.logger ? { logger: options.logger } : {});

  const explicit = read(env, "EMAIL_TRANSPORT");
  if (explicit) {
    if (!TRANSPORT_NAMES.includes(explicit as EmailTransportName)) {
      throw new Error(`Invalid EMAIL_TRANSPORT "${explicit}" (expected: ${TRANSPORT_NAMES.join(" | ")})`);
    }
    const name = explicit as EmailTransportName;
    if (name === "console") return consoleTransport();

    const built = builders[name]();
    if (!built) throw new Error(`EMAIL_TRANSPORT="${name}" requires ${REQUIRED_ENV[name]}`);
    return built;
  }

  return builders.brevo() ?? builders.mailjet() ?? builders.resend() ?? builders.smtp() ?? consoleTransport();
}

/**
 * Transport name for a startup banner. Misconfiguration is reported as
 * "misconfigured" instead of thrown: one banner line must not stop the server.
 * Real sends still throw.
 */
export function transportLabelFromEnv(env: EmailEnv, options: ResolveOptions): EmailTransportName | "misconfigured" {
  try {
    return resolveTransportFromEnv(env, options).name;
  } catch {
    return "misconfigured";
  }
}

/**
 * Shared contracts for the email package. Nothing here reads environment
 * variables or knows about any application domain.
 */

/**
 * One message to send.
 *
 * There is intentionally no `bcc`: the HTTP providers require `to`, so a
 * bcc-only send is impossible, and filling `to` with the sender address made
 * providers actually deliver (and bounce) to it. Send to many recipients with
 * `sendEach`, one message per recipient.
 */
export interface EmailMessage {
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  /** Address replies go to: `Name <addr>` or a bare address. Each transport maps it to its provider's reply-to field. */
  replyTo?: string;
  /** Files to attach. Contents are never logged. */
  attachments?: EmailAttachment[];
  /**
   * Extra mail headers (e.g. `List-Unsubscribe`). Each transport maps them to
   * its provider's field. Values may carry unsubscribe tokens, so nothing logs them.
   */
  headers?: Record<string, string>;
  /** One-line summary the console transport logs instead of the default. */
  logSummary?: string;
}

/** One attached file. A string `content` is sent as UTF-8 text; pass bytes for binary files. */
export interface EmailAttachment {
  filename: string;
  content: string | Uint8Array;
  /** MIME type. Defaults to `application/octet-stream`. */
  contentType?: string;
}

export const DEFAULT_ATTACHMENT_TYPE = "application/octet-stream";

/** Base64 of an attachment's content, the form every HTTP provider expects. */
export function attachmentBase64(attachment: EmailAttachment): string {
  return typeof attachment.content === "string"
    ? Buffer.from(attachment.content, "utf8").toString("base64")
    : Buffer.from(attachment.content).toString("base64");
}

export type EmailTransportName = "brevo" | "mailjet" | "resend" | "smtp" | "console";

export interface EmailTransport {
  readonly name: EmailTransportName;
  send(message: EmailMessage): Promise<void>;
}

/** One recipient of a fan-out send. `locale` is passed through to the builder untouched. */
export interface EmailRecipient {
  email: string;
  locale?: string | null;
}

/** Minimal logger the package writes to. Adapt your app logger to this shape. */
export interface EmailLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Number of real recipients. Zero means the send is skipped. */
export function recipientCount(message: EmailMessage): number {
  return message.to.length;
}

/** Escape user input before placing it in an HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

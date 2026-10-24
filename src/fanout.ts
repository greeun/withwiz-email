/**
 * Fan-out = one message per recipient.
 *
 * Not one message with bcc: the HTTP providers require `to`, so a bcc-only
 * send is impossible, and the old workaround (sender address in `to`) made
 * providers deliver and bounce to it. One message per recipient also allows
 * per-recipient language and unsubscribe links.
 */
import { consoleLogger } from "./logger";
import type { EmailLogger, EmailMessage, EmailRecipient, EmailTransport } from "./types";

/** Upper bound on concurrent sends, to stay under provider rate limits. */
const CONCURRENCY = 5;

export interface SendEachOptions {
  logger?: EmailLogger;
}

/**
 * Send `build(recipient)` to every recipient, one message each.
 * Individual failures are logged and the rest continue (best effort).
 * If every recipient fails, the first error is thrown so the caller notices.
 *
 * Returns the normalized (trimmed, lower-cased) addresses that failed, for
 * callers that retry or mark individual recipients.
 */
export async function sendEach(
  transport: EmailTransport,
  recipients: EmailRecipient[],
  build: (recipient: EmailRecipient) => EmailMessage,
  options: SendEachOptions = {},
): Promise<{ failed: string[] }> {
  const logger = options.logger ?? consoleLogger;

  // Keep the first entry per normalized address (trim + lower-case), so
  // `Bob@x.com` and `bob@x.com` count as one recipient.
  const byEmail = new Map<string, EmailRecipient>();
  for (const r of recipients) {
    const key = r.email.trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, r);
  }
  const targets = [...byEmail.values()];
  if (targets.length === 0) return { failed: [] };

  const failures: unknown[] = [];
  const failedEmails: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    for (let i = cursor++; i < targets.length; i = cursor++) {
      const recipient = targets[i];
      try {
        await transport.send(build(recipient));
      } catch (e) {
        failures.push(e);
        failedEmails.push(recipient.email.trim().toLowerCase());
        logger.error("[email] send failed (single recipient)", {
          email: recipient.email,
          stack: e instanceof Error ? e.stack : String(e),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  if (failures.length === targets.length) {
    throw failures[0];
  }
  return { failed: failedEmails };
}

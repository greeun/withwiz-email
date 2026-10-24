/**
 * Logs one line per send. Callers often swallow email failures (best effort),
 * so without this the only trace of a missing email is the provider dashboard.
 * Failures are logged and rethrown unchanged.
 *
 * Bodies and headers are never logged: links carry invitation and magic-link
 * tokens. The console transport logs its own line, so no success line is added.
 */
import { consoleLogger } from "./logger";
import type { EmailLogger, EmailMessage, EmailTransport } from "./types";

export interface SendLogOptions {
  logger?: EmailLogger;
}

export function withSendLog(transport: EmailTransport, options: SendLogOptions = {}): EmailTransport {
  const logger = options.logger ?? consoleLogger;

  return {
    name: transport.name,
    async send(message: EmailMessage): Promise<void> {
      const to = message.to.join(", ");
      try {
        await transport.send(message);
        if (transport.name !== "console") {
          logger.info(`[email] send ok (${transport.name}) to ${to}  subject=${message.subject}`);
        }
      } catch (e) {
        logger.error(`[email] send failed (${transport.name}) to ${to}  subject=${message.subject}`, {
          transport: transport.name,
          to,
          subject: message.subject,
          stack: e instanceof Error ? e.stack : String(e),
        });
        throw e;
      }
    },
  };
}

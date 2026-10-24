/**
 * Console fallback: nothing is delivered. Used locally and in tests to read
 * verification links and tokens from the log.
 */
import { consoleLogger } from "../logger";
import type { EmailLogger, EmailMessage, EmailTransport } from "../types";
import { recipientCount } from "../types";

export interface ConsoleTransportOptions {
  logger?: EmailLogger;
}

export function createConsoleTransport(options: ConsoleTransportOptions = {}): EmailTransport {
  const logger = options.logger ?? consoleLogger;

  return {
    name: "console",
    async send(message: EmailMessage): Promise<void> {
      if (recipientCount(message) === 0) return;
      const summary = message.logSummary ?? `${recipientCount(message)} recipient(s)  subject=${message.subject}`;
      logger.info(`[email:console] ${summary}`);
    },
  };
}

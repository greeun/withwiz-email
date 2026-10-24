/**
 * Brevo (formerly Sendinblue) transactional email API.
 * Free tier 300/day, multiple verified domains.
 */
import { parseAddress } from "../address";
import type { EmailTransport } from "../types";
import { createRestTransport } from "./rest";

export const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export interface BrevoTransportConfig {
  apiKey: string;
  /** `Name <addr>` or a bare address. The domain must be verified in Brevo. */
  from: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createBrevoTransport(config: BrevoTransportConfig): EmailTransport {
  const sender = parseAddress(config.from);

  return createRestTransport({
    name: "brevo",
    label: "Brevo",
    endpoint: BREVO_ENDPOINT,
    headers: {
      "api-key": config.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: (message) => ({
      sender,
      to: message.to.map((email) => ({ email })),
      subject: message.subject,
      ...(message.text ? { textContent: message.text } : {}),
      ...(message.html ? { htmlContent: message.html } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
    }),
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  });
}

/**
 * Resend HTTP API. Uses REST directly instead of the `resend` SDK:
 * zero runtime dependencies and fetch injection is enough for tests.
 */
import type { EmailTransport } from "../types";
import { createRestTransport } from "./rest";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface ResendTransportConfig {
  apiKey: string;
  /** Sender on a verified domain. `Name <local@domain>` is accepted. */
  from: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createResendTransport(config: ResendTransportConfig): EmailTransport {
  return createRestTransport({
    name: "resend",
    label: "Resend",
    endpoint: RESEND_ENDPOINT,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: (message) => ({
      from: config.from,
      to: message.to,
      subject: message.subject,
      ...(message.text ? { text: message.text } : {}),
      ...(message.html ? { html: message.html } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
    }),
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  });
}

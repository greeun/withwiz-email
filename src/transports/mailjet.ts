/**
 * Mailjet Send API v3.1. Free tier 200/day, multiple verified domains.
 *
 * Mailjet reports partial failures as HTTP 200 with Messages[].Status = "error".
 * Looking at the status code alone would turn failures into silent non-delivery.
 */
import { parseAddress } from "../address";
import type { EmailTransport } from "../types";
import { createRestTransport } from "./rest";

export const MAILJET_ENDPOINT = "https://api.mailjet.com/v3.1/send";

export interface MailjetTransportConfig {
  /** Public API key. */
  apiKey: string;
  /** Secret key (the password half of Basic auth). */
  apiSecret: string;
  from: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface MailjetResult {
  Messages?: { Status?: string; Errors?: { ErrorMessage?: string }[] }[];
}

/** Collect error messages of every Messages[] entry whose Status is not success. */
function collectMessageErrors(raw: string): string[] {
  let parsed: MailjetResult;
  try {
    parsed = JSON.parse(raw) as MailjetResult;
  } catch {
    return []; // Unparseable: leave the verdict to the status code.
  }
  const failed = (parsed.Messages ?? []).filter((m) => m.Status !== "success");
  return failed.flatMap((m) =>
    (m.Errors ?? []).map((e) => e.ErrorMessage ?? "unknown").concat(m.Errors?.length ? [] : ["unknown"]),
  );
}

export function createMailjetTransport(config: MailjetTransportConfig): EmailTransport {
  const sender = parseAddress(config.from);
  const authorization = `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64")}`;

  return createRestTransport({
    name: "mailjet",
    label: "Mailjet",
    endpoint: MAILJET_ENDPOINT,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: (message) => ({
      Messages: [
        {
          From: { Email: sender.email, ...(sender.name ? { Name: sender.name } : {}) },
          To: message.to.map((Email) => ({ Email })),
          Subject: message.subject,
          ...(message.text ? { TextPart: message.text } : {}),
          ...(message.html ? { HTMLPart: message.html } : {}),
          ...(message.headers ? { Headers: message.headers } : {}),
        },
      ],
    }),
    afterOk: (raw) => {
      const errors = collectMessageErrors(raw);
      if (errors.length > 0) throw new Error(`Mailjet send failed (per message): ${errors.join(", ")}`);
    },
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  });
}

/**
 * Common skeleton for HTTP providers. Brevo, Mailjet and Resend share the same
 * round trip (injectable fetch, zero-recipient guard, throw with the response
 * body on failure); only the endpoint, headers and body schema differ.
 *
 * Zero recipients is a silent success: a fan-out that filtered every recipient
 * out (e.g. by quota) is a normal path, and throwing there would break the
 * caller's main flow.
 */
import type { EmailMessage, EmailTransport, EmailTransportName } from "../types";
import { recipientCount } from "../types";

export const DEFAULT_TIMEOUT_MS = 15_000;

export interface RestTransportSpec {
  name: EmailTransportName;
  /** Display name used in error messages (`Brevo send failed (...)`). */
  label: string;
  endpoint: string;
  headers: Record<string, string>;
  body: (message: EmailMessage) => unknown;
  fetchImpl?: typeof fetch;
  /** Abort the request after this many milliseconds. Default 15000. */
  timeoutMs?: number;
  /**
   * Post-check for providers that report failures inside a 200 body (Mailjet).
   * Receives the raw body and throws when it finds a failure.
   */
  afterOk?: (raw: string) => void;
}

export function createRestTransport(spec: RestTransportSpec): EmailTransport {
  // Resolve the global lazily so tests that stub `fetch` after creation still work.
  const doFetch: typeof fetch = spec.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: spec.name,
    async send(message: EmailMessage): Promise<void> {
      if (recipientCount(message) === 0) return;

      const response = await doFetch(spec.endpoint, {
        method: "POST",
        headers: spec.headers,
        body: JSON.stringify(spec.body(message)),
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Read the body only when needed: stubs without `text()` must keep working.
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`${spec.label} send failed (${response.status}): ${detail}`);
      }
      if (spec.afterOk) spec.afterOk(await response.text().catch(() => ""));
    },
  };
}

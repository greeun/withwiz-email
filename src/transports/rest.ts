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

/** Longest provider response body kept in an error message. */
const MAX_ERROR_BODY = 500;

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

      let response: Response;
      try {
        response = await doFetch(spec.endpoint, {
          method: "POST",
          headers: spec.headers,
          body: JSON.stringify(spec.body(message)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        const name = cause instanceof Error ? cause.name : "";
        if (name === "TimeoutError" || name === "AbortError") {
          throw new Error(`${spec.label} send failed (timeout after ${timeoutMs}ms)`, { cause });
        }
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`${spec.label} send failed: ${detail}`, { cause });
      }

      // Read the body only when needed: stubs without `text()` must keep working.
      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        const detail = raw.length > MAX_ERROR_BODY ? `${raw.slice(0, MAX_ERROR_BODY)}…` : raw;
        throw new Error(`${spec.label} send failed (${response.status}): ${detail}`);
      }
      if (spec.afterOk) spec.afterOk(await response.text().catch(() => ""));
    },
  };
}

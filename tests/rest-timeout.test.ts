import { describe, it, expect, vi } from "vitest";

import { createBrevoTransport } from "../src/transports/brevo";
import { createRestTransport, DEFAULT_TIMEOUT_MS } from "../src/transports/rest";

/** fetch that never answers until its signal aborts. */
function hangingFetch() {
  return vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
}

describe("REST transport timeout", () => {
  it("aborts when the provider does not answer within timeoutMs", async () => {
    const fetchImpl = hangingFetch();
    const transport = createBrevoTransport({
      apiKey: "k",
      from: "a@t.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
    });

    await expect(transport.send({ to: ["b@t.com"], subject: "s", text: "t" })).rejects.toThrow(/timeout|abort/i);
  });

  it("always passes an AbortSignal to fetch (default 15s)", async () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(15_000);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const transport = createRestTransport({
      name: "resend",
      label: "Resend",
      endpoint: "https://example.test",
      headers: {},
      body: () => ({}),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await transport.send({ to: ["b@t.com"], subject: "s" });

    expect((fetchImpl.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("does not call fetch when there are no recipients", async () => {
    const fetchImpl = vi.fn();
    const transport = createBrevoTransport({ apiKey: "k", from: "a@t.com", fetchImpl: fetchImpl as unknown as typeof fetch });

    await transport.send({ to: [], subject: "s" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

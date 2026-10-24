import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { sendEach } from "../src/fanout";
import type { EmailLogger, EmailMessage, EmailTransport } from "../src/types";

const logErrorMock = vi.fn();
const logger: EmailLogger = { info: vi.fn(), error: logErrorMock };

function recorder(fail?: (email: string) => boolean): EmailTransport & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    name: "console",
    sent,
    async send(message) {
      const target = message.to[0];
      if (fail?.(target)) throw new Error(`boom ${target}`);
      sent.push(message);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("sendEach", () => {
  it("sends one message per recipient (no addresses are exposed to each other)", async () => {
    const transport = recorder();

    await sendEach(transport, [{ email: "a@t.com" }, { email: "b@t.com" }, { email: "c@t.com" }], (r) => ({
      to: [r.email],
      subject: "Notice",
      text: "Body",
    }), { logger });

    expect(transport.sent).toHaveLength(3);
    expect(transport.sent.map((m) => m.to)).toEqual([["a@t.com"], ["b@t.com"], ["c@t.com"]]);
    // Putting more than one recipient in a single message exposes them to each other.
    for (const message of transport.sent) expect(message.to).toHaveLength(1);
  });

  it("does nothing when there are no recipients", async () => {
    const transport = recorder();
    await sendEach(transport, [], (r) => ({ to: [r.email], subject: "s", text: "t" }), { logger });
    expect(transport.sent).toHaveLength(0);
  });

  it("merges duplicate recipients into one message", async () => {
    const transport = recorder();

    await sendEach(transport, [{ email: "a@t.com" }, { email: "a@t.com" }, { email: "b@t.com" }], (r) => ({
      to: [r.email],
      subject: "s",
      text: "t",
    }), { logger });

    expect(transport.sent.map((m) => m.to[0])).toEqual(["a@t.com", "b@t.com"]);
  });

  it("still sends to the rest when some recipients fail, and logs the failure", async () => {
    const transport = recorder((email) => email === "b@t.com");

    await sendEach(transport, [{ email: "a@t.com" }, { email: "b@t.com" }, { email: "c@t.com" }], (r) => ({
      to: [r.email],
      subject: "s",
      text: "t",
    }), { logger });

    expect(transport.sent.map((m) => m.to[0])).toEqual(["a@t.com", "c@t.com"]);
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it("throws so the caller can tell when everyone fails", async () => {
    const transport = recorder(() => true);

    await expect(
      sendEach(transport, [{ email: "a@t.com" }, { email: "b@t.com" }], (r) => ({ to: [r.email], subject: "s", text: "t" }), { logger }),
    ).rejects.toThrow(/boom/);
  });

  it("limits concurrency (protects the provider rate limit)", async () => {
    let active = 0;
    let peak = 0;
    const transport: EmailTransport = {
      name: "console",
      async send() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      },
    };

    const recipients = Array.from({ length: 20 }, (_, i) => ({ email: `u${i}@t.com` }));
    await sendEach(transport, recipients, (r) => ({ to: [r.email], subject: "s", text: "t" }), { logger });

    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  it("passes each recipient's locale through to the build callback unchanged", async () => {
    const transport = recorder();

    await sendEach(
      transport,
      [{ email: "a@t.com", locale: "en" }, { email: "b@t.com", locale: null }],
      (r) => ({ to: [r.email], subject: `s:${r.locale ?? "none"}`, text: "t" }),
      { logger },
    );

    expect(transport.sent.map((m) => m.subject)).toEqual(["s:en", "s:none"]);
  });

  it("returns the normalized addresses that failed", async () => {
    const transport = recorder((email) => email === "B@t.com");

    const result = await sendEach(
      transport,
      [{ email: "a@t.com" }, { email: "B@t.com" }],
      (r) => ({ to: [r.email], subject: "s", text: "t" }),
      { logger },
    );

    expect(result).toEqual({ failed: ["b@t.com"] });
  });

  it("dedupes case-insensitively", async () => {
    const transport = recorder();

    await sendEach(transport, [{ email: "Bob@x.com" }, { email: "bob@x.com " }], (r) => ({ to: [r.email], subject: "s" }), { logger });

    expect(transport.sent).toHaveLength(1);
  });
});

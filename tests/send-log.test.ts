import { describe, it, expect, vi } from "vitest";

import { resolveTransportFromEnv } from "../src/env";
import { withSendLog } from "../src/send-log";
import type { EmailLogger } from "../src/types";

function setup(env: Record<string, string>, response: unknown) {
  const info = vi.fn();
  const error = vi.fn();
  const logger: EmailLogger = { info, error };
  const fetchImpl = vi.fn().mockResolvedValue(response);
  const transport = withSendLog(
    resolveTransportFromEnv(env, { defaultFrom: "App <no-reply@app.local>", logger, fetchImpl: fetchImpl as unknown as typeof fetch }),
    { logger },
  );
  return { transport, info, error };
}

const BREVO = { BREVO_API_KEY: "test-key", EMAIL_FROM: "App <no-reply@app.io>" };
const MESSAGE = { to: ["invitee@example.com"], subject: "[App] Invite", text: "hi" };

describe("withSendLog", () => {
  it("logs transport, recipients and subject on success", async () => {
    const { transport, info, error } = setup(BREVO, { ok: true, status: 201 });

    await transport.send(MESSAGE);

    const line = info.mock.calls.map((c) => String(c[0])).find((l) => l.includes("send ok"));
    expect(line).toContain("brevo");
    expect(line).toContain("invitee@example.com");
    expect(line).toContain("[App] Invite");
    expect(error).not.toHaveBeenCalled();
  });

  it("logs and rethrows provider failures", async () => {
    const { transport, error } = setup(BREVO, { ok: false, status: 400, text: async () => "invalid sender" });

    await expect(transport.send(MESSAGE)).rejects.toThrow(/Brevo send failed/);

    expect(error).toHaveBeenCalledTimes(1);
    const [line, meta] = error.mock.calls[0] as [string, Record<string, unknown>];
    expect(line).toContain("send failed");
    expect(meta.transport).toBe("brevo");
    expect(String(meta.stack)).toContain("invalid sender");
  });

  it("never logs the body (tokens in links)", async () => {
    const { transport, info, error } = setup(BREVO, { ok: true, status: 201 });

    await transport.send({ ...MESSAGE, text: "https://app.io/invite/30eec539b582c25bc720ce514c00a7fd" });

    const all = [...info.mock.calls, ...error.mock.calls].map((c) => JSON.stringify(c)).join("\n");
    expect(all).not.toContain("30eec539b582c25bc720ce514c00a7fd");
  });

  it("does not double-log for the console transport", async () => {
    const { transport, info } = setup({ EMAIL_TRANSPORT: "console" }, undefined);

    await transport.send(MESSAGE);

    const lines = info.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes("[email:console]"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("send ok"))).toHaveLength(0);
  });
});

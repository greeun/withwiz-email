import { describe, it, expect, vi } from "vitest";

import { createConsoleTransport } from "../src/transports/console";
import type { EmailLogger } from "../src/types";

function recordingLogger(): EmailLogger & { lines: string[] } {
  const lines: string[] = [];
  return { lines, info: (m) => lines.push(m), error: (m) => lines.push(m) };
}

describe("createConsoleTransport", () => {
  it("logs a default summary without body or headers", async () => {
    const logger = recordingLogger();

    await createConsoleTransport({ logger }).send({
      to: ["a@t.com", "b@t.com"],
      subject: "Hello",
      text: "secret-token-123",
      headers: { "List-Unsubscribe": "<https://t/u?token=abc>" },
    });

    expect(logger.lines).toEqual(["[email:console] 2 recipient(s)  subject=Hello"]);
  });

  it("uses logSummary when given", async () => {
    const logger = recordingLogger();
    await createConsoleTransport({ logger }).send({ to: ["a@t.com"], subject: "s", logSummary: "custom line" });
    expect(logger.lines).toEqual(["[email:console] custom line"]);
  });

  it("falls back to consoleLogger", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await createConsoleTransport().send({ to: ["a@t.com"], subject: "s" });
    expect(info).toHaveBeenCalledWith("[email:console] 1 recipient(s)  subject=s");
    info.mockRestore();
  });
});

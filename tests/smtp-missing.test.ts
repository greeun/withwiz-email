import { describe, it, expect, vi } from "vitest";

vi.mock("nodemailer", () => {
  throw new Error("Cannot find module 'nodemailer'");
});

import { createSmtpTransport } from "../src/transports/smtp";

describe("createSmtpTransport without nodemailer", () => {
  it("throws an install hint on first send", async () => {
    const transport = createSmtpTransport({ host: "h", port: 587, from: "a@t.com" });

    await expect(transport.send({ to: ["b@t.com"], subject: "s", text: "t" })).rejects.toThrow(
      /nodemailer is required/,
    );
  });
});

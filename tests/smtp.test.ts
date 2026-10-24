import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: "m-1" });
  const createTransport = vi.fn(() => ({ sendMail }));
  return { sendMail, createTransport };
});
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { createSmtpTransport } from "../src/transports/smtp";

beforeEach(() => {
  sendMail.mockClear();
  createTransport.mockClear();
});

describe("createSmtpTransport", () => {
  it("sends through nodemailer with from/to/subject/html/headers", async () => {
    const transport = createSmtpTransport({ host: "smtp.t", port: 587, user: "u", pass: "p", from: "T <a@t.com>" });

    await transport.send({ to: ["b@t.com"], subject: "s", html: "<p>x</p>", headers: { "X-A": "1" } });

    expect(transport.name).toBe("smtp");
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.t",
      port: 587,
      secure: false,
      auth: { user: "u", pass: "p" },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "T <a@t.com>",
      to: ["b@t.com"],
      subject: "s",
      html: "<p>x</p>",
      headers: { "X-A": "1" },
    });
  });

  it("defaults secure to true on port 465 and omits auth without a user", async () => {
    await createSmtpTransport({ host: "h", port: 465, from: "a@t.com" }).send({ to: ["b@t.com"], subject: "s", text: "t" });

    expect(createTransport).toHaveBeenCalledWith({ host: "h", port: 465, secure: true, auth: undefined });
  });

  it("creates the nodemailer transporter once and reuses it", async () => {
    const transport = createSmtpTransport({ host: "h", port: 587, from: "a@t.com" });
    await transport.send({ to: ["b@t.com"], subject: "1", text: "t" });
    await transport.send({ to: ["c@t.com"], subject: "2", text: "t" });

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("skips sending when there are no recipients", async () => {
    await createSmtpTransport({ host: "h", port: 587, from: "a@t.com" }).send({ to: [], subject: "s" });
    expect(sendMail).not.toHaveBeenCalled();
  });
});

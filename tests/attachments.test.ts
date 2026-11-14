import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: "m-1" });
  const createTransport = vi.fn(() => ({ sendMail }));
  return { sendMail, createTransport };
});
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { createBrevoTransport } from "../src/transports/brevo";
import { createMailjetTransport } from "../src/transports/mailjet";
import { createResendTransport } from "../src/transports/resend";
import { createSmtpTransport } from "../src/transports/smtp";
import { attachmentBase64, type EmailMessage } from "../src/types";

function stubFetch(body = "") {
  return vi.fn(async () => ({ ok: true, status: 200, text: async () => body })) as unknown as typeof fetch;
}
function sentBody(fetchImpl: typeof fetch) {
  const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
  return JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body));
}

const XML = "<ichicsr>한글</ichicsr>";
const BYTES = new Uint8Array([0, 1, 2, 250, 255]);
const message: EmailMessage = {
  to: ["a@t.com"],
  subject: "s",
  text: "t",
  replyTo: "Safety Team <safety@t.com>",
  attachments: [
    { filename: "case.xml", content: XML, contentType: "application/xml" },
    { filename: "raw.bin", content: BYTES },
  ],
};
const XML_B64 = Buffer.from(XML, "utf8").toString("base64");
const BYTES_B64 = Buffer.from(BYTES).toString("base64");

beforeEach(() => {
  sendMail.mockClear();
  createTransport.mockClear();
});

describe("attachmentBase64", () => {
  it("encodes text as UTF-8 and bytes as they are", () => {
    expect(attachmentBase64({ filename: "a", content: XML })).toBe(XML_B64);
    expect(attachmentBase64({ filename: "a", content: BYTES })).toBe(BYTES_B64);
  });
});

describe("reply-to and attachments per transport", () => {
  it("brevo: replyTo object and attachment[{ name, content }]", async () => {
    const fetchImpl = stubFetch();
    await createBrevoTransport({ apiKey: "k", from: "f@t.com", fetchImpl }).send(message);
    const body = sentBody(fetchImpl);
    expect(body.replyTo).toEqual({ name: "Safety Team", email: "safety@t.com" });
    expect(body.attachment).toEqual([
      { name: "case.xml", content: XML_B64 },
      { name: "raw.bin", content: BYTES_B64 },
    ]);
  });

  it("mailjet: ReplyTo and Attachments with a default content type", async () => {
    const fetchImpl = stubFetch(JSON.stringify({ Messages: [{ Status: "success" }] }));
    await createMailjetTransport({ apiKey: "k", apiSecret: "s", from: "f@t.com", fetchImpl }).send(message);
    const sent = sentBody(fetchImpl).Messages[0];
    expect(sent.ReplyTo).toEqual({ Email: "safety@t.com", Name: "Safety Team" });
    expect(sent.Attachments).toEqual([
      { ContentType: "application/xml", Filename: "case.xml", Base64Content: XML_B64 },
      { ContentType: "application/octet-stream", Filename: "raw.bin", Base64Content: BYTES_B64 },
    ]);
  });

  it("resend: reply_to string and attachments[{ filename, content, content_type? }]", async () => {
    const fetchImpl = stubFetch();
    await createResendTransport({ apiKey: "k", from: "f@t.com", fetchImpl }).send(message);
    const body = sentBody(fetchImpl);
    expect(body.reply_to).toBe("Safety Team <safety@t.com>");
    expect(body.attachments).toEqual([
      { filename: "case.xml", content: XML_B64, content_type: "application/xml" },
      { filename: "raw.bin", content: BYTES_B64 },
    ]);
  });

  it("smtp: replyTo and attachments passed to nodemailer (text stays text, bytes become a Buffer)", async () => {
    await createSmtpTransport({ host: "h", port: 587, from: "f@t.com" }).send(message);
    const mail = sendMail.mock.calls[0][0] as { replyTo: string; attachments: { filename: string; content: unknown; contentType?: string }[] };
    expect(mail.replyTo).toBe("Safety Team <safety@t.com>");
    expect(mail.attachments[0]).toEqual({ filename: "case.xml", content: XML, contentType: "application/xml" });
    expect(mail.attachments[1].filename).toBe("raw.bin");
    expect(Buffer.isBuffer(mail.attachments[1].content)).toBe(true);
    expect(Buffer.from(mail.attachments[1].content as Buffer).toString("base64")).toBe(BYTES_B64);
  });

  it("adds neither field when the message has none", async () => {
    const plain: EmailMessage = { to: ["a@t.com"], subject: "s", text: "t", attachments: [] };
    const brevo = stubFetch();
    await createBrevoTransport({ apiKey: "k", from: "f@t.com", fetchImpl: brevo }).send(plain);
    expect(sentBody(brevo)).not.toHaveProperty("attachment");
    expect(sentBody(brevo)).not.toHaveProperty("replyTo");
    const resend = stubFetch();
    await createResendTransport({ apiKey: "k", from: "f@t.com", fetchImpl: resend }).send(plain);
    expect(sentBody(resend)).not.toHaveProperty("attachments");
    await createSmtpTransport({ host: "h", port: 587, from: "f@t.com" }).send(plain);
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty("attachments");
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty("replyTo");
  });
});

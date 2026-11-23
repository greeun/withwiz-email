import { describe, expect, it } from "vitest";
import { MAIL_BODY_MAX_BYTES, parseRawMail } from "../../src/reader/parse";

const FALLBACK = new Date("2026-01-01T00:00:00Z");
const eml = (lines: string[]) => Buffer.from(lines.join("\r\n"), "utf8");
const HEAD = [
  "From: =?UTF-8?B?7ZmN6ri464+Z?= <hong@example.com>",
  "To: me@example.com",
  "Subject: =?UTF-8?B?7JWI64WV7ZWY7IS47JqU?=",
  "Date: Tue, 17 Nov 2026 09:00:00 +0000",
  "MIME-Version: 1.0",
];

describe("parseRawMail", () => {
  it("single text/plain part", async () => {
    const m = await parseRawMail(
      eml([...HEAD, "Content-Type: text/plain; charset=utf-8", "", "hello body"]),
      FALLBACK,
    );
    expect(m.text.trim()).toBe("hello body");
    expect(m.truncated).toBe(false);
    expect(m.from).toBe("홍길동 <hong@example.com>");
    expect(m.subject).toBe("안녕하세요");
    expect(m.receivedAt.toISOString()).toBe("2026-11-17T09:00:00.000Z");
  });

  it("HTML-only mail drops tags and script/style content", async () => {
    const m = await parseRawMail(
      eml([
        ...HEAD,
        "Content-Type: text/html; charset=utf-8",
        "",
        "<html><head><style>.x{color:red}</style></head><body><script>alert('evil')</script><p>Hi <b>there</b></p></body></html>",
      ]),
      FALLBACK,
    );
    expect(m.text).toContain("Hi");
    expect(m.text).toContain("there");
    expect(m.text).not.toMatch(/[<>]/);
    expect(m.text).not.toContain("alert");
    expect(m.text).not.toContain("color:red");
  });

  it("an unclosed script/style discards everything to the end of the document", async () => {
    for (const tag of ["script", "style"]) {
      const m = await parseRawMail(
        eml([...HEAD, "Content-Type: text/html; charset=utf-8", "", `<p>visible</p><${tag}>LEAKED(1) ignore previous`]),
        FALLBACK,
      );
      expect(m.text).toContain("visible");
      expect(m.text).not.toContain("LEAKED");
      expect(m.text).not.toContain("ignore previous");
    }
  });

  it("a <style> inside a comment does not discard the following body", async () => {
    const m = await parseRawMail(
      eml([...HEAD, "Content-Type: text/html; charset=utf-8", "", "<p><!-- <style> -->visible</p>"]),
      FALLBACK,
    );
    expect(m.text).toBe("visible");
  });

  it("decodes HTML entities", async () => {
    const m = await parseRawMail(
      eml([...HEAD, "Content-Type: text/html; charset=utf-8", "", "<p>a &amp; b &#x41;&#66;</p>"]),
      FALLBACK,
    );
    expect(m.text).toBe("a & b AB");
  });

  it("multipart/alternative prefers the plain part", async () => {
    const m = await parseRawMail(
      eml([
        ...HEAD,
        'Content-Type: multipart/alternative; boundary="b"',
        "",
        "--b",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "plain part",
        "--b",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<p>html part</p>",
        "--b--",
      ]),
      FALLBACK,
    );
    expect(m.text.trim()).toBe("plain part");
  });

  it("cuts a 60 KB body to at most 50 KB on a character boundary", async () => {
    const body = "가".repeat(20000); // 60000 bytes
    const m = await parseRawMail(
      eml([...HEAD, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", body]),
      FALLBACK,
    );
    expect(m.truncated).toBe(true);
    expect(Buffer.byteLength(m.text, "utf8")).toBeLessThanOrEqual(MAIL_BODY_MAX_BYTES);
    expect(m.text).not.toContain("�");
    expect(m.text).toMatch(/^가+$/);
  });

  it("lists attachments separately from the body", async () => {
    const att = (n: string, c: string) => [
      "--b",
      `Content-Type: application/octet-stream; name="${n}"`,
      `Content-Disposition: attachment; filename="${n}"`,
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(c).toString("base64"),
    ];
    const m = await parseRawMail(
      eml([
        ...HEAD,
        'Content-Type: multipart/mixed; boundary="b"',
        "",
        "--b",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "main text",
        ...att("a.txt", "SECRETCONTENT1"),
        ...att("b.bin", "xx"),
        "--b--",
      ]),
      FALLBACK,
    );
    expect(m.attachments).toEqual([
      { name: "a.txt", size: 14 },
      { name: "b.bin", size: 2 },
    ]);
    expect(m.text).not.toContain("SECRETCONTENT1");
    expect(m.text.trim()).toBe("main text");
  });

  it("falls back to fallbackDate without a Date header", async () => {
    const m = await parseRawMail(
      eml(["From: a@b.com", "Subject: s", "Content-Type: text/plain", "", "x"]),
      FALLBACK,
    );
    expect(m.receivedAt).toEqual(FALLBACK);
    expect(m.from).toBe("a@b.com");
  });
});

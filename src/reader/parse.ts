import { simpleParser } from "mailparser";
import type { ParsedMail } from "./types";

export const MAIL_BODY_MAX_BYTES = 50 * 1024;

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

/** Minimal conversion for HTML-only mail: drops comments and script/style with their content, strips all tags. */
function htmlToText(html: string): string {
  return html
    // Remove comments first, so a `<style>` inside a comment is not read as an unclosed tag that discards the rest of the body.
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>?/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[<>]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cuts to a UTF-8 byte cap, keeping only up to the last complete character (code point). */
function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return { text: buf.subarray(0, end).toString("utf8"), truncated: true };
}

function formatFrom(a: { name?: string; address?: string } | undefined): string {
  if (!a) return "";
  const name = (a.name ?? "").trim();
  const addr = a.address ?? "";
  if (!addr) return name;
  return name ? `${name} <${addr}>` : addr;
}

export async function parseRawMail(raw: Buffer, fallbackDate: Date): Promise<ParsedMail> {
  const mail = await simpleParser(raw, { skipHtmlToText: true, skipImageLinks: true });
  const plain = (mail.text ?? "").trim();
  const body = plain || (typeof mail.html === "string" ? htmlToText(mail.html) : "");
  const { text, truncated } = truncateUtf8(body, MAIL_BODY_MAX_BYTES);
  return {
    from: formatFrom(mail.from?.value[0]),
    subject: mail.subject ?? "",
    receivedAt: mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date : fallbackDate,
    text,
    truncated,
    attachments: mail.attachments.map((a) => ({
      name: a.filename ?? "(unnamed)",
      size: a.size,
    })),
  };
}

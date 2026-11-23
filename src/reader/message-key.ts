import { createHash } from "node:crypto";

const HASH_PREFIX_BYTES = 4 * 1024;
const MESSAGE_ID_MAX = 500;

/** Returns the header part of the raw message (before the first blank line) with folded lines unfolded. */
function headerBlock(raw: Buffer): string {
  return raw.toString("latin1").split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
}

function header(head: string, name: string): string {
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, "im").exec(head);
  return m ? m[1].trim() : "";
}

function sha256(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Stable key for the same mail within a mailbox. Unaffected by server UID or UIDVALIDITY changes.
 * - With a Message-ID header: the normalised value (trimmed, angle brackets removed, lower-cased); its hash if too long.
 * - Without: sha256 (hex) of the Date, From and Subject headers plus the first 4 KB of the raw message.
 */
export function stableMessageKey(raw: Buffer): string {
  const head = headerBlock(raw);
  const mid = header(head, "Message-ID").replace(/^<+|>+$/g, "").trim().toLowerCase();
  if (mid) return mid.length > MESSAGE_ID_MAX ? sha256(mid) : mid;
  return sha256(
    Buffer.concat([
      Buffer.from([header(head, "Date"), header(head, "From"), header(head, "Subject")].join("\n"), "latin1"),
      Buffer.from("\n"),
      raw.subarray(0, HASH_PREFIX_BYTES),
    ]),
  );
}

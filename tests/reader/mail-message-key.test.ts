import { describe, expect, it } from "vitest";
import { stableMessageKey } from "../../src/reader/message-key";

const raw = (head: string[], body = "hello") => Buffer.from([...head, "", body].join("\r\n"), "latin1");

describe("stableMessageKey", () => {
  it("normalises Message-ID (trims whitespace and angle brackets, lower-cases)", () => {
    expect(stableMessageKey(raw(["From: a@x", "Message-ID:   <ABC.123@Example.COM>  "]))).toBe("abc.123@example.com");
    expect(stableMessageKey(raw(["message-id: abc@x"]))).toBe("abc@x");
  });

  it("reads a folded Message-ID header", () => {
    expect(stableMessageKey(raw(["Message-ID:", " <fold@x>"]))).toBe("fold@x");
  });

  it("without Message-ID uses sha256 of Date, From, Subject and the start of the raw message", () => {
    const a = stableMessageKey(raw(["From: a@x", "Subject: s", "Date: Mon, 16 Nov 2026 09:00:00 +0000"]));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(stableMessageKey(raw(["From: a@x", "Subject: s", "Date: Mon, 16 Nov 2026 09:00:00 +0000"]))).toBe(a);
    expect(stableMessageKey(raw(["From: a@x", "Subject: t", "Date: Mon, 16 Nov 2026 09:00:00 +0000"]))).not.toBe(a);
  });

  it("hashes an overly long Message-ID", () => {
    expect(stableMessageKey(raw([`Message-ID: <${"x".repeat(600)}@y>`]))).toMatch(/^[0-9a-f]{64}$/);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";

import { consoleLogger } from "../src/logger";
import { escapeHtml, recipientCount } from "../src/types";

afterEach(() => vi.restoreAllMocks());

describe("consoleLogger", () => {
  it("routes info to console.info and error to console.error", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    consoleLogger.info("hello");
    consoleLogger.error("boom", { code: 1 });

    expect(info).toHaveBeenCalledWith("hello");
    expect(error).toHaveBeenCalledWith("boom", { code: 1 });
  });
});

describe("types helpers", () => {
  it("recipientCount counts `to`", () => {
    expect(recipientCount({ to: ["a@t.com", "b@t.com"], subject: "s" })).toBe(2);
  });

  it("escapeHtml escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

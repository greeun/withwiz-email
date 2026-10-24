import { describe, it, expect, vi } from "vitest";

import { emailFromEnv, resolveTransportFromEnv, transportLabelFromEnv } from "../src/env";

const opts = { defaultFrom: "App <no-reply@app.local>" };
const resolve = (env: Record<string, string | undefined>) => resolveTransportFromEnv(env, opts).name;

describe("resolveTransportFromEnv auto selection", () => {
  it("priority 1: BREVO_API_KEY", () => {
    expect(
      resolve({ BREVO_API_KEY: "b", MAILJET_API_KEY: "m", MAILJET_API_SECRET: "s", RESEND_API_KEY: "r", SMTP_HOST: "h" }),
    ).toBe("brevo");
  });

  it("priority 2: Mailjet only with both key and secret", () => {
    expect(resolve({ MAILJET_API_KEY: "m", MAILJET_API_SECRET: "s", RESEND_API_KEY: "r" })).toBe("mailjet");
  });

  it("skips Mailjet without the secret", () => {
    expect(resolve({ MAILJET_API_KEY: "m", RESEND_API_KEY: "r" })).toBe("resend");
  });

  it("priority 3: RESEND_API_KEY", () => {
    expect(resolve({ RESEND_API_KEY: "r", SMTP_HOST: "h" })).toBe("resend");
  });

  it("priority 4: SMTP_HOST", () => {
    expect(resolve({ SMTP_HOST: "h" })).toBe("smtp");
  });

  it("falls back to console", () => {
    expect(resolve({})).toBe("console");
  });

  it("treats empty strings as unset", () => {
    expect(resolve({ BREVO_API_KEY: "", RESEND_API_KEY: "", SMTP_HOST: "" })).toBe("console");
  });
});

describe("EMAIL_TRANSPORT explicit", () => {
  it("overrides the priority", () => {
    expect(resolve({ EMAIL_TRANSPORT: "mailjet", BREVO_API_KEY: "b", MAILJET_API_KEY: "m", MAILJET_API_SECRET: "s" })).toBe(
      "mailjet",
    );
  });

  it("console never sends even with keys", () => {
    expect(resolve({ EMAIL_TRANSPORT: "console", BREVO_API_KEY: "b" })).toBe("console");
  });

  it("throws when the chosen transport lacks its key (no silent fallback)", () => {
    expect(() => resolve({ EMAIL_TRANSPORT: "brevo" })).toThrow(/BREVO_API_KEY/);
  });

  it("throws on an unknown value", () => {
    expect(() => resolve({ EMAIL_TRANSPORT: "postmark" })).toThrow(/EMAIL_TRANSPORT/);
  });
});

describe("transportLabelFromEnv", () => {
  it("names the selected transport", () => {
    expect(transportLabelFromEnv({ BREVO_API_KEY: "b" }, opts)).toBe("brevo");
  });

  it("reports console when nothing is configured", () => {
    expect(transportLabelFromEnv({}, opts)).toBe("console");
  });

  it("does not throw on misconfiguration", () => {
    expect(transportLabelFromEnv({ EMAIL_TRANSPORT: "brevo" }, opts)).toBe("misconfigured");
  });
});

describe("emailFromEnv", () => {
  it("prefers EMAIL_FROM, then SMTP_FROM, then the default", () => {
    expect(emailFromEnv({ EMAIL_FROM: "A <a@t.com>", SMTP_FROM: "b@t.com" }, "d@t.com")).toBe("A <a@t.com>");
    expect(emailFromEnv({ SMTP_FROM: "b@t.com" }, "d@t.com")).toBe("b@t.com");
    expect(emailFromEnv({ EMAIL_FROM: "" }, "d@t.com")).toBe("d@t.com");
  });
});

describe("wiring", () => {
  it("passes EMAIL_FROM and fetchImpl to the selected REST transport", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    const transport = resolveTransportFromEnv(
      { BREVO_API_KEY: "k", EMAIL_FROM: "Tlog <hello@tlog.net>" },
      { ...opts, fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    await transport.send({ to: ["a@t.com"], subject: "s", html: "<p>x</p>" });

    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(body.sender).toEqual({ name: "Tlog", email: "hello@tlog.net" });
  });

  it("passes the logger to the console transport", async () => {
    const info = vi.fn();
    await resolveTransportFromEnv({}, { ...opts, logger: { info, error: vi.fn() } }).send({ to: ["a@t.com"], subject: "s" });
    expect(info).toHaveBeenCalledWith("[email:console] 1 recipient(s)  subject=s");
  });
});

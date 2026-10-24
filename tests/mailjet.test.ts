import { describe, it, expect, vi } from "vitest";

import { createMailjetTransport, MAILJET_ENDPOINT } from "../src/transports/mailjet";

function stubFetch(response: { ok: boolean; status?: number; body?: unknown }) {
  const text = typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? {});
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 401),
    text: async () => text,
  })) as unknown as typeof fetch;
}

function call(fetchImpl: typeof fetch) {
  const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
  return {
    url: mock.mock.calls[0][0],
    init: mock.mock.calls[0][1] as RequestInit,
    body: JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body)),
  };
}

const OK_BODY = { Messages: [{ Status: "success" }] };

describe("createMailjetTransport", () => {
  it("sends via the Mailjet Send API v3.1 (Basic auth, Messages array)", async () => {
    const fetchImpl = stubFetch({ ok: true, body: OK_BODY });
    const transport = createMailjetTransport({
      apiKey: "pub",
      apiSecret: "priv",
      from: "Tavlet <no-reply@tavlet.io>",
      fetchImpl,
    });

    await transport.send({ to: ["a@t.com"], subject: "Subject", text: "Body", html: "<p>Body</p>" });

    const { url, init, body } = call(fetchImpl);
    expect(url).toBe(MAILJET_ENDPOINT);
    const expected = `Basic ${Buffer.from("pub:priv").toString("base64")}`;
    expect((init.headers as Record<string, string>).Authorization).toBe(expected);

    expect(body.Messages).toHaveLength(1);
    expect(body.Messages[0]).toMatchObject({
      From: { Name: "Tavlet", Email: "no-reply@tavlet.io" },
      To: [{ Email: "a@t.com" }],
      Subject: "Subject",
      TextPart: "Body",
      HTMLPart: "<p>Body</p>",
    });
  });

  it("does not fill the recipient with the sender (no dummy To workaround, history of bounces and blocks)", async () => {
    const fetchImpl = stubFetch({ ok: true, body: OK_BODY });
    const transport = createMailjetTransport({ apiKey: "p", apiSecret: "s", from: "f@t.com", fetchImpl });

    await transport.send({ to: ["a@t.com"], subject: "Notice", text: "Body" });

    const { body } = call(fetchImpl);
    expect(body.Messages[0].To).toEqual([{ Email: "a@t.com" }]);
    expect(body.Messages[0].Bcc).toBeUndefined();
  });

  it("throws with the status code and body on HTTP failure", async () => {
    const fetchImpl = stubFetch({ ok: false, status: 401, body: "unauthorized" });
    const transport = createMailjetTransport({ apiKey: "p", apiSecret: "s", from: "f@t.com", fetchImpl });

    await expect(transport.send({ to: ["a@t.com"], subject: "s", text: "t" })).rejects.toThrow(
      /Mailjet.*401.*unauthorized/,
    );
  });

  it("throws on a per-message failure even with HTTP 200 (Mailjet returns partial failures as 200)", async () => {
    const fetchImpl = stubFetch({
      ok: true,
      body: { Messages: [{ Status: "error", Errors: [{ ErrorMessage: "invalid sender" }] }] },
    });
    const transport = createMailjetTransport({ apiKey: "p", apiSecret: "s", from: "f@t.com", fetchImpl });

    await expect(transport.send({ to: ["a@t.com"], subject: "s", text: "t" })).rejects.toThrow(/invalid sender/);
  });

  it("includes extra headers in the message's Headers field", async () => {
    const fetchImpl = stubFetch({ ok: true, body: OK_BODY });
    const transport = createMailjetTransport({ apiKey: "p", apiSecret: "s", from: "f@t.com", fetchImpl });
    await transport.send({ to: ["a@t.com"], subject: "s", text: "t", headers: { "List-Unsubscribe": "<https://t/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    expect(call(fetchImpl).body.Messages[0].Headers).toEqual({ "List-Unsubscribe": "<https://t/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });

  it("transport name is mailjet", () => {
    const transport = createMailjetTransport({
      apiKey: "p",
      apiSecret: "s",
      from: "f@t.com",
      fetchImpl: stubFetch({ ok: true, body: OK_BODY }),
    });
    expect(transport.name).toBe("mailjet");
  });
});

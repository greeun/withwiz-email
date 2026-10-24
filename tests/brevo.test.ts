import { describe, it, expect, vi } from "vitest";

import { createBrevoTransport, BREVO_ENDPOINT } from "../src/transports/brevo";

function stubFetch(response: { ok: boolean; status?: number; body?: string }) {
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 201 : 400),
    text: async () => response.body ?? "",
  })) as unknown as typeof fetch;
}

function parseBody(fetchImpl: typeof fetch) {
  const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
  return JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body));
}

describe("createBrevoTransport", () => {
  it("sends via the Brevo SMTP API (endpoint, api-key header, sender split)", async () => {
    const fetchImpl = stubFetch({ ok: true });
    const transport = createBrevoTransport({
      apiKey: "xkeysib-test",
      from: "Tavlet <no-reply@tavlet.io>",
      fetchImpl,
    });

    await transport.send({ to: ["a@t.com"], subject: "Subject", text: "Body", html: "<p>Body</p>" });

    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls[0][0]).toBe(BREVO_ENDPOINT);
    const init = mock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-test");

    expect(parseBody(fetchImpl)).toMatchObject({
      sender: { name: "Tavlet", email: "no-reply@tavlet.io" },
      to: [{ email: "a@t.com" }],
      subject: "Subject",
      textContent: "Body",
      htmlContent: "<p>Body</p>",
    });
  });

  it("does not fill the recipient with the sender (no dummy-to workaround, history of bounces and blocks)", async () => {
    const fetchImpl = stubFetch({ ok: true });
    const transport = createBrevoTransport({ apiKey: "k", from: "Tavlet <f@t.com>", fetchImpl });

    await transport.send({ to: ["a@t.com"], subject: "Notice", text: "Body" });

    const body = parseBody(fetchImpl);
    expect(body.to).toEqual([{ email: "a@t.com" }]);
    expect(body.bcc).toBeUndefined();
  });

  it("does not send when there are no recipients", async () => {
    const fetchImpl = stubFetch({ ok: true });
    const transport = createBrevoTransport({ apiKey: "k", from: "f@t.com", fetchImpl });

    await transport.send({ to: [], subject: "s", text: "t" });

    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("throws with the status code and body on a failed response", async () => {
    const fetchImpl = stubFetch({ ok: false, status: 400, body: '{"message":"sender not valid"}' });
    const transport = createBrevoTransport({ apiKey: "k", from: "f@t.com", fetchImpl });

    await expect(transport.send({ to: ["a@t.com"], subject: "s", text: "t" })).rejects.toThrow(
      /Brevo.*400.*sender not valid/,
    );
  });

  it("includes extra headers in the headers field, and omits the field when there are none", async () => {
    const fetchImpl = stubFetch({ ok: true });
    const transport = createBrevoTransport({ apiKey: "k", from: "f@t.com", fetchImpl });
    await transport.send({ to: ["a@t.com"], subject: "s", text: "t", headers: { "List-Unsubscribe": "<https://t/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    await transport.send({ to: ["b@t.com"], subject: "s", text: "t" });
    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body)).headers).toEqual({ "List-Unsubscribe": "<https://t/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(JSON.parse(String((mock.mock.calls[1][1] as RequestInit).body)).headers).toBeUndefined();
  });

  it("transport name is brevo", () => {
    const transport = createBrevoTransport({ apiKey: "k", from: "f@t.com", fetchImpl: stubFetch({ ok: true }) });
    expect(transport.name).toBe("brevo");
  });
});

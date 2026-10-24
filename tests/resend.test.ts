import { describe, it, expect, vi } from "vitest";

import { createResendTransport, RESEND_ENDPOINT } from "../src/transports/resend";

/** fetch stub — captures the call arguments and returns the given response. */
function stubFetch(response: { ok: boolean; status?: number; body?: string }) {
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 422),
    text: async () => response.body ?? "",
  })) as unknown as typeof fetch;
}

function parseBody(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("createResendTransport", () => {
  it("sends via the Resend HTTP API (endpoint, auth header, body)", async () => {
    const fetchImpl = stubFetch({ ok: true });
    const transport = createResendTransport({
      apiKey: "re_test_key",
      from: "Tavlet <no-reply@tavlet.io>",
      fetchImpl,
    });

    await transport.send({
      to: ["a@t.com"],
      subject: "Subject",
      text: "Body",
      html: "<p>Body</p>",
    });

    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe(RESEND_ENDPOINT);

    const init = mock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = parseBody(mock);
    expect(body).toMatchObject({
      from: "Tavlet <no-reply@tavlet.io>",
      to: ["a@t.com"],
      subject: "Subject",
      text: "Body",
      html: "<p>Body</p>",
    });
    expect(body.bcc).toBeUndefined();
  });

  it("does not fill the recipient with the sender (no dummy-to workaround, history of bounces and blocks)", async () => {
    const fetchImpl = stubFetch({ ok: true });
    const transport = createResendTransport({
      apiKey: "re_test_key",
      from: "Tavlet <no-reply@tavlet.io>",
      fetchImpl,
    });

    await transport.send({ to: ["a@t.com"], subject: "Notice", text: "Body" });

    const body = parseBody(fetchImpl as unknown as ReturnType<typeof vi.fn>);
    expect(body.to).toEqual(["a@t.com"]);
    expect(body.bcc).toBeUndefined();
  });

  it("does not send when there are no recipients", async () => {
    const fetchImpl = stubFetch({ ok: true });
    const transport = createResendTransport({ apiKey: "re_k", from: "f@t.com", fetchImpl });

    await transport.send({ to: [], subject: "Notice", text: "Body" });

    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("throws with the status code and body on a failed response", async () => {
    const fetchImpl = stubFetch({ ok: false, status: 422, body: '{"message":"domain not verified"}' });
    const transport = createResendTransport({ apiKey: "re_k", from: "f@t.com", fetchImpl });

    await expect(transport.send({ to: ["a@t.com"], subject: "s", text: "t" })).rejects.toThrow(
      /422.*domain not verified/,
    );
  });

  it("includes extra headers in the headers field", async () => {
    const fetchImpl = stubFetch({ ok: true });
    const transport = createResendTransport({ apiKey: "re_k", from: "f@t.com", fetchImpl });
    await transport.send({ to: ["a@t.com"], subject: "s", text: "t", headers: { "List-Unsubscribe": "<https://t/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    expect(parseBody(fetchImpl as unknown as ReturnType<typeof vi.fn>).headers).toEqual({ "List-Unsubscribe": "<https://t/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });

  it("transport name is resend", () => {
    const transport = createResendTransport({ apiKey: "re_k", from: "f@t.com", fetchImpl: stubFetch({ ok: true }) });
    expect(transport.name).toBe("resend");
  });
});

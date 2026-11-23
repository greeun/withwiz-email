import { describe, expect, it } from "vitest";
import { createGraphReader } from "../../src/reader/graph";
import { createMailReaders } from "../../src/reader";
import { stableMessageKey } from "../../src/reader/message-key";
import { MAIL_RAW_MAX_BYTES, MailReaderError, type GraphConfig } from "../../src/reader/types";

const graphReader = createGraphReader();

const G = "https://graph.microsoft.com/v1.0";
const TOKEN = "secret-access-token-xyz";
const SINCE = new Date("2026-11-17T00:00:00.000Z");

type Call = { url: string; init: RequestInit };
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function mime(id: string, extra = ""): string {
  return `Message-ID: <${id}@example.com>\r\nFrom: a@example.com\r\nSubject: hi ${id}\r\nDate: Wed, 18 Nov 2026 10:00:00 +0000\r\n\r\nbody${extra}`;
}

/** Builds a fake fetch from per-path handlers. Matching is by prefix, in registration order. */
function cfgWith(routes: [string | RegExp, Handler][], calls: Call[] = []): GraphConfig {
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    for (const [m, h] of routes) {
      if (typeof m === "string" ? url.startsWith(m) : m.test(url)) return h(url, init ?? {});
    }
    return json(404, { error: { code: "ErrorItemNotFound" } });
  }) as typeof fetch;
  return { getAccessToken: async () => TOKEN, fetch: f };
}

const mimeRoute = (body: (id: string) => string): [RegExp, Handler] => [
  /\/me\/messages\/[^/?]+\/\$value$/,
  (url) => {
    const id = decodeURIComponent(/\/me\/messages\/([^/?]+)\/\$value$/.exec(url)![1]);
    return new Response(body(id), { status: 200, headers: { "content-type": "message/rfc822" } });
  },
];

const msg = (id: string, received = "2026-11-18T10:00:00Z") => ({ id, internetMessageId: `<${id}@example.com>`, receivedDateTime: received });

async function catchErr(p: Promise<unknown>): Promise<MailReaderError> {
  try {
    await p;
  } catch (e) {
    return e as MailReaderError;
  }
  throw new Error("expected rejection");
}

describe("graphReader", () => {
  it("is registered as GRAPH", () => {
    expect(createMailReaders({ assertHost: async () => undefined }).GRAPH.transport).toBe("GRAPH");
    expect(graphReader.transport).toBe("GRAPH");
  });

  it("verify calls GET /me with the Bearer token", async () => {
    const calls: Call[] = [];
    await graphReader.verify(cfgWith([[`${G}/me`, () => json(200, { id: "u1" })]], calls));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${G}/me`);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("first sync calls inbox delta with since filter and select; when complete the deltaLink is the cursor", async () => {
    const calls: Call[] = [];
    const deltaLink = `${G}/me/mailFolders('inbox')/messages/delta?$deltatoken=D1`;
    const cfg = cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, { value: [msg("m1"), msg("m2")], "@odata.deltaLink": deltaLink })],
      mimeRoute((id) => mime(id)),
    ], calls);
    const r = await graphReader.fetchSince(cfg, { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE });

    const first = new URL(calls[0].url);
    expect(first.pathname).toBe("/v1.0/me/mailFolders/inbox/messages/delta");
    expect(first.searchParams.get("$filter")).toBe("receivedDateTime ge 2026-11-17T00:00:00Z");
    expect(first.searchParams.get("$select")).toBe("id,internetMessageId,receivedDateTime");
    expect(first.searchParams.get("changeType")).toBe("created");
    expect(new Headers(calls[0].init.headers).get("prefer")).toMatch(/odata\.maxpagesize=\d+/);

    expect(r.hasMore).toBe(false);
    expect(r.nextCursor).toBe(deltaLink);
    expect(r.items).toHaveLength(2);
    expect(r.items[0].raw.toString()).toBe(mime("m1"));
    expect(r.items[0].providerMessageId).toBe(stableMessageKey(Buffer.from(mime("m1"))));
    expect(r.items[0].oversized).toBeUndefined();
  });

  it("a stored cursor (deltaLink) is requested as is", async () => {
    const calls: Call[] = [];
    const cursor = `${G}/me/mailFolders('inbox')/messages/delta?$deltatoken=OLD`;
    const cfg = cfgWith([[cursor, () => json(200, { value: [], "@odata.deltaLink": `${G}/x?$deltatoken=NEW` })]], calls);
    const r = await graphReader.fetchSince(cfg, { cursor, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(calls[0].url).toBe(cursor);
    expect(r).toEqual({ items: [], nextCursor: `${G}/x?$deltatoken=NEW`, hasMore: false });
  });

  it("follows nextLink up to limit; leftovers give hasMore and a nextLink cursor", async () => {
    const calls: Call[] = [];
    const cfg = cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, { value: [msg("a1"), msg("a2")], "@odata.nextLink": `${G}/p?$skiptoken=S1` })],
      [`${G}/p?$skiptoken=S1`, () => json(200, { value: [msg("a3"), msg("a4")], "@odata.nextLink": `${G}/p?$skiptoken=S2` })],
      [`${G}/p?$skiptoken=S2`, () => json(200, { value: [msg("a5")], "@odata.deltaLink": `${G}/d?$deltatoken=D` })],
      mimeRoute((id) => mime(id)),
    ], calls);
    const r = await graphReader.fetchSince(cfg, { cursor: null, seenUidls: [] }, { limit: 4, since: SINCE });
    expect(r.items.map((i) => i.raw.toString())).toEqual(["a1", "a2", "a3", "a4"].map((id) => mime(id)));
    expect(r.hasMore).toBe(true);
    expect(r.nextCursor).toBe(`${G}/p?$skiptoken=S2`);
    expect(calls.some((c) => c.url.includes("S2"))).toBe(false);
  });

  it("skips @removed items and mails before since", async () => {
    const calls: Call[] = [];
    const cfg = cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, {
        value: [{ id: "gone", "@removed": { reason: "deleted" } }, msg("old", "2026-11-01T00:00:00Z"), msg("new")],
        "@odata.deltaLink": `${G}/d?$deltatoken=D`,
      })],
      mimeRoute((id) => mime(id)),
    ], calls);
    const r = await graphReader.fetchSince(cfg, { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(r.items.map((i) => i.raw.toString())).toEqual([mime("new")]);
    expect(calls.filter((c) => c.url.endsWith("/$value"))).toHaveLength(1);
  });

  it("a raw message over 10 MB stops downloading and becomes oversized with metadata headers only", async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const big = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += chunk.length;
        if (pulled > MAIL_RAW_MAX_BYTES * 3) c.close();
        else c.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const cfg = cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, { value: [msg("big")], "@odata.deltaLink": `${G}/d?$deltatoken=D` })],
      [/\/me\/messages\/big\/\$value$/, () => new Response(big, { status: 200 })],
      [/\/me\/messages\/big\?/, () => json(200, {
        subject: "큰 메일", internetMessageId: "<big@example.com>", receivedDateTime: "2026-11-18T10:00:00Z",
        from: { emailAddress: { name: "Big Sender", address: "big@example.com" } },
      })],
    ]);
    const r = await graphReader.fetchSince(cfg, { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(MAIL_RAW_MAX_BYTES + 2 * chunk.length);
    expect(r.items).toHaveLength(1);
    const it0 = r.items[0];
    expect(it0.oversized).toBe(true);
    expect(it0.raw.length).toBeLessThan(4096);
    const head = it0.raw.toString();
    expect(head).toMatch(/^Message-ID: <big@example\.com>\r\n/m);
    expect(head).toMatch(/^From: .*big@example\.com/m);
    expect(head).toMatch(/^Subject: =\?UTF-8\?B\?/m);
    expect(head).toMatch(/^Date: /m);
    expect(it0.providerMessageId).toBe("big@example.com");
  });

  it("Content-Length over the cap skips reading the body and marks oversized", async () => {
    const cfg = cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, { value: [msg("cl")], "@odata.deltaLink": `${G}/d?$deltatoken=D` })],
      [/\/me\/messages\/cl\/\$value$/, () => new Response("x", { status: 200, headers: { "content-length": String(MAIL_RAW_MAX_BYTES + 1) } })],
      [/\/me\/messages\/cl\?/, () => json(200, { subject: "s", internetMessageId: "<cl@example.com>", receivedDateTime: "2026-11-18T10:00:00Z" })],
    ]);
    const r = await graphReader.fetchSince(cfg, { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(r.items[0].oversized).toBe(true);
    expect(r.items[0].providerMessageId).toBe("cl@example.com");
  });

  it("410 drops the stored cursor and restarts from since", async () => {
    const calls: Call[] = [];
    const cursor = `${G}/me/mailFolders('inbox')/messages/delta?$deltatoken=EXPIRED`;
    const cfg = cfgWith([
      [cursor, () => json(410, { error: { code: "syncStateNotFound", message: "gone" } })],
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, { value: [msg("r1")], "@odata.deltaLink": `${G}/d?$deltatoken=FRESH` })],
      mimeRoute((id) => mime(id)),
    ], calls);
    const r = await graphReader.fetchSince(cfg, { cursor, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(calls[1].url).toContain("receivedDateTime");
    expect(r.nextCursor).toBe(`${G}/d?$deltatoken=FRESH`);
    expect(r.items).toHaveLength(1);
  });

  it("4xx syncStateNotFound restarts the same way", async () => {
    const cursor = `${G}/me/mailFolders('inbox')/messages/delta?$deltatoken=EXPIRED`;
    const cfg = cfgWith([
      [cursor, () => json(400, { error: { code: "SyncStateNotFound" } })],
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, { value: [], "@odata.deltaLink": `${G}/d?$deltatoken=FRESH` })],
    ]);
    const r = await graphReader.fetchSince(cfg, { cursor, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(r.nextCursor).toBe(`${G}/d?$deltatoken=FRESH`);
  });

  it("a cursor pointing outside Graph is ignored and sync starts from since (prevents token leaks)", async () => {
    const calls: Call[] = [];
    const cfg = cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, { value: [], "@odata.deltaLink": `${G}/d?$deltatoken=FRESH` })],
    ], calls);
    await graphReader.fetchSince(cfg, { cursor: "https://evil.example/steal", seenUidls: [] }, { limit: 50, since: SINCE });
    expect(calls.every((c) => c.url.startsWith(`${G}/`))).toBe(true);
  });

  it("401 -> AUTH_FAILED, 429/503/network -> CONNECT_FAILED, others -> PROTOCOL; no token in messages", async () => {
    const run = (h: Handler) =>
      catchErr(graphReader.fetchSince(cfgWith([[`${G}/`, h]]), { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE }));
    const cases: [Handler, string][] = [
      [() => json(401, { error: { code: "InvalidAuthenticationToken", message: `bad ${TOKEN}` } }), "AUTH_FAILED"],
      [() => json(429, {}, { "retry-after": "30" }), "CONNECT_FAILED"],
      [() => json(503, {}), "CONNECT_FAILED"],
      [() => { throw new TypeError(`fetch failed ${TOKEN}`); }, "CONNECT_FAILED"],
      [() => json(400, { error: { code: "BadRequest", message: TOKEN } }), "PROTOCOL"],
      [() => new Response("not json", { status: 200 }), "PROTOCOL"],
    ];
    for (const [h, code] of cases) {
      const e = await run(h);
      expect(e).toBeInstanceOf(MailReaderError);
      expect(e.code).toBe(code);
      expect(e.message).not.toContain(TOKEN);
      expect(String(e.stack)).not.toContain(TOKEN);
    }
    const v = await catchErr(graphReader.verify(cfgWith([[`${G}/me`, () => json(401, {})]])));
    expect(v.code).toBe("AUTH_FAILED");
  });

  it("skips a mail deleted between delta and MIME download (404)", async () => {
    const cfg = cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, { value: [msg("del"), msg("ok")], "@odata.deltaLink": `${G}/d?$deltatoken=D` })],
      [/\/me\/messages\/del\/\$value$/, () => json(404, { error: { code: "ErrorItemNotFound" } })],
      mimeRoute((id) => mime(id)),
    ]);
    const r = await graphReader.fetchSince(cfg, { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(r.items.map((i) => i.raw.toString())).toEqual([mime("ok")]);
  });

  it.each([408, 423, 425])("MIME response %i is transient: not skipped, aborts with CONNECT_FAILED", async (status) => {
    const cfg = cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, { value: [msg("tmp"), msg("ok")], "@odata.deltaLink": `${G}/d?$deltatoken=D` })],
      [/\/me\/messages\/tmp\/\$value$/, () => json(status, {})],
      mimeRoute((id) => mime(id)),
    ]);
    const e = await catchErr(graphReader.fetchSince(cfg, { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE }));
    expect(e.code).toBe("CONNECT_FAILED");
  });

  it("resuming from a stored cursor does not filter mails before since (no loss after a long pause)", async () => {
    const cursor = `${G}/me/mailFolders('inbox')/messages/delta?$deltatoken=OLD`;
    const cfg = cfgWith([
      [cursor, () => json(200, { value: [msg("gap", "2026-11-01T00:00:00Z")], "@odata.deltaLink": `${G}/d?$deltatoken=NEW` })],
      mimeRoute((id) => mime(id)),
    ]);
    const r = await graphReader.fetchSince(cfg, { cursor, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(r.items.map((i) => i.raw.toString())).toEqual([mime("gap")]);
    expect(r.nextCursor).toBe(`${G}/d?$deltatoken=NEW`);
  });

  it("after a 410 restart the since filter applies again", async () => {
    const cursor = `${G}/me/mailFolders('inbox')/messages/delta?$deltatoken=EXPIRED`;
    const cfg = cfgWith([
      [cursor, () => json(410, {})],
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, {
        value: [msg("old", "2026-11-01T00:00:00Z"), msg("new")], "@odata.deltaLink": `${G}/d?$deltatoken=F`,
      })],
      mimeRoute((id) => mime(id)),
    ]);
    const r = await graphReader.fetchSince(cfg, { cursor, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(r.items.map((i) => i.raw.toString())).toEqual([mime("new")]);
  });

  it("budget running out mid-page returns finished mails and keeps that page URL as the cursor", async () => {
    let t = 0;
    const reader = createGraphReader({ now: () => t, budgetMs: 90_000 });
    const firstUrl: string[] = [];
    const cfg = cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, (url) => {
        firstUrl.push(url);
        return json(200, { value: [msg("t1"), msg("t2"), msg("t3"), msg("t4")], "@odata.nextLink": `${G}/p?$skiptoken=S1` });
      }],
      [/\/me\/messages\/[^/?]+\/\$value$/, (url) => {
        t += 40_000;
        const id = /\/me\/messages\/([^/?]+)\/\$value$/.exec(url)![1];
        return new Response(mime(id), { status: 200 });
      }],
    ]);
    const r = await reader.fetchSince(cfg, { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(r.items.map((i) => i.raw.toString())).toEqual(["t1", "t2", "t3"].map((id) => mime(id)));
    expect(r.hasMore).toBe(true);
    expect(r.nextCursor).toBe(firstUrl[0]);
  });

  it("budget running out at a page boundary skips the next page and keeps nextLink as the cursor", async () => {
    let t = 0;
    const reader = createGraphReader({ now: () => t, budgetMs: 90_000 });
    const calls: Call[] = [];
    const cfg = cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, { value: [msg("b1")], "@odata.nextLink": `${G}/p?$skiptoken=S1` })],
      [/\/me\/messages\/[^/?]+\/\$value$/, () => {
        t += 100_000;
        return new Response(mime("b1"), { status: 200 });
      }],
    ], calls);
    const r = await reader.fetchSince(cfg, { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(r.items).toHaveLength(1);
    expect(r).toMatchObject({ hasMore: true, nextCursor: `${G}/p?$skiptoken=S1` });
    expect(calls.some((c) => c.url.includes("S1"))).toBe(false);
  });

  it("a permanent 4xx for one mail ($value or oversized metadata) skips only that mail; 5xx is CONNECT_FAILED", async () => {
    const cfg = cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, {
        value: [msg("forbidden"), msg("huge"), msg("ok")], "@odata.deltaLink": `${G}/d?$deltatoken=D`,
      })],
      [/\/me\/messages\/forbidden\/\$value$/, () => json(403, { error: { code: "ErrorAccessDenied" } })],
      [/\/me\/messages\/huge\/\$value$/, () => new Response("x", { status: 200, headers: { "content-length": String(MAIL_RAW_MAX_BYTES + 1) } })],
      [/\/me\/messages\/huge\?/, () => json(400, { error: { code: "BadRequest" } })],
      mimeRoute((id) => mime(id)),
    ]);
    const r = await graphReader.fetchSince(cfg, { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE });
    expect(r.items.map((i) => i.raw.toString())).toEqual([mime("ok")]);
    expect(r.nextCursor).toBe(`${G}/d?$deltatoken=D`);

    const e = await catchErr(graphReader.fetchSince(cfgWith([
      [`${G}/me/mailFolders/inbox/messages/delta`, () => json(200, { value: [msg("x")], "@odata.deltaLink": `${G}/d?$deltatoken=D` })],
      [/\/\$value$/, () => json(503, {})],
    ]), { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE }));
    expect(e.code).toBe("CONNECT_FAILED");
  });

  it("a body read interrupted midway is CONNECT_FAILED, broken JSON is PROTOCOL", async () => {
    const broken = () => new Response(new ReadableStream({ start(c) { c.error(new Error(`reset ${TOKEN}`)); } }), { status: 200 });
    const e = await catchErr(graphReader.fetchSince(cfgWith([[`${G}/`, broken]]), { cursor: null, seenUidls: [] }, { limit: 50, since: SINCE }));
    expect(e.code).toBe("CONNECT_FAILED");
    expect(e.message).not.toContain(TOKEN);
  });
});

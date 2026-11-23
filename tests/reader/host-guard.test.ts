import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createImapReader, createMailReaders, createPop3Reader, MailReaderError, type HostGuard } from "../../src/reader";
import { startFakePop3, type FakePop3 } from "./helpers/fake-pop3";

type TcpProbe = { port: number; events: string[]; close(): Promise<void> };

/** TCP server that records each accepted connection in `events` and closes it immediately. */
async function startTcpProbe(events: string[]): Promise<TcpProbe> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    events.push("connect");
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    events,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

const cfg = (port: number) => ({ host: "127.0.0.1", port, tls: false, username: "user", password: "pass" });
const fetchState = { cursor: null, seenUidls: [] as string[] };
const fetchOpts = () => ({ limit: 5, since: new Date(Date.now() - 24 * 3600 * 1000) });

const blockingGuard = (seen: string[]): HostGuard => async (host) => {
  seen.push(host);
  throw new MailReaderError("BLOCKED_HOST");
};

let probe: TcpProbe | null = null;
let pop: FakePop3 | null = null;
afterEach(async () => {
  await probe?.close();
  await pop?.close();
  probe = null;
  pop = null;
});

describe("host guard injection", () => {
  it("factories require assertHost", () => {
    expect(() => createImapReader({} as never)).toThrow(TypeError);
    expect(() => createPop3Reader({} as never)).toThrow(TypeError);
    expect(() => createMailReaders({} as never)).toThrow(TypeError);
    expect(() => createMailReaders(undefined as never)).toThrow(TypeError);
  });

  it("IMAP: a rejecting guard stops verify and fetchSince before any connection", async () => {
    probe = await startTcpProbe([]);
    const seen: string[] = [];
    const reader = createImapReader({ assertHost: blockingGuard(seen) });
    await expect(reader.verify(cfg(probe.port))).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    await expect(reader.fetchSince(cfg(probe.port), fetchState, fetchOpts())).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    expect(seen).toEqual(["127.0.0.1", "127.0.0.1"]);
    // Give a stray connection attempt time to land before asserting there was none.
    await new Promise((r) => setTimeout(r, 50));
    expect(probe.events).toEqual([]);
  });

  it("IMAP: the guard runs with cfg.host before the socket is opened", async () => {
    const events: string[] = [];
    probe = await startTcpProbe(events);
    const reader = createImapReader({
      assertHost: async (host) => {
        events.push(`guard:${host}`);
      },
    });
    await expect(reader.verify(cfg(probe.port))).rejects.toBeInstanceOf(MailReaderError);
    expect(events).toEqual(["guard:127.0.0.1", "connect"]);
  }, 40_000);

  it("IMAP: a non-reader error thrown by the guard propagates unchanged", async () => {
    probe = await startTcpProbe([]);
    const boom = new Error("dns lookup failed");
    const reader = createImapReader({
      assertHost: async () => {
        throw boom;
      },
    });
    await expect(reader.verify(cfg(probe.port))).rejects.toBe(boom);
    expect(probe.events).toEqual([]);
  });

  it("POP3: a rejecting guard stops verify and fetchSince before any connection", async () => {
    pop = await startFakePop3({ messages: [] });
    const seen: string[] = [];
    const reader = createPop3Reader({ assertHost: blockingGuard(seen) });
    await expect(reader.verify(cfg(pop.port))).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    await expect(reader.fetchSince(cfg(pop.port), fetchState, fetchOpts())).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    expect(seen).toEqual(["127.0.0.1", "127.0.0.1"]);
    expect(pop.connections).toBe(0);
  });

  it("POP3: the guard runs with cfg.host before connecting, then the connection proceeds", async () => {
    pop = await startFakePop3({ messages: [] });
    const order: string[] = [];
    const reader = createPop3Reader({
      assertHost: async (host) => {
        order.push(`guard:${host}:${pop!.connections}`);
      },
    });
    await reader.verify(cfg(pop.port));
    expect(order).toEqual(["guard:127.0.0.1:0"]);
    expect(pop.connections).toBe(1);
  });
});

describe("createMailReaders", () => {
  it("returns the three transports", () => {
    const r = createMailReaders({ assertHost: async () => undefined });
    expect(Object.keys(r).sort()).toEqual(["GRAPH", "IMAP", "POP3"]);
    expect(r.IMAP.transport).toBe("IMAP");
    expect(r.POP3.transport).toBe("POP3");
    expect(r.GRAPH.transport).toBe("GRAPH");
  });

  it("wires the guard into IMAP and POP3", async () => {
    pop = await startFakePop3({ messages: [] });
    probe = await startTcpProbe([]);
    const seen: string[] = [];
    const r = createMailReaders({ assertHost: blockingGuard(seen) });
    await expect(r.POP3.verify(cfg(pop.port))).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    await expect(r.IMAP.verify(cfg(probe.port))).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    expect(seen).toEqual(["127.0.0.1", "127.0.0.1"]);
    expect(pop.connections).toBe(0);
    expect(probe.events).toEqual([]);
  });

  it("passes graph options to the Graph reader", async () => {
    let t = 0;
    const r = createMailReaders({ assertHost: async () => undefined, graph: { now: () => t, budgetMs: 1 } });
    const G = "https://graph.microsoft.com/v1.0";
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/delta")) {
        return new Response(JSON.stringify({ value: [], "@odata.nextLink": `${G}/p?$skiptoken=S1` }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    t = 0;
    const out = r.GRAPH.fetchSince(
      { getAccessToken: async () => "tok", fetch: fetchImpl },
      { cursor: null, seenUidls: [] },
      { limit: 10, since: new Date("2026-11-17T00:00:00Z") },
    );
    t = 10; // budget (1 ms) is spent after the first page
    await expect(out).resolves.toMatchObject({ hasMore: true, nextCursor: `${G}/p?$skiptoken=S1` });
    expect(calls).toHaveLength(1);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { MailReaderError, type HostGuard } from "../../src/reader/types";
import { createPop3Reader } from "../../src/reader/pop3";
import { startFakePop3, type FakePop3 } from "./helpers/fake-pop3";

// The fake server listens on 127.0.0.1, so these tests use a guard that allows every host.
const allowAll: HostGuard = async () => undefined;
const pop3Reader = createPop3Reader({ assertHost: allowAll });

const mail = (id: string, date: Date, body = "hello") =>
  `From: a@example.com\r\nSubject: s-${id}\r\nDate: ${date.toUTCString()}\r\nMessage-ID: <${id}@x>\r\n\r\n${body}\r\n`;

const DAY = 24 * 3600 * 1000;
let srv: FakePop3 | null = null;
const cfg = (port: number, password = "pass") => ({ host: "127.0.0.1", port, tls: false, username: "user", password });

afterEach(async () => {
  await srv?.close();
  srv = null;
});

describe("pop3Reader", () => {
  it("first fetch returns only mails within since, marks all seen; second returns only new", async () => {
    const now = Date.now();
    srv = await startFakePop3({
      messages: [
        { uidl: "old", raw: mail("old", new Date(now - 10 * DAY)) },
        { uidl: "new1", raw: mail("new1", new Date(now - 1 * DAY), "dot\r\n.stuffed\r\n..two") },
      ],
    });
    const since = new Date(now - 3 * DAY);
    const r1 = await pop3Reader.fetchSince(cfg(srv.port), { cursor: null, seenUidls: [] }, { limit: 50, since });
    expect(r1.items.map((i) => i.providerMessageId)).toEqual(["new1"]);
    expect(r1.items[0].raw.toString()).toBe(mail("new1", new Date(now - 1 * DAY), "dot\r\n.stuffed\r\n..two"));
    expect(srv.commands).not.toContain("RETR 1");
    expect(r1.hasMore).toBe(false);
    expect(r1.seenUidls).toEqual(expect.arrayContaining(["old", "new1"]));

    srv.setMessages([
      { uidl: "old", raw: mail("old", new Date(now - 10 * DAY)) },
      { uidl: "new1", raw: mail("new1", new Date(now - 1 * DAY)) },
      { uidl: "new2", raw: mail("new2", new Date(now - 100)) },
    ]);
    const r2 = await pop3Reader.fetchSince(cfg(srv.port), { cursor: r1.nextCursor, seenUidls: r1.seenUidls! }, { limit: 50, since });
    expect(r2.items.map((i) => i.providerMessageId)).toEqual(["new2"]);
  });

  it("first sync on a large mailbox walks newest->oldest and stops at the first old mail", async () => {
    const now = Date.now();
    const old = Array.from({ length: 300 }, (_, i) => ({ uidl: `old${i}`, raw: mail(`old${i}`, new Date(now - 30 * DAY)) }));
    const recent = ["r1", "r2", "r3"].map((id, i) => ({ uidl: id, raw: mail(id, new Date(now - (3 - i) * 1000)) }));
    srv = await startFakePop3({ messages: [...old, ...recent] });
    const since = new Date(now - 3 * DAY);
    const r1 = await pop3Reader.fetchSince(cfg(srv.port), { cursor: null, seenUidls: [] }, { limit: 50, since });
    expect(r1.items.map((i) => i.providerMessageId)).toEqual(["r1", "r2", "r3"]);
    expect(r1.hasMore).toBe(false);
    // Only headers of the 3 newest + 1 boundary mail are read; the other 299 old mails are untouched.
    expect(srv.commands.filter((c) => c.startsWith("TOP"))).toHaveLength(4);
    expect(r1.seenUidls).toHaveLength(303);

    srv.commands.length = 0;
    const r2 = await pop3Reader.fetchSince(cfg(srv.port), { cursor: r1.nextCursor, seenUidls: r1.seenUidls! }, { limit: 50, since });
    expect(r2.items).toEqual([]);
    expect(r2.hasMore).toBe(false);
    expect(srv.commands.some((c) => c.startsWith("TOP") || c.startsWith("RETR"))).toBe(false);
  });

  it("first sync over the limit takes the oldest in-range mails first and the next sync continues", async () => {
    const now = Date.now();
    const msgs = [
      { uidl: "old", raw: mail("old", new Date(now - 30 * DAY)) },
      ...["a", "b", "c"].map((id) => ({ uidl: id, raw: mail(id, new Date(now - 1000)) })),
    ];
    srv = await startFakePop3({ messages: msgs });
    const since = new Date(now - DAY);
    const r1 = await pop3Reader.fetchSince(cfg(srv.port), { cursor: null, seenUidls: [] }, { limit: 2, since });
    expect(r1.items.map((i) => i.providerMessageId)).toEqual(["a", "b"]);
    expect(r1.hasMore).toBe(true);
    const r2 = await pop3Reader.fetchSince(cfg(srv.port), { cursor: "", seenUidls: r1.seenUidls! }, { limit: 2, since });
    expect(r2.items.map((i) => i.providerMessageId)).toEqual(["c"]);
    expect(r2.hasMore).toBe(false);
  });

  it("never sends DELE", async () => {
    srv = await startFakePop3({ messages: [{ uidl: "a", raw: mail("a", new Date()) }] });
    await pop3Reader.fetchSince(cfg(srv.port), { cursor: null, seenUidls: [] }, { limit: 10, since: new Date(Date.now() - DAY) });
    expect(srv.commands.some((c) => c.startsWith("DELE"))).toBe(false);
    expect(srv.commands).toContain("QUIT");
  });

  it("wrong password -> AUTH_FAILED", async () => {
    srv = await startFakePop3({ messages: [] });
    await expect(pop3Reader.verify(cfg(srv.port, "nope"))).rejects.toMatchObject({ code: "AUTH_FAILED" });
    await expect(pop3Reader.verify(cfg(srv.port, "nope"))).rejects.toBeInstanceOf(MailReaderError);
  });

  it("verify succeeds with right password", async () => {
    srv = await startFakePop3({ messages: [] });
    await expect(pop3Reader.verify(cfg(srv.port))).resolves.toBeUndefined();
  });

  it("limit 2 with 3 new -> 2 items, hasMore", async () => {
    const now = Date.now();
    srv = await startFakePop3({
      messages: ["a", "b", "c"].map((id) => ({ uidl: id, raw: mail(id, new Date(now - 1000)) })),
    });
    const r = await pop3Reader.fetchSince(cfg(srv.port), { cursor: null, seenUidls: [] }, { limit: 2, since: new Date(now - DAY) });
    expect(r.items).toHaveLength(2);
    expect(r.hasMore).toBe(true);
    expect(r.seenUidls).toEqual(["a", "b"]);
  });

  it("oversized message -> headers only via TOP", async () => {
    const now = Date.now();
    const big = mail("big", new Date(now - 1000), "x".repeat(10 * 1024 * 1024 + 10));
    srv = await startFakePop3({ messages: [{ uidl: "big", raw: big }] });
    const r = await pop3Reader.fetchSince(cfg(srv.port), { cursor: null, seenUidls: [] }, { limit: 5, since: new Date(now - DAY) });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].oversized).toBe(true);
    expect(r.items[0].raw.length).toBeLessThan(1000);
    expect(srv.commands.some((c) => c.startsWith("TOP 1 0"))).toBe(true);
    expect(srv.commands.some((c) => c.startsWith("RETR"))).toBe(false);
  }, 30000);

  it("trimmed seen list over a 6000-message server does not refetch", async () => {
    const now = Date.now();
    const raw = mail("m", new Date(now - 1000));
    const msgs = Array.from({ length: 6000 }, (_, i) => ({ uidl: `u${i}`, raw }));
    srv = await startFakePop3({ messages: msgs });
    const seen = msgs.map((m) => m.uidl).slice(-5000);
    const r = await pop3Reader.fetchSince(cfg(srv.port), { cursor: "", seenUidls: seen }, { limit: 50, since: new Date(now - DAY) });
    expect(r.items).toEqual([]);
    expect(r.hasMore).toBe(false);
    expect(r.seenUidls).toHaveLength(5000);
  });

  it("server streaming past the cap -> PROTOCOL", async () => {
    srv = await startFakePop3({ messages: [], floodOnUidl: true });
    await expect(
      pop3Reader.fetchSince(cfg(srv.port), { cursor: null, seenUidls: [] }, { limit: 5, since: new Date(Date.now() - DAY) }),
    ).rejects.toMatchObject({ code: "PROTOCOL" });
  }, 30000);

  it("credentials with CR/LF are rejected and never injected", async () => {
    srv = await startFakePop3({ messages: [{ uidl: "a", raw: mail("a", new Date()) }] });
    await expect(pop3Reader.verify(cfg(srv.port, "p\r\nDELE 1"))).rejects.toMatchObject({ code: "AUTH_FAILED" });
    await expect(pop3Reader.verify({ ...cfg(srv.port), username: "user\r\nDELE 1" })).rejects.toMatchObject({ code: "AUTH_FAILED" });
    expect(srv.commands.some((c) => c.startsWith("DELE"))).toBe(false);
  });

  it("blocks the host when the guard rejects it, before connecting", async () => {
    srv = await startFakePop3({ messages: [{ uidl: "a", raw: mail("a", new Date()) }] });
    const hosts: string[] = [];
    const blocking = createPop3Reader({
      assertHost: async (host) => {
        hosts.push(host);
        throw new MailReaderError("BLOCKED_HOST");
      },
    });
    await expect(blocking.verify(cfg(srv.port))).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    await expect(
      blocking.fetchSince(cfg(srv.port), { cursor: null, seenUidls: [] }, { limit: 5, since: new Date(Date.now() - DAY) }),
    ).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    expect(hosts).toEqual(["127.0.0.1", "127.0.0.1"]);
    expect(srv.connections).toBe(0);
  });
});

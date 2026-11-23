import { describe, expect, it } from "vitest";

import { formatImapCursor, imapFetchPlan, parseImapCursor } from "../../src/reader/imap-cursor";
import { newUidls, nextSeenUidls } from "../../src/reader/pop3-cursor";

describe("imap cursor", () => {
  it("parses and formats", () => {
    expect(parseImapCursor(null)).toBeNull();
    expect(parseImapCursor("garbage")).toBeNull();
    expect(parseImapCursor("123:45")).toEqual({ uidValidity: "123", lastUid: 45 });
    expect(formatImapCursor({ uidValidity: "123", lastUid: 45 })).toBe("123:45");
  });

  it("plans by uidvalidity", () => {
    expect(imapFetchPlan(null, "1")).toEqual({ mode: "since" });
    expect(imapFetchPlan({ uidValidity: "1", lastUid: 9 }, "2")).toEqual({ mode: "since" });
    expect(imapFetchPlan({ uidValidity: "1", lastUid: 9 }, "1")).toEqual({ mode: "after", lastUid: 9 });
  });
});

describe("pop3 cursor", () => {
  const server = [
    { msgNo: 1, uidl: "a" },
    { msgNo: 2, uidl: "b" },
    { msgNo: 3, uidl: "c" },
  ];
  it("excludes seen and keeps server order", () => {
    expect(newUidls(server, ["a", "c"])).toEqual([server[1]]);
    // entries before the earliest retained seen uidl count as seen (trimmed history)
    expect(newUidls(server, ["b"])).toEqual([server[2]]);
    expect(newUidls(server, [])).toEqual(server);
  });
  it("drops uidls gone from server", () => {
    expect(nextSeenUidls(["a", "gone"], ["b"], ["a", "b", "c"])).toEqual(["a", "b"]);
  });
  it("caps at 5000 keeping most recent", () => {
    const serverUidls = Array.from({ length: 6000 }, (_, i) => `u${i}`);
    const out = nextSeenUidls(serverUidls.slice(0, 5500), serverUidls.slice(5500), serverUidls);
    expect(out).toHaveLength(5000);
    expect(out[out.length - 1]).toBe("u5999");
    expect(out[0]).toBe("u1000");
  });
  it("trimmed oldest server uidls are not new again (no refetch loop)", () => {
    const all = Array.from({ length: 6000 }, (_, i) => `u${i}`);
    const server = all.map((uidl, i) => ({ msgNo: i + 1, uidl }));
    const seen = nextSeenUidls([], all, all);
    expect(seen).toHaveLength(5000);
    expect(newUidls(server, seen)).toEqual([]);
    const grown = [...server, { msgNo: 6001, uidl: "u6000" }];
    expect(newUidls(grown, seen)).toEqual([{ msgNo: 6001, uidl: "u6000" }]);
  });
});

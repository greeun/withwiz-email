export type ImapCursor = { uidValidity: string; lastUid: number };

export function parseImapCursor(c: string | null): ImapCursor | null {
  if (!c) return null;
  const m = /^(\d+):(\d+)$/.exec(c);
  if (!m) return null;
  return { uidValidity: m[1], lastUid: Number(m[2]) };
}

export function formatImapCursor(v: ImapCursor): string {
  return `${v.uidValidity}:${v.lastUid}`;
}

export function imapFetchPlan(
  cursor: ImapCursor | null,
  serverUidValidity: string,
): { mode: "since" } | { mode: "after"; lastUid: number } {
  if (!cursor || cursor.uidValidity !== serverUidValidity) return { mode: "since" };
  return { mode: "after", lastUid: cursor.lastUid };
}

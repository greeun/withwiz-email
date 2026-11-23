export const POP3_SEEN_MAX = 5000;

/**
 * New mail = UIDLs never seen. So that the oldest UIDLs trimmed off by the cap do not look new again,
 * anything that precedes (in server order) the earliest retained seen UIDL counts as already seen.
 */
export function newUidls(
  serverUidls: { msgNo: number; uidl: string }[],
  seen: string[],
): { msgNo: number; uidl: string }[] {
  const s = new Set(seen);
  const first = serverUidls.findIndex((u) => s.has(u.uidl));
  return serverUidls.filter((u, i) => i > first && !s.has(u.uidl));
}

/** Keeps only UIDLs still on the server, in server order, and the last (most recent) 5000. */
export function nextSeenUidls(seen: string[], fetched: string[], serverUidls: string[]): string[] {
  const known = new Set([...seen, ...fetched]);
  return serverUidls.filter((u) => known.has(u)).slice(-POP3_SEEN_MAX);
}

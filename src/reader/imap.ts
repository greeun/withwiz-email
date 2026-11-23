import { ImapFlow } from "imapflow";

import { formatImapCursor, imapFetchPlan, parseImapCursor } from "./imap-cursor";
import { stableMessageKey } from "./message-key";
import {
  MAIL_RAW_MAX_BYTES, MailReaderError, type FetchResult, type HostGuard, type MailReader, type RawMail, type ServerConfig,
} from "./types";

function client(cfg: ServerConfig): ImapFlow {
  const c = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.tls,
    auth: { user: cfg.username, pass: cfg.password },
    logger: false,
    socketTimeout: 30_000,
    greetingTimeout: 30_000,
    connectionTimeout: 30_000,
  });
  c.on("error", () => undefined);
  return c;
}

function mapError(e: unknown): MailReaderError {
  if (e instanceof MailReaderError) return e;
  const err = e as { authenticationFailed?: boolean; code?: string; responseStatus?: string };
  if (err?.authenticationFailed) return new MailReaderError("AUTH_FAILED", "authentication failed");
  if (err?.code === "NoConnection" || err?.code === "ETIMEDOUT" || err?.code === "ECONNREFUSED" || err?.code === "ENOTFOUND" || err?.code === "ECONNRESET") {
    return new MailReaderError("CONNECT_FAILED", "connection failed");
  }
  return new MailReaderError("PROTOCOL", "imap error");
}

async function connect(cfg: ServerConfig, assertHost: HostGuard): Promise<ImapFlow> {
  // The host guard runs before any socket is opened.
  await assertHost(cfg.host);
  const c = client(cfg);
  try {
    await c.connect();
  } catch (e) {
    // Close even on connect/auth failure so no socket or timer is left behind.
    try {
      c.close();
    } catch {
      /* ignore */
    }
    throw mapError(e);
  }
  return c;
}

/** Read-only IMAP reader (INBOX opened with readOnly). `assertHost` is required: it is the SSRF check. */
export function createImapReader(o: { assertHost: HostGuard }): MailReader {
  const assertHost = o?.assertHost;
  if (typeof assertHost !== "function") throw new TypeError("createImapReader requires an assertHost guard");
  return {
    transport: "IMAP",

    async verify(cfg) {
      const c = await connect(cfg, assertHost);
      try {
        await c.logout();
      } catch {
        c.close();
      }
    },

    async fetchSince(cfg, state, opts): Promise<FetchResult> {
      const c = await connect(cfg, assertHost);
      try {
        const lock = await c.getMailboxLock("INBOX", { readOnly: true });
        try {
          const mb = c.mailbox;
          if (!mb) throw new MailReaderError("PROTOCOL", "mailbox unavailable");
          const uidNext = Number(mb.uidNext);
          if (mb.uidValidity === undefined || !Number.isFinite(uidNext)) {
            throw new MailReaderError("PROTOCOL", "mailbox uid state unavailable");
          }
          const uidValidity = String(mb.uidValidity);
          const snapshot = Math.max(0, uidNext - 1);
          const plan = imapFetchPlan(parseImapCursor(state.cursor), uidValidity);

          let uids: number[];
          if (plan.mode === "since") {
            uids = (await c.search({ since: opts.since }, { uid: true })) || [];
          } else {
            uids = ((await c.search({ uid: `${plan.lastUid + 1}:*` }, { uid: true })) || []).filter((u) => u > plan.lastUid);
          }
          uids.sort((a, b) => a - b);
          const batch = uids.slice(0, opts.limit);
          const items: RawMail[] = [];
          for (const uid of batch) {
            const meta = await c.fetchOne(String(uid), { size: true }, { uid: true });
            if (!meta) continue;
            if ((meta.size ?? 0) > MAIL_RAW_MAX_BYTES) {
              const h = await c.fetchOne(String(uid), { headers: true }, { uid: true });
              if (h && h.headers) items.push({ providerMessageId: stableMessageKey(h.headers), raw: h.headers, oversized: true });
            } else {
              const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
              // Key from the message itself, not the UID: refetching after a UIDVALIDITY change creates no duplicates.
              if (m && m.source) items.push({ providerMessageId: stableMessageKey(m.source), raw: m.source });
            }
          }
          const hasMore = uids.length > batch.length;
          const lastProcessed = batch.length ? batch[batch.length - 1] : 0;
          const prev = plan.mode === "after" ? plan.lastUid : 0;
          const lastUid = hasMore ? lastProcessed : Math.max(snapshot, lastProcessed, prev);
          return { items, nextCursor: formatImapCursor({ uidValidity, lastUid }), hasMore };
        } finally {
          lock.release();
        }
      } catch (e) {
        throw mapError(e);
      } finally {
        try {
          await c.logout();
        } catch {
          c.close();
        }
      }
    },
  };
}

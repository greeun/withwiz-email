import { newUidls, nextSeenUidls, POP3_SEEN_MAX } from "./pop3-cursor";
import { Pop3Client } from "./pop3-client";
import {
  MAIL_RAW_MAX_BYTES, MailReaderError, type FetchResult, type HostGuard, type MailReader, type RawMail, type ServerConfig,
} from "./types";

async function open(cfg: ServerConfig, assertHost: HostGuard): Promise<Pop3Client> {
  // The host guard runs before any socket is opened.
  await assertHost(cfg.host);
  const c = new Pop3Client();
  try {
    await c.connect(cfg);
    await c.login(cfg.username, cfg.password);
  } catch (e) {
    await c.quit();
    throw e;
  }
  return c;
}

/** Reads the Date header. Missing or unparsable yields null (the mail is not filtered out). */
function headerDate(raw: Buffer): Date | null {
  const head = raw.toString("latin1").split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
  const m = /^Date:\s*(.+)$/im.exec(head);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Read-only POP3 reader (never sends DELE). `assertHost` is required: it is the SSRF check. */
export function createPop3Reader(o: { assertHost: HostGuard }): MailReader {
  const assertHost = o?.assertHost;
  if (typeof assertHost !== "function") throw new TypeError("createPop3Reader requires an assertHost guard");
  return {
    transport: "POP3",

    async verify(cfg) {
      const c = await open(cfg, assertHost);
      await c.quit();
    },

    async fetchSince(cfg, state, opts): Promise<FetchResult> {
      const c = await open(cfg, assertHost);
      try {
        const server = await c.uidl();
        const sizes = await c.sizes();
        const items: RawMail[] = [];
        const take = async (u: { msgNo: number; uidl: string }, head: Buffer) => {
          if ((sizes.get(u.msgNo) ?? 0) > MAIL_RAW_MAX_BYTES) {
            items.push({ providerMessageId: u.uidl, raw: head, oversized: true });
          } else {
            items.push({ providerMessageId: u.uidl, raw: await c.retr(u.msgNo) });
          }
        };

        if (state.seenUidls.length === 0) {
          // First sync: walk newest -> oldest reading headers only, so a large mailbox is not scanned from its oldest mail.
          // Stop at the first mail older than `since`, and record that mail and everything older as seen.
          const inRange: { u: { msgNo: number; uidl: string }; head: Buffer }[] = [];
          let boundary = -1;
          for (let i = server.length - 1; i >= 0; i--) {
            if (inRange.length >= POP3_SEEN_MAX) {
              boundary = i;
              break;
            }
            const head = await c.top(server[i].msgNo);
            const d = headerDate(head);
            if (d && d < opts.since) {
              boundary = i;
              break;
            }
            inRange.push({ u: server[i], head });
          }
          // Take `limit` from the oldest end; the rest come later in server order, so the next sync's forward path picks them up.
          inRange.reverse();
          const batch = inRange.slice(0, opts.limit);
          for (const { u, head } of batch) await take(u, head);
          return {
            items,
            nextCursor: "",
            hasMore: inRange.length > batch.length,
            seenUidls: nextSeenUidls(
              [],
              [...server.slice(0, boundary + 1).map((u) => u.uidl), ...batch.map((b) => b.u.uidl)],
              server.map((u) => u.uidl),
            ),
          };
        }

        const fresh = newUidls(server, state.seenUidls);
        const batch = fresh.slice(0, opts.limit);
        for (const u of batch) {
          // Fetch headers first to check Date: bodies of old mails are never downloaded.
          const head = await c.top(u.msgNo);
          const d = headerDate(head);
          if (d && d < opts.since) continue;
          await take(u, head);
        }
        return {
          items,
          nextCursor: "",
          hasMore: fresh.length > batch.length,
          seenUidls: nextSeenUidls(
            state.seenUidls,
            batch.map((u) => u.uidl),
            server.map((u) => u.uidl),
          ),
        };
      } catch (e) {
        if (e instanceof MailReaderError) throw e;
        throw new MailReaderError("PROTOCOL", "pop3 fetch failed");
      } finally {
        await c.quit();
      }
    },
  };
}

import { createGraphReader } from "./graph";
import { createImapReader } from "./imap";
import { createPop3Reader } from "./pop3";
import type { GraphConfig, HostGuard, MailReader } from "./types";

export type MailReaders = { IMAP: MailReader; POP3: MailReader; GRAPH: MailReader<GraphConfig> };

/**
 * Builds the three readers. `assertHost` is required and is passed to the IMAP and POP3 readers, which run it
 * before opening any socket. Graph talks only to graph.microsoft.com and takes no guard.
 */
export function createMailReaders(o: { assertHost: HostGuard; graph?: { now?: () => number; budgetMs?: number } }): MailReaders {
  if (typeof o?.assertHost !== "function") throw new TypeError("createMailReaders requires an assertHost guard");
  return {
    IMAP: createImapReader({ assertHost: o.assertHost }),
    POP3: createPop3Reader({ assertHost: o.assertHost }),
    GRAPH: createGraphReader(o.graph),
  };
}

export { createGraphReader } from "./graph";
export { createImapReader } from "./imap";
export { createPop3Reader } from "./pop3";

export { MAIL_RAW_MAX_BYTES, MailReaderError } from "./types";
export type {
  FetchResult,
  GraphConfig,
  HostGuard,
  MailCredential,
  MailReader,
  MailReaderErrorCode,
  OAuthCredential,
  ParsedMail,
  RawMail,
  ServerConfig,
  ServerCredential,
} from "./types";

export { MAIL_BODY_MAX_BYTES, parseRawMail } from "./parse";
export { stableMessageKey } from "./message-key";
export type { ImapCursor } from "./imap-cursor";
export { formatImapCursor, imapFetchPlan, parseImapCursor } from "./imap-cursor";
export { newUidls, nextSeenUidls, POP3_SEEN_MAX } from "./pop3-cursor";

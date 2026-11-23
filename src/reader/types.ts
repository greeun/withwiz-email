/** Raw size cap. Larger mails are fetched as headers only and flagged `oversized`. */
export const MAIL_RAW_MAX_BYTES = 10 * 1024 * 1024;

export type RawMail = { providerMessageId: string; raw: Buffer; oversized?: boolean };

export type ServerConfig = { host: string; port: number; tls: boolean; username: string; password: string };

export type OAuthCredential = {
  kind: "oauth";
  provider: "microsoft";
  refreshToken: string;
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
  /** Graph user id */
  accountId: string;
};
/** A stored value without `kind` is a server credential (backward compatible). */
export type ServerCredential = { kind?: "server" } & ServerConfig;
export type MailCredential = ServerCredential | OAuthCredential;

/** Graph reader config: knows nothing about storage, only takes a token supplier. */
export type GraphConfig = { getAccessToken: () => Promise<string>; fetch?: typeof fetch };

export type FetchResult = { items: RawMail[]; nextCursor: string; hasMore: boolean; seenUidls?: string[] };

export interface MailReader<C = ServerConfig> {
  transport: "IMAP" | "POP3" | "GRAPH";
  /** Rejects with MailReaderError on failure. */
  verify(cfg: C): Promise<void>;
  fetchSince(
    cfg: C,
    state: { cursor: string | null; seenUidls: string[] },
    opts: { limit: number; since: Date },
  ): Promise<FetchResult>;
}

export type ParsedMail = {
  from: string;
  subject: string;
  receivedAt: Date;
  text: string;
  truncated: boolean;
  attachments: { name: string; size: number }[];
};

export type MailReaderErrorCode =
  | "AUTH_FAILED"
  | "CONNECT_FAILED"
  | "BLOCKED_HOST"
  | "PROTOCOL";

export class MailReaderError extends Error {
  readonly code: MailReaderErrorCode;
  constructor(code: MailReaderErrorCode, message?: string) {
    super(message ?? code);
    this.name = "MailReaderError";
    this.code = code;
  }
}

/**
 * Host check run before any socket is opened (SSRF protection). Supplied by the consumer:
 * resolve to allow, throw `new MailReaderError("BLOCKED_HOST")` to reject.
 */
export type HostGuard = (host: string) => Promise<void>;

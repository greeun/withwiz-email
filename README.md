[한국어](README.ko.md)

# @withwiz/email

Provider-agnostic transactional email for Node.js. One `EmailTransport` interface with
Brevo, Mailjet, Resend (plain HTTPS, no SDK), SMTP (nodemailer, optional) and a console
fallback, plus environment-based selection.

Built for hosts that block outbound SMTP (e.g. Railway below Pro): the HTTP providers
only need port 443.

## Install

```bash
pnpm add @withwiz/email
# only if you use the smtp transport
pnpm add nodemailer
```

## Quick start

```ts
import { resolveTransportFromEnv, withSendLog } from "@withwiz/email";

const transport = withSendLog(
  resolveTransportFromEnv(process.env, { defaultFrom: "My App <no-reply@example.com>" }),
);

await transport.send({ to: ["user@example.com"], subject: "Hello", html: "<p>Hi</p>" });
```

## Environment variables

| Variable | Meaning |
|---|---|
| `EMAIL_TRANSPORT` | `brevo` \| `mailjet` \| `resend` \| `smtp` \| `console`. Pins one transport; a missing key throws |
| `BREVO_API_KEY` | Brevo |
| `MAILJET_API_KEY`, `MAILJET_API_SECRET` | Mailjet (both required) |
| `RESEND_API_KEY` | Resend |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | SMTP |
| `EMAIL_FROM` (fallback `SMTP_FROM`) | Sender, `Name <addr>` or `addr` |

Without `EMAIL_TRANSPORT` the first configured provider wins:
Brevo → Mailjet → Resend → SMTP → console. Empty strings count as unset.

## API

- `resolveTransportFromEnv(env, { defaultFrom, logger?, fetchImpl? })`
- `transportLabelFromEnv(env, options)`: name for a startup banner, `"misconfigured"` instead of throwing
- `emailFromEnv(env, defaultFrom)`
- `createBrevoTransport`, `createMailjetTransport`, `createResendTransport` (`{ apiKey, from, fetchImpl?, timeoutMs? }`, default timeout 15 s)
- `createSmtpTransport({ host, port, user?, pass?, secure?, from, timeoutMs? })` (connection/greeting/socket timeout, default 15 s)
- `createConsoleTransport({ logger? })`
- `sendEach(transport, recipients, build, { logger? })`: one message per recipient, 5 concurrent, case-insensitive dedupe, returns `{ failed }`, throws only when all fail
- `withSendLog(transport, { logger? })`: one log line per send, never logs bodies or headers
- `parseAddress`, `escapeHtml`, `recipientCount`, `consoleLogger`

### Bundlers (Next.js)

`import("nodemailer")` is resolved at build time by webpack/Turbopack. Apps that do not
install nodemailer should add `serverExternalPackages: ["@withwiz/email"]` to `next.config`,
or install nodemailer.

### Logger

Pass any `{ info(message, meta?), error(message, meta?) }`. Defaults to `console`.

```ts
const logger = { info: (m, meta) => appLogger.info(m, meta), error: (m, meta) => appLogger.error(m, meta) };
```

## Mail reader (`@withwiz/email/reader`)

Read-only inbox fetch over IMAP, POP3 and Microsoft Graph, with resumable cursors. It never deletes,
moves or flags mail: IMAP opens INBOX read-only, POP3 never sends `DELE`, Graph only issues `GET`.
The root entry does not import the reader, so apps that only send mail do not need its dependencies.

```bash
# only if you use the reader
pnpm add imapflow mailparser
```

```ts
import { createMailReaders, MailReaderError, parseRawMail } from "@withwiz/email/reader";

const readers = createMailReaders({
  // Required. Runs before any IMAP/POP3 socket is opened.
  assertHost: async (host) => {
    if (await isPrivateOrBlocked(host)) throw new MailReaderError("BLOCKED_HOST");
  },
});

const cfg = { host: "imap.example.com", port: 993, tls: true, username: "me", password: "app-password" };
await readers.IMAP.verify(cfg);
const { items, nextCursor, hasMore } = await readers.IMAP.fetchSince(
  cfg,
  { cursor: savedCursor, seenUidls: savedSeenUidls },
  { limit: 50, since: new Date(Date.now() - 3 * 24 * 3600 * 1000) },
);
for (const m of items) {
  const parsed = await parseRawMail(m.raw, new Date()); // from, subject, text (50 KB cap), attachments
}
// Store nextCursor (and seenUidls for POP3); call again while hasMore is true.
```

`readers.GRAPH` takes `{ getAccessToken, fetch? }` instead of a server config and only talks to
`graph.microsoft.com`.

- `createMailReaders({ assertHost, graph? })`, `createImapReader({ assertHost })`, `createPop3Reader({ assertHost })`,
  `createGraphReader({ now?, budgetMs? })` (Graph time budget per fetch, default 90 s)
- `RawMail.providerMessageId` is a dedup key: IMAP and Graph use `stableMessageKey` (normalised Message-ID, or a
  header hash), POP3 uses the UIDL. Mails over `MAIL_RAW_MAX_BYTES` (10 MB) come back as headers only with `oversized: true`.
- Errors are `MailReaderError` with `code` `AUTH_FAILED` | `CONNECT_FAILED` | `BLOCKED_HOST` | `PROTOCOL` and fixed
  messages (no server responses or tokens).
- Cursor helpers: `parseImapCursor`, `formatImapCursor`, `imapFetchPlan`, `newUidls`, `nextSeenUidls`, `POP3_SEEN_MAX`.

**The host guard is required.** IMAP and POP3 connect to user-supplied hosts, so without a check a user could
point the reader at internal addresses (SSRF). The factories throw if `assertHost` is missing; there is no
allow-all default. Resolve the name and reject private, loopback and link-local addresses in your guard.

## Notes

- Mailjet reports per-message failures inside HTTP 200; the transport throws on them.
- Zero recipients is a no-op success.
- There is no `bcc`: send to many with `sendEach`.
- `replyTo` (`Name <addr>` or a bare address) and `attachments` (`{ filename, content, contentType? }`, `content` is a string or bytes) work on every transport except console, which only logs. Brevo takes the type from the file extension. Attachment contents are never logged; provider size limits apply.

## License

MIT

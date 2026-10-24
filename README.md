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
- `createSmtpTransport({ host, port, user?, pass?, secure?, from })`
- `createConsoleTransport({ logger? })`
- `sendEach(transport, recipients, build, { logger? })`: one message per recipient, 5 concurrent, case-insensitive dedupe, returns `{ failed }`, throws only when all fail
- `withSendLog(transport, { logger? })`: one log line per send, never logs bodies or headers
- `parseAddress`, `escapeHtml`, `recipientCount`, `consoleLogger`

### Logger

Pass any `{ info(message, meta?), error(message, meta?) }`. Defaults to `console`.

```ts
const logger = { info: (m, meta) => appLogger.info(m, meta), error: (m, meta) => appLogger.error(m, meta) };
```

## Notes

- Mailjet reports per-message failures inside HTTP 200; the transport throws on them.
- Zero recipients is a no-op success.
- There is no `bcc`: send to many with `sendEach`.

## License

MIT

[English](README.md)

# @withwiz/email

Node.js용 공급자 중립 트랜잭션 이메일 패키지입니다. 하나의 `EmailTransport` 인터페이스로
Brevo, Mailjet, Resend(SDK 없이 순수 HTTPS), SMTP(nodemailer, 선택 사항), 콘솔 대체
전송을 제공하며, 환경 변수 기반으로 전송 방식을 선택합니다.

외부 SMTP 발송을 막는 호스트(예: Pro 미만 요금제의 Railway)를 위해 만들었습니다.
HTTP 공급자는 443 포트만 있으면 됩니다.

## 설치

```bash
pnpm add @withwiz/email
# smtp 전송을 쓸 때만
pnpm add nodemailer
```

## 빠른 시작

```ts
import { resolveTransportFromEnv, withSendLog } from "@withwiz/email";

const transport = withSendLog(
  resolveTransportFromEnv(process.env, { defaultFrom: "My App <no-reply@example.com>" }),
);

await transport.send({ to: ["user@example.com"], subject: "Hello", html: "<p>Hi</p>" });
```

## 환경 변수

| 변수 | 의미 |
|---|---|
| `EMAIL_TRANSPORT` | `brevo` \| `mailjet` \| `resend` \| `smtp` \| `console`. 전송 방식 하나를 고정하며, 키가 없으면 예외를 던집니다 |
| `BREVO_API_KEY` | Brevo |
| `MAILJET_API_KEY`, `MAILJET_API_SECRET` | Mailjet (둘 다 필수) |
| `RESEND_API_KEY` | Resend |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | SMTP |
| `EMAIL_FROM` (대체값 `SMTP_FROM`) | 발신자, `Name <addr>` 또는 `addr` |

`EMAIL_TRANSPORT`가 없으면 설정된 첫 번째 공급자가 선택됩니다.
Brevo → Mailjet → Resend → SMTP → console 순서입니다. 빈 문자열은 설정하지 않은 것으로 봅니다.

## API

- `resolveTransportFromEnv(env, { defaultFrom, logger?, fetchImpl? })`
- `transportLabelFromEnv(env, options)`: 구동 배너에 쓸 이름. 예외를 던지는 대신 `"misconfigured"`를 반환
- `emailFromEnv(env, defaultFrom)`
- `createBrevoTransport`, `createMailjetTransport`, `createResendTransport` (`{ apiKey, from, fetchImpl?, timeoutMs? }`, 기본 타임아웃 15초)
- `createSmtpTransport({ host, port, user?, pass?, secure?, from, timeoutMs? })` (연결·greeting·소켓 타임아웃, 기본 15초)
- `createConsoleTransport({ logger? })`
- `sendEach(transport, recipients, build, { logger? })`: 수신자마다 메시지 1건, 동시 5건, 대소문자 무시 중복 제거, `{ failed }` 반환, 전부 실패할 때만 예외
- `withSendLog(transport, { logger? })`: 발송마다 로그 1줄, 본문과 헤더는 절대 기록하지 않음
- `parseAddress`, `escapeHtml`, `recipientCount`, `consoleLogger`

### 번들러 (Next.js)

`import("nodemailer")`는 webpack/Turbopack이 빌드 시점에 해석한다. nodemailer를 설치하지 않는 앱은
`next.config`에 `serverExternalPackages: ["@withwiz/email"]`을 추가하거나 nodemailer를 설치한다.

### 로거

`{ info(message, meta?), error(message, meta?) }` 형태면 무엇이든 전달할 수 있습니다. 기본값은 `console`입니다.

```ts
const logger = { info: (m, meta) => appLogger.info(m, meta), error: (m, meta) => appLogger.error(m, meta) };
```

## 메일 읽기 (`@withwiz/email/reader`)

IMAP, POP3, Microsoft Graph 받은편지함을 읽기 전용으로 가져오며, 이어 받기용 커서를 돌려줍니다. 메일을
지우거나 옮기거나 표시를 바꾸지 않습니다. IMAP 은 INBOX 를 읽기 전용으로 열고, POP3 는 `DELE` 를 보내지 않으며,
Graph 는 `GET` 만 씁니다. 루트 진입점은 reader 를 import 하지 않으므로 발송만 하는 앱은 아래 의존성이 필요 없습니다.

```bash
# reader 를 쓸 때만
pnpm add imapflow mailparser
```

```ts
import { createMailReaders, MailReaderError, parseRawMail } from "@withwiz/email/reader";

const readers = createMailReaders({
  // 필수. IMAP/POP3 소켓을 열기 전에 실행됩니다.
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
  const parsed = await parseRawMail(m.raw, new Date()); // from, subject, text(50KB 상한), attachments
}
// nextCursor(POP3 는 seenUidls 도)를 저장하고, hasMore 가 true 인 동안 다시 호출합니다.
```

`readers.GRAPH` 는 서버 설정 대신 `{ getAccessToken, fetch? }` 를 받고 `graph.microsoft.com` 에만 접속합니다.

- `createMailReaders({ assertHost, graph? })`, `createImapReader({ assertHost })`, `createPop3Reader({ assertHost })`,
  `createGraphReader({ now?, budgetMs? })`(Graph 한 번 수집의 시간 예산, 기본 90초)
- `RawMail.providerMessageId` 는 중복 제거 키입니다. IMAP 과 Graph 는 `stableMessageKey`(정규화한 Message-ID 또는
  헤더 해시), POP3 는 UIDL 을 씁니다. `MAIL_RAW_MAX_BYTES`(10MB)를 넘는 메일은 헤더만 담고 `oversized: true` 로 옵니다.
- 오류는 `MailReaderError` 이며 `code` 는 `AUTH_FAILED` | `CONNECT_FAILED` | `BLOCKED_HOST` | `PROTOCOL`, 메시지는
  고정 문구입니다(서버 응답이나 토큰을 담지 않음).
- 커서 도우미: `parseImapCursor`, `formatImapCursor`, `imapFetchPlan`, `newUidls`, `nextSeenUidls`, `POP3_SEEN_MAX`.

**호스트 검사는 필수입니다.** IMAP 과 POP3 는 사용자가 입력한 호스트에 접속하므로, 검사가 없으면 내부 주소로
접속하게 만들 수 있습니다(SSRF). `assertHost` 가 없으면 생성 함수가 예외를 던지며, 모두 허용하는 기본값은 없습니다.
검사 함수에서 이름을 해석해 사설·루프백·링크 로컬 주소를 거부하세요.

## 참고

- Mailjet은 메시지별 실패를 HTTP 200 응답 안에 담아 보고하며, 전송 모듈은 이를 예외로 던집니다.
- 수신자가 0명이면 아무 일도 하지 않고 성공으로 처리합니다.
- `bcc`는 없습니다. 여러 명에게 보낼 때는 `sendEach`를 사용하세요.
- `replyTo`(`이름 <주소>` 또는 주소)와 `attachments`(`{ filename, content, contentType? }`, `content`는 문자열 또는 바이트)는 console 을 제외한 모든 발송기에서 동작합니다. console 은 기록만 합니다. Brevo 는 파일 확장자로 형식을 정합니다. 첨부의 내용은 기록하지 않으며, 발송 서비스의 크기 제한이 적용됩니다.

## 라이선스

MIT

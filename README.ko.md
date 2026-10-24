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

## 참고

- Mailjet은 메시지별 실패를 HTTP 200 응답 안에 담아 보고하며, 전송 모듈은 이를 예외로 던집니다.
- 수신자가 0명이면 아무 일도 하지 않고 성공으로 처리합니다.
- `bcc`는 없습니다. 여러 명에게 보낼 때는 `sendEach`를 사용하세요.

## 라이선스

MIT

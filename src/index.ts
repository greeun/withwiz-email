export type { EmailLogger, EmailMessage, EmailRecipient, EmailTransport, EmailTransportName } from "./types";
export { escapeHtml, recipientCount } from "./types";
export type { EmailAddress } from "./address";
export { parseAddress } from "./address";
export { consoleLogger } from "./logger";

export type { BrevoTransportConfig } from "./transports/brevo";
export { createBrevoTransport } from "./transports/brevo";
export type { MailjetTransportConfig } from "./transports/mailjet";
export { createMailjetTransport } from "./transports/mailjet";
export type { ResendTransportConfig } from "./transports/resend";
export { createResendTransport } from "./transports/resend";
export type { SmtpTransportConfig } from "./transports/smtp";
export { createSmtpTransport } from "./transports/smtp";
export type { ConsoleTransportOptions } from "./transports/console";
export { createConsoleTransport } from "./transports/console";

export type { SendEachOptions } from "./fanout";
export { sendEach } from "./fanout";
export type { EmailEnv, ResolveOptions } from "./env";
export { emailFromEnv, resolveTransportFromEnv, TRANSPORT_NAMES, transportLabelFromEnv } from "./env";
export type { SendLogOptions } from "./send-log";
export { withSendLog } from "./send-log";

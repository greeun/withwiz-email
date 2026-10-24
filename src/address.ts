/**
 * Sender address parsing. Resend and SMTP accept `Name <addr>` as one string,
 * but Brevo and Mailjet want the name and the address in separate fields.
 */
export interface EmailAddress {
  name?: string;
  email: string;
}

const ANGLE = /^(.*)<([^>]*)>\s*$/;

/** `Tavlet <a@b.com>` → { name, email }. Without angle brackets, the address only. */
export function parseAddress(value: string): EmailAddress {
  const match = ANGLE.exec(value.trim());
  if (!match) return { email: value.trim() };

  const name = match[1].trim().replace(/^"(.*)"$/, "$1").trim();
  const email = match[2].trim();
  return name ? { name, email } : { email };
}

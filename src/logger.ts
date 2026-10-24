import type { EmailLogger } from "./types";

/** Default logger used when the caller injects none. */
export const consoleLogger: EmailLogger = {
  info: (message, meta) => (meta ? console.info(message, meta) : console.info(message)),
  error: (message, meta) => (meta ? console.error(message, meta) : console.error(message)),
};

import { describe, it, expect } from "vitest";

import * as api from "../src/index";

describe("public API", () => {
  it("exports the documented runtime symbols", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "TRANSPORT_NAMES",
        "consoleLogger",
        "createBrevoTransport",
        "createConsoleTransport",
        "createMailjetTransport",
        "createResendTransport",
        "createSmtpTransport",
        "emailFromEnv",
        "escapeHtml",
        "parseAddress",
        "recipientCount",
        "resolveTransportFromEnv",
        "sendEach",
        "transportLabelFromEnv",
        "withSendLog",
      ].sort(),
    );
  });
});

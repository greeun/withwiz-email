import { describe, expect, it } from "vitest";

import * as reader from "../../src/reader/index";

describe("reader public API", () => {
  it("exports the documented runtime symbols", () => {
    expect(Object.keys(reader).sort()).toEqual(
      [
        "MAIL_BODY_MAX_BYTES",
        "MAIL_RAW_MAX_BYTES",
        "MailReaderError",
        "POP3_SEEN_MAX",
        "createGraphReader",
        "createImapReader",
        "createMailReaders",
        "createPop3Reader",
        "formatImapCursor",
        "imapFetchPlan",
        "newUidls",
        "nextSeenUidls",
        "parseImapCursor",
        "parseRawMail",
        "stableMessageKey",
      ].sort(),
    );
  });
});

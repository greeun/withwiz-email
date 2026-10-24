import { describe, it, expect } from "vitest";

import { parseAddress } from "../src/address";

describe("parseAddress", () => {
  it("splits `Name <addr>` into name and email", () => {
    expect(parseAddress("Tavlet <no-reply@tavlet.io>")).toEqual({ name: "Tavlet", email: "no-reply@tavlet.io" });
  });

  it("strips surrounding quotes from the name", () => {
    expect(parseAddress('"Tlog Team" <hello@tlog.net>')).toEqual({ name: "Tlog Team", email: "hello@tlog.net" });
  });

  it("returns the address alone when there are no angle brackets", () => {
    expect(parseAddress("  a@b.com ")).toEqual({ email: "a@b.com" });
  });

  it("omits an empty name", () => {
    expect(parseAddress("<a@b.com>")).toEqual({ email: "a@b.com" });
  });
});

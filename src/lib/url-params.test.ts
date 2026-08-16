import { describe, expect, it } from "vitest";

import { withParams } from "./url-params";

describe("withParams", () => {
  it("returns the bare path when nothing survives", () => {
    expect(withParams("/saved", {}, {})).toBe("/saved");
    expect(withParams("/saved", { q: undefined }, { page: undefined })).toBe("/saved");
  });

  it("merges params with overrides winning", () => {
    expect(withParams("/notifications", { filter: "unread" }, { filter: undefined })).toBe(
      "/notifications"
    );
    expect(
      withParams("/notifications", { filter: "unread" }, { section: "marketplace" })
    ).toBe("/notifications?filter=unread&section=marketplace");
  });

  it("drops empty values so canonical states stay clean paths", () => {
    expect(withParams("/messages", { q: "" }, { page: "2" })).toBe("/messages?page=2");
  });

  it("encodes values", () => {
    expect(withParams("/saved", { q: "kw v3" }, {})).toBe("/saved?q=kw+v3");
  });
});

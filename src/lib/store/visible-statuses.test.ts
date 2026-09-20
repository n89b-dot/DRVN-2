import { describe, expect, it } from "vitest";

import { allowedStoreStatuses, parseStoreTab, storeStatusesFor, storeTabsFor } from "./visible-statuses";

describe("store visibility (P-6)", () => {
  it("shows the public active and sold — history is part of the proposition", () => {
    expect(allowedStoreStatuses(false).sort()).toEqual(["active", "sold"]);
  });

  it("shows the owner what they need to act on as well", () => {
    expect(allowedStoreStatuses(true).sort()).toEqual([
      "active",
      "draft",
      "paused",
      "reserved",
      "sold",
    ]);
  });

  it("never lets a URL widen what a visitor can see", () => {
    // The dangerous case: ?status=draft on somebody else's store. An unknown
    // tab — and the owner-only one — is the default for a visitor, so this
    // is the ordinary for-sale view rather than their unpublished listings,
    // and rather than an empty page that confirms there is something hidden.
    for (const attack of ["draft", "paused", "reserved", "hidden", "anything", "../"]) {
      expect(storeStatusesFor(false, attack)).toEqual(["active"]);
      expect(parseStoreTab(attack)).toBe("active");
    }
    expect(storeStatusesFor(false, "all")).toEqual(["active", "sold"]);
  });

  it("opens on what is for sale", () => {
    expect(parseStoreTab(undefined)).toBe("active");
    expect(storeStatusesFor(true, undefined)).toEqual(["active"]);
  });

  it("gives the owner — and only the owner — a worklist of what isn't live", () => {
    expect(storeStatusesFor(true, "hidden")).toEqual(["draft", "paused", "reserved"]);
    expect(storeTabsFor(true).map((t) => t.key)).toEqual(["active", "sold", "all", "hidden"]);
    expect(storeTabsFor(false).map((t) => t.key)).toEqual(["active", "sold", "all"]);
  });

  it("narrows to one status when the visitor picks a tab", () => {
    expect(storeStatusesFor(false, "active")).toEqual(["active"]);
    expect(storeStatusesFor(false, "sold")).toEqual(["sold"]);
    expect(storeStatusesFor(true, "active")).toEqual(["active"]);
  });

  it("keeps the owner's extra states on the All tab only", () => {
    expect(storeStatusesFor(true, "all")).toContain("draft");
    expect(storeStatusesFor(true, "sold")).not.toContain("draft");
  });
});

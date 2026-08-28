import { describe, expect, it } from "vitest";

import { canonicalizeImportUrl, parseImportUrl, policyFor } from "./policy";

describe("parseImportUrl", () => {
  it("accepts bare domains and full URLs", () => {
    expect(parseImportUrl("golfmk7.com/threads/fs.123/")?.protocol).toBe("https:");
    expect(parseImportUrl("https://www.facebook.com/marketplace/item/123")?.hostname).toBe(
      "www.facebook.com"
    );
  });
  it("refuses junk", () => {
    expect(parseImportUrl("")).toBeNull();
    expect(parseImportUrl("not a url at all")).toBeNull();
    expect(parseImportUrl("ftp://example.com/x")).toBeNull();
    expect(parseImportUrl("https://user:pw@example.com/x")).toBeNull();
  });
});

describe("policyFor", () => {
  it("treats Facebook as a first-class public_url attempt", () => {
    const policy = policyFor(new URL("https://www.facebook.com/marketplace/item/1234567890/"));
    expect(policy.mode).toBe("public_url");
    expect(policy.adapterId).toBe("facebook");
    expect(policy.label).toBe("Facebook Marketplace");
  });

  it("routes Craigslist and Instagram to paste", () => {
    expect(policyFor(new URL("https://miami.craigslist.org/brw/pts/d/x/7712.html")).mode).toBe(
      "paste_only"
    );
    expect(policyFor(new URL("https://www.instagram.com/p/xyz/")).mode).toBe("paste_only");
  });

  it("defaults unknown public sites to a generic attempt", () => {
    const policy = policyFor(new URL("https://www.golfmk7.com/forums/threads/fs-intake.412/"));
    expect(policy.mode).toBe("public_url");
    expect(policy.adapterId).toBe("generic");
    expect(policy.label).toBe("golfmk7.com");
  });
});

describe("canonicalizeImportUrl", () => {
  it("normalizes scheme/host and strips tracking params + fragments", () => {
    const a = canonicalizeImportUrl(
      new URL("http://WWW.Example.com/listing/42/?fbclid=abc&utm_source=x&sku=9#photos")
    );
    expect(a).toBe("https://example.com/listing/42?sku=9");
  });
  it("dedupes trailing slashes", () => {
    expect(canonicalizeImportUrl(new URL("https://example.com/listing/42/"))).toBe(
      canonicalizeImportUrl(new URL("https://example.com/listing/42"))
    );
  });
});

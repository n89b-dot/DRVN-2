import { describe, expect, it } from "vitest";

import {
  canonicalizeImportUrl,
  facebookItemId,
  normalizeImportUrl,
  parseImportUrl,
  policyFor,
} from "./policy";

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

describe("normalizeImportUrl", () => {
  const item = "https://www.facebook.com/marketplace/item/751559927777591/";
  const norm = (raw: string) => normalizeImportUrl(new URL(raw)).href;

  it("maps every app-copied Marketplace link to the one logged-out page", () => {
    expect(norm("https://m.facebook.com/marketplace/item/751559927777591/")).toBe(item);
    expect(norm("https://mbasic.facebook.com/marketplace/item/751559927777591")).toBe(item);
    expect(norm("https://web.facebook.com/marketplace/item/751559927777591/?_rdc=1&_rdr")).toBe(item);
    expect(norm("http://facebook.com/marketplace/item/751559927777591")).toBe(item);
    expect(
      norm("https://www.facebook.com/marketplace/item/751559927777591/?ref=product_details&referral_code=null&mibextid=6ojiHh")
    ).toBe(item);
    expect(norm("https://www.facebook.com/marketplace/sanfrancisco/item/751559927777591/")).toBe(item);
    expect(norm("https://www.facebook.com/commerce/listing/751559927777591/")).toBe(item);
  });

  it("unwraps the l.facebook.com link shim", () => {
    const shimmed = `https://l.facebook.com/l.php?u=${encodeURIComponent("https://m.facebook.com/marketplace/item/751559927777591/")}&h=AT0x`;
    expect(norm(shimmed)).toBe(item);
    expect(norm(`https://l.facebook.com/l.php?u=${encodeURIComponent("https://golfmk7.com/threads/fs.1/")}`)).toBe(
      "https://golfmk7.com/threads/fs.1/"
    );
  });

  it("moves other Facebook links (share links) to www and leaves everything else alone", () => {
    expect(norm("https://m.facebook.com/share/1AbCdEfG/")).toBe("https://www.facebook.com/share/1AbCdEfG/");
    expect(norm("https://fb.me/abc123")).toBe("https://fb.me/abc123");
    expect(norm("https://golfmk7.com/threads/fs.1/?page=2")).toBe("https://golfmk7.com/threads/fs.1/?page=2");
  });

  it("dedupes mobile and desktop links to the same import", () => {
    const a = canonicalizeImportUrl(normalizeImportUrl(new URL("https://m.facebook.com/marketplace/item/751559927777591/?ref=share")));
    const b = canonicalizeImportUrl(normalizeImportUrl(new URL(item)));
    expect(a).toBe(b);
  });
});

describe("facebookItemId", () => {
  it("reads the item id from Facebook links only", () => {
    expect(facebookItemId(new URL("https://www.facebook.com/marketplace/item/751559927777591/"))).toBe("751559927777591");
    expect(facebookItemId(new URL("https://www.facebook.com/share/1AbCdEfG/"))).toBeNull();
    expect(facebookItemId(new URL("https://example.com/marketplace/item/751559927777591/"))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { normalizeCurrency, parsePriceCents } from "./part-link";

/**
 * A reference price on a build sheet is read by a human and never used for a
 * transaction, which cuts both ways: nothing breaks if it is missing, and
 * nothing catches it if it is wrong. So the parser refuses everything it
 * cannot read unambiguously rather than guessing.
 */
describe("reference price from a pasted product link", () => {
  it("reads plain decimal prices", () => {
    expect(parsePriceCents("1299.00")).toBe(129900);
    expect(parsePriceCents("£1,299")).toBe(129900);
    expect(parsePriceCents("249")).toBe(24900);
    expect(parsePriceCents("  99.99 USD ")).toBe(9999);
  });

  it("refuses a price it would have to guess at", () => {
    // European decimal comma: 1.299,00 is one thousand two hundred, but
    // 1,299 is either 1.299 or 1299 depending on the shop's locale.
    expect(parsePriceCents("1.299,00")).toBeNull();
    expect(parsePriceCents("1299,50")).toBeNull();
    expect(parsePriceCents("")).toBeNull();
    expect(parsePriceCents(undefined)).toBeNull();
    expect(parsePriceCents("free")).toBeNull();
    expect(parsePriceCents("0")).toBeNull();
    expect(parsePriceCents("-40")).toBeNull();
  });

  it("only accepts an ISO-4217-shaped currency", () => {
    expect(normalizeCurrency("gbp")).toBe("GBP");
    expect(normalizeCurrency(" usd ")).toBe("USD");
    expect(normalizeCurrency("£")).toBeNull();
    expect(normalizeCurrency("dollars")).toBeNull();
    expect(normalizeCurrency(undefined)).toBeNull();
  });
});

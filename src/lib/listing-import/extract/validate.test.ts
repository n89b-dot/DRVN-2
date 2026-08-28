import { describe, expect, it } from "vitest";

import type { NormalizedImportSource } from "../schema";
import { finalizeExtraction } from "./validate";

const source = (text: string, extra?: Partial<NormalizedImportSource>): NormalizedImportSource => ({
  sourceType: "paste",
  text,
  images: [],
  ...extra,
});

const base = {
  isSalePost: true,
  multipleItems: false,
  rawFitmentMentions: [] as string[],
};

describe("finalizeExtraction — structure", () => {
  it("rejects malformed output", () => {
    expect(finalizeExtraction(null, source("x")).ok).toBe(false);
    expect(finalizeExtraction({ notTheSchema: true }, source("x")).ok).toBe(false);
  });

  it("rejects non-sale posts with a specific code", () => {
    const result = finalizeExtraction({ ...base, isSalePost: false }, source("my build thread"));
    expect(!result.ok && result.code).toBe("source_not_sale_post");
  });
});

describe("finalizeExtraction — taxonomy", () => {
  it("drops invented categories and mismatched subcategories", () => {
    const invented = finalizeExtraction(
      { ...base, category: "flux-capacitors", subcategory: "exhaust" },
      source("FS: something $100")
    );
    expect(invented.ok && invented.extraction.category).toBeUndefined();

    const mismatched = finalizeExtraction(
      { ...base, category: "performance", subcategory: "coilovers" }, // coilovers ∉ performance
      source("FS: downpipe $100")
    );
    expect(mismatched.ok && mismatched.extraction.category).toBe("performance");
    expect(mismatched.ok && mismatched.extraction.subcategory).toBeUndefined();
  });
});

describe("finalizeExtraction — non-invention", () => {
  it("drops a price with no trace in the source", () => {
    const result = finalizeExtraction(
      { ...base, priceCents: 45000 },
      source("FS APR downpipe, PM me for pricing")
    );
    expect(result.ok && result.extraction.priceCents).toBeUndefined();
    expect(
      result.ok && result.extraction.needsReview.some((issue) => issue.field === "price")
    ).toBe(true);
  });

  it("keeps a price the post states", () => {
    const result = finalizeExtraction(
      { ...base, priceCents: 45000 },
      source("FS APR downpipe $450 shipped OBO")
    );
    expect(result.ok && result.extraction.priceCents).toBe(45000);
  });

  it("keeps a price stated in structured facts", () => {
    const result = finalizeExtraction(
      { ...base, priceCents: 18900 },
      source("APR turbo inlet", { structuredFacts: { priceText: "189.00 USD" } })
    );
    expect(result.ok && result.extraction.priceCents).toBe(18900);
  });

  it("drops shipping-included with no shipping language", () => {
    const result = finalizeExtraction(
      { ...base, priceCents: 10000, shippingIncluded: true, shippingCents: 0 },
      source("FS wheel set $100 pickup only")
    );
    expect(result.ok && result.extraction.shippingIncluded).toBeUndefined();
  });

  it("flags stated shipped-pricing for confirmation", () => {
    const result = finalizeExtraction(
      { ...base, priceCents: 45000, shippingIncluded: true, shippingCents: 0 },
      source("$450 shipped obo")
    );
    expect(result.ok && result.extraction.shippingIncluded).toBe(true);
    expect(
      result.ok && result.extraction.needsReview.some((issue) => issue.field === "shipping")
    ).toBe(true);
  });

  it("drops part numbers not present verbatim", () => {
    const invented = finalizeExtraction(
      { ...base, partNumber: "CTS-IT-105" },
      source("FS CTS intake $200")
    );
    expect(invented.ok && invented.extraction.partNumber).toBeUndefined();

    const real = finalizeExtraction(
      { ...base, partNumber: "CTS-IT-105" },
      source("FS CTS intake CTS-IT-105, $200")
    );
    expect(real.ok && real.extraction.partNumber).toBe("CTS-IT-105");
  });

  it("drops locations the post never states", () => {
    const result = finalizeExtraction(
      { ...base, location: "Charlotte, NC" },
      source("FS intake $100 shipped")
    );
    expect(result.ok && result.extraction.location).toBeUndefined();
  });

  it("always flags fitment mentions for seller confirmation", () => {
    const result = finalizeExtraction(
      { ...base, rawFitmentMentions: ["mk7 R", "8V S3"] },
      source("fits mk7 R and 8V S3, $300")
    );
    expect(
      result.ok &&
        result.extraction.needsReview.some(
          (issue) => issue.field === "fitment" && issue.message.includes("mk7 R")
        )
    ).toBe(true);
  });

  it("flags interpreted condition for confirmation", () => {
    const result = finalizeExtraction(
      { ...base, condition: "like_new", priceCents: 10000 },
      source("9/10 condition, $100 obo")
    );
    expect(
      result.ok && result.extraction.needsReview.some((issue) => issue.field === "condition")
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { formatPrice } from "@/lib/marketplace/taxonomy";

import { checkoutTotals, type CheckoutTotalsInput } from "./checkout-totals";

const base: CheckoutTotalsInput = {
  goodsCents: 10_000,
  flatShippingCents: 0,
  quotedLines: 0,
  collection: false,
  selectedQuoteCents: null,
  admittedCents: null,
};

describe("checkoutTotals (RR-10)", () => {
  it("flat shipping is shown and totalled", () => {
    const t = checkoutTotals({ ...base, flatShippingCents: 1_500 });
    expect(t).toEqual({ shipping: formatPrice(1_500), total: formatPrice(11_500), complete: true });
  });

  it("says Free only when shipping really is free", () => {
    expect(checkoutTotals(base)).toEqual({ shipping: "Free", total: formatPrice(10_000), complete: true });
  });

  it("never says Free for a part whose rate depends on the address", () => {
    const t = checkoutTotals({ ...base, quotedLines: 1 });
    expect(t.shipping).toBe("Calculated from your address");
    expect(t.total).toBe(`${formatPrice(10_000)} + shipping`);
    expect(t.complete).toBe(false);
  });

  it("mixed basket before rates: the flat part is known, the rest isn't", () => {
    const t = checkoutTotals({ ...base, flatShippingCents: 800, quotedLines: 1 });
    expect(t.shipping).toBe(`${formatPrice(800)} + rates from your address`);
    expect(t.total).toBe(`${formatPrice(10_800)} + shipping`);
  });

  it("mixed basket after rates: flat plus the selected quote, one total", () => {
    const t = checkoutTotals({ ...base, flatShippingCents: 800, quotedLines: 2, selectedQuoteCents: 2_350 });
    expect(t).toEqual({ shipping: formatPrice(3_150), total: formatPrice(13_150), complete: true });
  });

  it("collecting charges no shipping, as the server does", () => {
    const t = checkoutTotals({ ...base, flatShippingCents: 1_500, quotedLines: 1, collection: true });
    expect(t).toEqual({ shipping: "Collecting — no shipping", total: formatPrice(10_000), complete: true });
  });

  it("once the payment exists, its amount is the total — whatever the estimate said", () => {
    const t = checkoutTotals({ ...base, flatShippingCents: 800, quotedLines: 1, selectedQuoteCents: 999, admittedCents: 11_234 });
    expect(t).toEqual({ shipping: formatPrice(1_234), total: formatPrice(11_234), complete: true });
  });

  it("N485: a price rise between page load and payment is goods, not shipping", () => {
    // The page loaded goods at 10,000; the server reserved them at 12,000
    // with 500 shipping, and charges 12,500.
    const t = checkoutTotals({ ...base, flatShippingCents: 500, admittedCents: 12_500, admittedGoodsCents: 12_000 });
    expect(t).toEqual({ shipping: formatPrice(500), total: formatPrice(12_500), complete: true });
  });
});

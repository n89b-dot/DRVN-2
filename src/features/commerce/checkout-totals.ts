import { formatPrice } from "@/lib/payments/fee";

/**
 * One answer to "what does this checkout cost?" (RR-10).
 *
 * The page's summaries, the review step and the pay button used to work it
 * out separately: the summaries said "Free" for a DRVN-shipped part whose
 * rate wasn't known yet, the review said "Calculated from your address"
 * above a total that already included the chosen rate, and choosing to
 * collect left flat shipping in the pay button's amount although the server
 * charges none for a collected order. Every surface now reads this.
 *
 * Before checkout is admitted the numbers are an estimate built from what
 * the server will charge: goods, flat shipping (zero when collecting), and
 * the selected server-held quote for each DRVN-shipped line. Once the server
 * has created the payment, its amount is the only total shown.
 */
export type CheckoutTotalsInput = {
  goodsCents: number;
  /** Flat per-listing shipping in the basket (DRVN-shipped lines add 0). */
  flatShippingCents: number;
  /** DRVN-shipped lines whose rate depends on the address. */
  quotedLines: number;
  /** The buyer collects in person: the server zeroes every line's shipping. */
  collection: boolean;
  /** Sum of the selected quotes, once rates have been fetched. */
  selectedQuoteCents: number | null;
  /** The amount of the payment the server created, once admitted. */
  admittedCents: number | null;
  /** OS-W17 (N485): the goods in that payment, as the server reserved them.
   *  Without it the split falls back to the page-load goods, and a price
   *  rise in between showed up as "Shipping". */
  admittedGoodsCents?: number | null;
};

export type CheckoutTotals = {
  shipping: string;
  total: string;
  /** False while shipping is still to be worked out from the address. */
  complete: boolean;
};

export function checkoutTotals(input: CheckoutTotalsInput): CheckoutTotals {
  const { goodsCents, flatShippingCents, quotedLines, collection, selectedQuoteCents, admittedCents } = input;

  if (admittedCents != null) {
    const shippingCents = Math.max(0, admittedCents - (input.admittedGoodsCents ?? goodsCents));
    return {
      shipping: collection ? "Collecting — no shipping" : shippingCents > 0 ? formatPrice(shippingCents) : "Free",
      total: formatPrice(admittedCents),
      complete: true,
    };
  }

  if (collection) {
    return { shipping: "Collecting — no shipping", total: formatPrice(goodsCents), complete: true };
  }

  if (quotedLines > 0 && selectedQuoteCents == null) {
    return {
      shipping:
        flatShippingCents > 0
          ? `${formatPrice(flatShippingCents)} + rates from your address`
          : "Calculated from your address",
      total: `${formatPrice(goodsCents + flatShippingCents)} + shipping`,
      complete: false,
    };
  }

  const shippingCents = flatShippingCents + (selectedQuoteCents ?? 0);
  return {
    shipping: shippingCents > 0 ? formatPrice(shippingCents) : "Free",
    total: formatPrice(goodsCents + shippingCents),
    complete: true,
  };
}

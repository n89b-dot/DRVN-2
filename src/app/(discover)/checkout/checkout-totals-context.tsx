"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { checkoutTotals, type CheckoutTotals } from "@/features/commerce/checkout-totals";
import { formatPrice } from "@/lib/payments/fee";

/**
 * The checkout page's summaries (the desktop aside and the phone's collapsed
 * order total) are rendered beside CheckoutSteps, not inside it, so they
 * couldn't see the address-based rate, the collect choice or the payment the
 * server created — and said "Free" while the form said otherwise (RR-10).
 * CheckoutSteps reports those three facts here; every summary derives its
 * numbers from the same `checkoutTotals` the steps use.
 */
type Base = { goodsCents: number; flatShippingCents: number; quotedLines: number };
export type CheckoutLiveTotals = {
  collection: boolean;
  selectedQuoteCents: number | null;
  admittedCents: number | null;
  /** OS-W17 (N485): the goods in the admitted payment, from the server. */
  admittedGoodsCents: number | null;
};

const INITIAL: CheckoutLiveTotals = {
  collection: false,
  selectedQuoteCents: null,
  admittedCents: null,
  admittedGoodsCents: null,
};

const Ctx = createContext<{
  totals: CheckoutTotals;
  /** The goods figure every "Parts" row shows: the admitted payment's once known. */
  goodsCents: number;
  report: (live: CheckoutLiveTotals) => void;
} | null>(null);

export function CheckoutTotalsProvider({ base, children }: { base: Base; children: ReactNode }) {
  const [live, setLive] = useState<CheckoutLiveTotals>(INITIAL);
  const value = useMemo(
    () => ({
      totals: checkoutTotals({ ...base, ...live }),
      goodsCents: live.admittedGoodsCents ?? base.goodsCents,
      report: (next: CheckoutLiveTotals) =>
        setLive((prev) =>
          prev.collection === next.collection &&
          prev.selectedQuoteCents === next.selectedQuoteCents &&
          prev.admittedCents === next.admittedCents &&
          prev.admittedGoodsCents === next.admittedGoodsCents
            ? prev
            : next
        ),
    }),
    [base, live]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** CheckoutSteps calls this with what it knows; a no-op outside the page's
 *  provider (the single-order checkout has no separate summaries). */
export function useReportCheckoutTotals(live: CheckoutLiveTotals) {
  const report = useContext(Ctx)?.report;
  const { collection, selectedQuoteCents, admittedCents, admittedGoodsCents } = live;
  useEffect(() => {
    report?.({ collection, selectedQuoteCents, admittedCents, admittedGoodsCents });
  }, [report, collection, selectedQuoteCents, admittedCents, admittedGoodsCents]);
}

/** The headline amount in the phone's collapsed order summary. */
export function CheckoutHeadlineTotal({ className }: { className?: string }) {
  const totals = useContext(Ctx)?.totals;
  return <b className={className}>{totals?.total}</b>;
}

/** Parts / Shipping / You pay — the summary rows every surface shares. */
export function CheckoutTotalRows({ goodsCents }: { goodsCents: number }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const { totals } = ctx;
  return (
    <>
      <div className="sheet__row">
        <span>Parts</span>
        <b>{formatPrice(ctx.goodsCents ?? goodsCents)}</b>
      </div>
      <div className="sheet__row">
        <span>Shipping</span>
        <b>{totals.shipping}</b>
      </div>
      <div className="sheet__row sheet__total">
        <span>{totals.complete ? "You pay" : "So far"}</span>
        <b>{totals.total}</b>
      </div>
    </>
  );
}

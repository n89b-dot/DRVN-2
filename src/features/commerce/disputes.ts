import type { DisputeCategory } from "@/lib/database.types";

/** The reasons a buyer can open a dispute with, and the clocks a case runs
 *  on (eBay-style; Neil's rulings of 7 Nov 2026, migration 20261107210300).
 *  Lives outside actions.ts because a "use server" file may only export
 *  async functions. The database freezes every clock onto the order; these
 *  constants are for copy and for the pages that show them.
 *
 *  Business days are Monday to Friday (UTC), with no holiday calendar. */

/** The claim window, in calendar days: from delivery for a problem with the
 *  item; for "item never arrived", from the latest delivery date (or the
 *  actual delivery date) frozen at purchase. */
export const DISPUTE_WINDOW_DAYS = 30;

/** Business days the seller has to respond — with tracking, a refund offer
 *  or a return — before either party can ask DRVN to step in. */
export const SELLER_RESPONSE_DAYS = 3;

/** Business days after the report until which either party can escalate. */
export const ESCALATION_CLOSES_DAYS = 21;

/** Hours a seller's refund offer stands. Fixed when it is made; a new offer
 *  gets its own 48 hours and never moves the case's clock. */
export const REFUND_OFFER_HOURS = 48;

/** Days of total seller silence before a dispute auto-refunds (enforced by
 *  src/lib/payments/dispute-sla.ts, which imports this). Paused while an
 *  active return (0055) is the governing resolution path. */
export const AUTO_REFUND_AFTER_DAYS = 10;

export const DISPUTE_CATEGORIES: { value: DisputeCategory; label: string }[] = [
  { value: "item_not_received", label: "Item never arrived" },
  { value: "item_not_as_described", label: "Not as described" },
  { value: "counterfeit", label: "Counterfeit or fake" },
  { value: "does_not_fit", label: "Doesn't fit as listed" },
  { value: "damaged_in_transit", label: "Arrived damaged" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "other", label: "Something else" },
];

/** The categories a buyer can pick at this stage. Before anything has been
 *  dispatched (or, for collection, handed over) the only problem a buyer
 *  can have is that it never arrived. */
export function disputeCategoriesFor(stage: "undispatched" | "dispatched"): typeof DISPUTE_CATEGORIES {
  return stage === "undispatched"
    ? DISPUTE_CATEGORIES.filter((c) => c.value === "item_not_received")
    : DISPUTE_CATEGORIES;
}

/** What open_order_dispute / escalate_order_dispute refusals mean to a member. */
export function disputeRefusalMessage(
  reason: string | undefined,
  detail: { opens_at?: string | null; closed_at?: string | null } = {}
): string {
  const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : null);
  switch (reason) {
    case "not_your_order":
    case "not_party":
      return "That isn't your order.";
    case "invalid_category":
      return "Pick what went wrong.";
    case "already_open":
      return "A dispute is already open on this order.";
    case "resolved_final":
      return "This order's dispute was resolved, and that decision is final. Contact DRVN support if something new has come up.";
    case "seller_gone":
      return "The seller's account is no longer active. Contact DRVN support.";
    case "chargeback_open":
      return "Your bank is handling a dispute on this payment, so DRVN can't open a second one.";
    case "wrong_stage":
      return "This kind of problem can't be reported at this stage of the order.";
    case "no_deadline":
      return "This order has no delivery estimate on record. Contact DRVN support.";
    case "too_early":
      return day(detail.opens_at)
        ? `You can report this from ${day(detail.opens_at)}, once the latest delivery date has passed.`
        : "It's too early to report this.";
    case "window_closed":
      return day(detail.closed_at)
        ? `The window to report this closed on ${day(detail.closed_at)}.`
        : "The window to report this has closed.";
    case "not_disputed":
      return "This order isn't in dispute.";
    case "already_escalated":
      return "This dispute is already with DRVN support.";
    case "offer_pending":
      return "The seller has a refund offer out. Accept it, or wait for it to expire, before escalating.";
    default:
      return "This order changed state. Reload and try again.";
  }
}

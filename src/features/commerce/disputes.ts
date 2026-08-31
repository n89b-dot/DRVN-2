import type { DisputeCategory } from "@/lib/database.types";

/** The reasons a buyer can open a dispute with. Lives outside actions.ts
 *  because a "use server" file may only export async functions. */
/** The claim window: days after confirmed delivery a buyer can still open a
 *  dispute (eBay-style). Undelivered orders carry no deadline — "item never
 *  arrived" has no delivery date to count from. */
export const DISPUTE_WINDOW_DAYS = 30;

/** Days the seller has to respond before the buyer can ask DRVN to step in.
 *  The day-4 cron (0021) escalates automatically one day later. */
export const SELLER_RESPONSE_DAYS = 3;

/** Days of total seller silence before a dispute auto-refunds (enforced by
 *  src/lib/payments/dispute-sla.ts, which imports this). Paused while an
 *  active return (0055) is the governing resolution path. */
export const AUTO_REFUND_AFTER_DAYS = 10;

export const DISPUTE_CATEGORIES: { value: DisputeCategory; label: string }[] = [
  { value: "item_not_received", label: "Item never arrived" },
  { value: "item_not_as_described", label: "Not as described" },
  { value: "damaged_in_transit", label: "Arrived damaged" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "other", label: "Something else" },
];

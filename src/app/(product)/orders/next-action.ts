import type { OrderStatus } from "@/lib/database.types";

/**
 * A product-shaped view of the order state machine, not a dump of every raw
 * status. "Active" is everything still owed something; "Problems" is where an
 * order went sideways. The raw states stay reachable — `?status=<raw>` still
 * filters to exactly one of them — so an operational question doesn't need a
 * database console to answer.
 */
export const STATE_GROUPS = {
  active: ["pending", "requires_action", "paid", "shipped", "delivered"],
  completed: ["completed"],
  problems: ["disputed", "refunded", "cancelled", "payment_failed"],
} as const satisfies Record<string, readonly OrderStatus[]>;

export type StateGroup = keyof typeof STATE_GROUPS;

export const GROUP_LABELS: { key: StateGroup; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "problems", label: "Problems" },
];

export const RAW_STATUSES: OrderStatus[] = [
  "pending",
  "requires_action",
  "payment_failed",
  "paid",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "refunded",
  "disputed",
];

export function isStateGroup(value: string | undefined): value is StateGroup {
  return value === "active" || value === "completed" || value === "problems";
}

export function isRawStatus(value: string | undefined): value is OrderStatus {
  return !!value && (RAW_STATUSES as string[]).includes(value);
}

export type NextActionInput = {
  status: OrderStatus;
  is_collection: boolean;
  tracking_number: string | null;
  /** 0054: seller marked a collection order ready for handoff. Optional so
   *  callers with pre-0054 row shapes keep working. */
  pickup_ready_at?: string | null;
};

/**
 * The one thing this order is waiting on, from this side of it. Everything
 * else on a row or a detail sheet is history; this is the only line that asks
 * for something, so both surfaces read it from here rather than each making
 * up their own wording.
 */
export function nextAction(order: NextActionInput, isSale: boolean): string | null {
  switch (order.status) {
    case "pending":
      return isSale ? "Waiting on the buyer to pay" : "Finish checkout";
    case "requires_action":
      return isSale ? "Buyer's payment needs confirming" : "Your payment needs confirming";
    case "paid":
      if (order.is_collection) {
        if (order.pickup_ready_at) {
          return isSale
            ? "At handoff, scan the buyer's Pickup Pass"
            : "Ready — show your Pickup Pass at handoff";
        }
        return isSale ? "Mark it ready for pickup" : "Waiting on the seller to prepare pickup";
      }
      return isSale ? "Dispatch required" : "Waiting on dispatch";
    case "shipped":
      return isSale
        ? "In transit — waiting on delivery"
        : order.tracking_number
          ? "In transit — confirm when it arrives"
          : "On its way — confirm when it arrives";
    case "delivered":
      return isSale ? "Delivered — payout clearing" : "Delivered — rate the trade";
    case "disputed":
      return isSale ? "Respond to the dispute" : "Dispute open";
    default:
      return null;
  }
}

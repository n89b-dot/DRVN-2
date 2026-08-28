import type {
  ListingImportStatus,
  ListingStatus,
  OfferStatus,
  OrderStatus,
  RefundOperationStatus,
  TransferIntentStatus,
} from "@/lib/database.types";

/**
 * Explicit domain state definitions (brief §AG) — the one readable answer to
 * "which states can reach which states", borrowed in spirit from Vendure's
 * order state machine but deliberately NOT a framework: PostgreSQL's CHECK
 * constraints, column-guard triggers and RPCs remain the authoritative
 * enforcement (0007/0012/0026…). These maps exist for developer clarity, UI
 * state mapping, generated documentation (/docs) and tests — a transition
 * missing here that the database allows is a documentation bug; a transition
 * listed here that the database refuses is a modelling bug. Both fail loudly
 * in states.test.ts's completeness checks.
 *
 * Each entry: every state → the states it may move to (terminal = []).
 */

export type TransitionMap<S extends string> = Record<S, S[]>;

/** Orders (0007 lifecycle + 0014 disputes). `pre_dispute_status` restores the
 *  paused state on resolution, which is why disputed fans back out wide. */
export const ORDER_TRANSITIONS: TransitionMap<OrderStatus> = {
  pending: ["requires_action", "paid", "payment_failed", "cancelled"],
  requires_action: ["paid", "payment_failed", "cancelled"],
  payment_failed: ["cancelled"],
  paid: ["shipped", "cancelled", "refunded", "disputed"],
  shipped: ["delivered", "disputed", "refunded"],
  delivered: ["completed", "disputed", "refunded"],
  completed: ["disputed", "refunded"],
  disputed: ["shipped", "delivered", "completed", "refunded"],
  cancelled: [],
  refunded: [],
};

/** Listings (0001/0012/0018). `removed` is moderation-only in both directions. */
export const LISTING_TRANSITIONS: TransitionMap<ListingStatus> = {
  draft: ["active", "archived"],
  active: ["reserved", "paused", "archived", "removed"],
  reserved: ["active", "sold"],
  paused: ["active", "archived", "removed"],
  sold: [],
  archived: ["active"],
  removed: ["paused"],
};

/** Offers (0007/0012): status is final once it leaves open/countered. */
export const OFFER_TRANSITIONS: TransitionMap<OfferStatus> = {
  open: ["countered", "accepted", "declined", "withdrawn", "expired"],
  countered: ["accepted", "declined", "withdrawn", "expired"],
  accepted: [],
  declined: [],
  withdrawn: [],
  expired: [],
};

/** Transfer intents (0019/0020/0026): the money queue's ladder. */
export const TRANSFER_TRANSITIONS: TransitionMap<TransferIntentStatus> = {
  holding: ["ready", "blocked_unpayable", "cancelled"],
  ready: ["processing", "blocked_unpayable", "cancelled"],
  processing: ["transferred", "ready", "failed", "blocked_unpayable"],
  blocked_unpayable: ["ready", "cancelled"],
  failed: ["ready", "cancelled"],
  transferred: [],
  cancelled: [],
};

/** Refund operations (0026): the durable refund state machine. */
export const REFUND_TRANSITIONS: TransitionMap<RefundOperationStatus> = {
  requested: ["provider_pending", "failed"],
  provider_pending: ["provider_succeeded", "failed", "recovery_required"],
  provider_succeeded: ["effects_pending", "recovery_required"],
  effects_pending: ["reversal_pending", "completed", "recovery_required"],
  reversal_pending: ["completed", "recovery_required"],
  completed: [],
  failed: [],
  recovery_required: [],
};

/** Listing imports (0047): the importer's durable job ladder. `ready` can
 *  fall back to `extracting` (a multi-item re-selection or AI retry), and
 *  `failed` re-enters at the step that broke rather than restarting. */
export const IMPORT_TRANSITIONS: TransitionMap<ListingImportStatus> = {
  pending: ["fetching", "extracting", "failed", "expired"],
  fetching: ["extracting", "failed", "expired"],
  extracting: ["importing_media", "ready", "failed", "expired"],
  importing_media: ["ready", "failed", "expired"],
  ready: ["consumed", "extracting", "expired"],
  failed: ["fetching", "extracting", "expired"],
  consumed: [],
  expired: [],
};

export type DomainName = "order" | "listing" | "offer" | "transfer" | "refund" | "listing_import";

export const DOMAIN_STATES: {
  domain: DomainName;
  title: string;
  authority: string;
  transitions: TransitionMap<string>;
}[] = [
  {
    domain: "order",
    title: "Orders",
    authority: "CHECK constraint (0007) + purchase RPCs + dispute paths (0014/0021)",
    transitions: ORDER_TRANSITIONS,
  },
  {
    domain: "listing",
    title: "Listings",
    authority: "CHECK (0001/0007) + guard_listing_status trigger (0012) + moderation (0018)",
    transitions: LISTING_TRANSITIONS,
  },
  {
    domain: "offer",
    title: "Offers",
    authority: "CHECK + guard_offer_columns trigger (0007/0012)",
    transitions: OFFER_TRANSITIONS,
  },
  {
    domain: "transfer",
    title: "Transfer intents",
    authority: "claim_transfer_intents + worker (0020/0026)",
    transitions: TRANSFER_TRANSITIONS,
  },
  {
    domain: "refund",
    title: "Refund operations",
    authority: "begin/settle_refund_operation RPCs + worker resume (0026)",
    transitions: REFUND_TRANSITIONS,
  },
  {
    domain: "listing_import",
    title: "Listing imports",
    authority: "CHECK + guard_listing_import_status trigger (0047)",
    transitions: IMPORT_TRANSITIONS,
  },
];

/** True when `from → to` is a defined transition in the given map. */
export function canTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
): boolean {
  return map[from]?.includes(to) ?? false;
}

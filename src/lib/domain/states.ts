import type {
  ListingImportStatus,
  ModStatus,
  ListingStatus,
  OfferStatus,
  OrderStatus,
  RefundOperationStatus,
  ReturnStatus,
  ShipmentStatus,
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
  // → sold from active/paused is the seller's "Mark sold" (sold elsewhere,
  // 20260929100000); every other → sold is checkout's.
  active: ["reserved", "paused", "sold", "archived", "removed"],
  reserved: ["active", "sold"],
  paused: ["active", "sold", "archived", "removed"],
  sold: [],
  archived: ["active"],
  removed: ["paused"],
};

/**
 * Offers (0007/0012; negotiation v2, 20261017160000): `open` is the seller's
 * turn, `countered` the buyer's. A buyer's counter-back sends a countered
 * offer back to open; every move is a round in offer_rounds, made through
 * offer_move. Status is final once it leaves open/countered.
 */
export const OFFER_TRANSITIONS: TransitionMap<OfferStatus> = {
  open: ["countered", "accepted", "declined", "withdrawn", "expired"],
  countered: ["open", "accepted", "declined", "withdrawn", "expired"],
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

/** Shipments (0052): parcel movement, outbound or return. Carriers bounce
 *  (out_for_delivery can fall back to in_transit; returned_to_sender can
 *  re-enter transit on a re-attempt); a cancelled/failed label may be
 *  replaced by a new shipment row, never revived. */
export const SHIPMENT_TRANSITIONS: TransitionMap<ShipmentStatus> = {
  pending: ["label_purchased", "in_transit", "cancelled", "failed"],
  label_purchased: [
    "in_transit",
    "out_for_delivery",
    "delivered",
    "returned_to_sender",
    "cancelled",
    "failed",
  ],
  in_transit: ["out_for_delivery", "delivered", "returned_to_sender", "failed"],
  out_for_delivery: ["delivered", "in_transit", "returned_to_sender", "failed"],
  returned_to_sender: ["in_transit"],
  delivered: [],
  cancelled: [],
  failed: [],
};

/** Returns / RMAs (0055): goods moving back. `escalated` is the §29
 *  inspection-dispute detour into ops cases — an admin settles it back onto
 *  the ladder or terminates it. */
export const RETURN_TRANSITIONS: TransitionMap<ReturnStatus> = {
  requested: ["approved", "rejected", "cancelled", "escalated"],
  approved: ["awaiting_shipment", "expired", "cancelled", "escalated"],
  awaiting_shipment: ["in_transit", "expired", "cancelled", "escalated"],
  in_transit: ["delivered", "escalated"],
  delivered: ["received", "escalated"],
  received: ["completed", "escalated"],
  escalated: ["received", "completed", "rejected", "cancelled"],
  completed: [],
  rejected: [],
  expired: [],
  cancelled: [],
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

/**
 * Modification lines (20260919170000). Two states and both directions: a part
 * comes off the car, and occasionally goes back on. The pair is deliberately
 * small — "removed" is a state, not a delete, so the record survives to be
 * the provenance behind a listing. A true delete is not a state at all: the
 * row is omitted from the sheet and `save_mod_items` drops it.
 */
export const MOD_ITEM_TRANSITIONS: TransitionMap<ModStatus> = {
  installed: ["removed"],
  removed: ["installed"],
};

/** Agent tasks (A2, 20261021100000): what the agent is trying to do for its
 *  owner. guard_agent_task_status refuses any move out of a finished state;
 *  the agent functions and the outbox trigger make the rest. */
export type AgentTaskStatus =
  | "working"
  | "waiting_for_event"
  | "needs_approval"
  | "completed"
  | "failed"
  | "cancelled";

export const AGENT_TASK_TRANSITIONS: TransitionMap<AgentTaskStatus> = {
  working: ["waiting_for_event", "needs_approval", "completed", "failed", "cancelled"],
  waiting_for_event: ["working", "needs_approval", "completed", "failed", "cancelled"],
  needs_approval: ["working", "waiting_for_event", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

/** Agent mandates (A2): the owner pauses, resumes or turns it off; a sale,
 *  a finished offer or expiry ends it. guard_agent_mandate_status. */
export type AgentMandateStatus = "active" | "paused" | "revoked" | "ended";

export const AGENT_MANDATE_TRANSITIONS: TransitionMap<AgentMandateStatus> = {
  active: ["paused", "revoked", "ended"],
  paused: ["active", "revoked", "ended"],
  revoked: [],
  ended: [],
};

/** Agent jobs (A2): the outbox the worker leases. A lost lease goes back to
 *  pending until max_attempts, then dead; a later round cancels it. */
export type AgentJobStatus = "pending" | "leased" | "done" | "failed" | "cancelled" | "dead";

export const AGENT_JOB_TRANSITIONS: TransitionMap<AgentJobStatus> = {
  pending: ["leased", "cancelled"],
  leased: ["pending", "done", "failed", "cancelled", "dead"],
  done: [],
  failed: [],
  cancelled: [],
  dead: [],
};

export type DomainName =
  | "mod_item"
  | "order"
  | "listing"
  | "offer"
  | "transfer"
  | "refund"
  | "shipment"
  | "return"
  | "listing_import"
  | "agent_task"
  | "agent_mandate"
  | "agent_job";

export const DOMAIN_STATES: {
  domain: DomainName;
  title: string;
  authority: string;
  transitions: TransitionMap<string>;
  /**
   * True when the domain is a toggle rather than a lifecycle ladder, and so
   * genuinely has no terminal state. Only `mod_item` is one: a part can come
   * off a car and go back on it indefinitely, and the way a modification line
   * really ends is not a state at all — the row is omitted from the sheet and
   * deleted. Declaring this is deliberate; the completeness test still
   * demands a terminal state from everything else.
   */
  cyclic?: true;
}[] = [
  {
    domain: "mod_item",
    title: "Modification lines",
    authority:
      "CHECK constraints mod_items_status_check + mod_items_removed_at_agrees_check (20260919170000); removed_at derived by save_mod_items",
    transitions: MOD_ITEM_TRANSITIONS,
    cyclic: true,
  },
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
    domain: "shipment",
    title: "Shipments",
    authority: "CHECK + guard_shipment_status trigger (0052)",
    transitions: SHIPMENT_TRANSITIONS,
  },
  {
    domain: "return",
    title: "Returns (RMA)",
    authority: "CHECK + guard_return_status trigger (0055)",
    transitions: RETURN_TRANSITIONS,
  },
  {
    domain: "listing_import",
    title: "Listing imports",
    authority: "CHECK + guard_listing_import_status trigger (0047)",
    transitions: IMPORT_TRANSITIONS,
  },
  {
    domain: "agent_task",
    title: "Agent tasks",
    authority:
      "CHECK + guard_agent_task_status trigger (20261021100000); agent_* functions and the offer_rounds outbox trigger (20261021100100)",
    transitions: AGENT_TASK_TRANSITIONS,
  },
  {
    domain: "agent_mandate",
    title: "Agent mandates",
    authority: "CHECK + guard_agent_mandate_status trigger (20261021100000); agent_mandate_set_status (20261021100100)",
    transitions: AGENT_MANDATE_TRANSITIONS,
  },
  {
    domain: "agent_job",
    title: "Agent jobs (outbox)",
    authority: "CHECK (20261021100000); agent_claim_jobs / agent_finish_job / agent_reconcile_outbox (20261021100100)",
    transitions: AGENT_JOB_TRANSITIONS,
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

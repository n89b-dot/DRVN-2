/**
 * Rules decide money (AG-5, agent-foundations.md §3). This is the whole of
 * how the agent picks a price: a pure function of the owner's limits, the
 * listing and the offer history. No model, no clock beyond the one passed
 * in, no I/O — the same input always gives the same decision, which is what
 * the simulations and property tests rely on.
 *
 * The rules mirror negotiation v2 (docs/decisions/negotiation-v2.md): a
 * seller's counter is above the buyer's amount, at most the asking price and
 * at least the effective floor; a buyer's counter-back is above their own
 * last and below the seller's counter; a buyer has 3 offers per listing; the
 * seller's agent never accepts (no auto-accept at launch), and the buyer's
 * agent accepts a counter within its ceiling (ruling 10). The database checks
 * every one of these again; a decision here can only ever be refused there.
 *
 * Reasons are codes, not sentences: the model may put them into words for the
 * owner later, and they never carry a limit.
 */

export type NegotiationStyle = "firm" | "balanced" | "flexible";

export type OfferState = {
  status: "open" | "countered" | "accepted" | "declined" | "withdrawn" | "expired";
  /** The buyer's latest amount. */
  amountCents: number;
  /** The seller's live counter, when it's the buyer's turn. */
  counterAmountCents: number | null;
  roundCount: number;
  expiresAt?: string | null;
};

export type RoundView = {
  roundNo: number;
  actorRole: "buyer" | "seller" | "system";
  kind: string;
  amountCents: number | null;
};

export type NegotiationInput = {
  scope: "seller" | "buyer";
  style: NegotiationStyle;
  listing: { priceCents: number; shippingCents: number; status: string };
  /** Seller: floorCents (the effective floor) and targetCents. Buyer: ceilingCents, its basis, and an optional targetCents to open at. */
  limits: {
    floorCents?: number | null;
    targetCents?: number | null;
    ceilingCents?: number | null;
    ceilingBasis?: "item" | "total" | null;
  };
  /** Null when the buyer's agent has no live offer yet. */
  offer: OfferState | null;
  /** This offer's rounds, oldest first. */
  rounds: RoundView[];
  /** Every amount this buyer has offered on this listing, across threads (it counts against 3). */
  buyerAmounts: number[];
  /** Milliseconds since epoch; defaults to the offer never having expired. */
  now?: number;
};

export type HoldReason =
  | "not_my_turn"
  | "settled"
  | "expired"
  | "listing_unavailable"
  | "limits_missing"
  | "limits_conflict"
  | "no_offers_left"
  | "at_limit";

export type ApprovalReason =
  | "meets_target"
  | "close_to_limit"
  | "final_offer_clears_minimum"
  | "over_ceiling"
  | "over_ceiling_no_offers_left";

export type Decision =
  | { action: "counter"; amountCents: number; reason: "concession" | "final_counter" }
  | { action: "accept"; reason: "within_ceiling" }
  | { action: "open"; amountCents: number; reason: "opening" | "reopening" }
  | { action: "request_approval"; reason: ApprovalReason }
  | { action: "hold"; reason: HoldReason };

export const MAX_BUYER_OFFERS = 3;
/** Every amount the agent proposes is a whole dollar. */
export const STEP_CENTS = 100;

/** How much of the remaining gap each counter gives up, by style. */
const SELLER_CONCESSION: Record<NegotiationStyle, number> = { firm: 0.25, balanced: 0.5, flexible: 0.75 };
/** The last counter, when the buyer has no offers left: the one they can only take or leave. */
const SELLER_FINAL_CONCESSION: Record<NegotiationStyle, number> = { firm: 0.5, balanced: 0.75, flexible: 0.9 };
const BUYER_CONCESSION: Record<NegotiationStyle, number> = { firm: 0.25, balanced: 0.4, flexible: 0.6 };
/** Where a buyer opens, as a share of the asking price (or of its own max, if lower). */
const BUYER_OPENING: Record<NegotiationStyle, number> = { firm: 0.6, balanced: 0.7, flexible: 0.8 };

function floorToStep(cents: number) {
  return Math.floor(cents / STEP_CENTS) * STEP_CENTS;
}

function ceilToStep(cents: number) {
  return Math.ceil(cents / STEP_CENTS) * STEP_CENTS;
}

function validAmount(cents: number | null | undefined): cents is number {
  return typeof cents === "number" && Number.isInteger(cents) && cents > 0;
}

export function negotiate(input: NegotiationInput): Decision {
  const { listing, offer } = input;
  if (!validAmount(listing.priceCents)) return { action: "hold", reason: "listing_unavailable" };
  if (offer && offer.status !== "open" && offer.status !== "countered") return { action: "hold", reason: "settled" };
  if (listing.status !== "active") return { action: "hold", reason: "listing_unavailable" };
  if (offer?.expiresAt && input.now !== undefined && Date.parse(offer.expiresAt) <= input.now) {
    return { action: "hold", reason: "expired" };
  }
  return input.scope === "seller" ? sellerDecision(input) : buyerDecision(input);
}

function sellerDecision(input: NegotiationInput): Decision {
  const { listing, offer, limits, rounds, style } = input;
  if (!offer) return { action: "hold", reason: "not_my_turn" };
  if (offer.status !== "open") return { action: "hold", reason: "not_my_turn" };
  const floor = limits.floorCents;
  if (!validAmount(floor)) return { action: "hold", reason: "limits_missing" };
  const price = listing.priceCents;
  if (floor > price) return { action: "hold", reason: "limits_conflict" };

  const target = Math.min(Math.max(validAmount(limits.targetCents) ? limits.targetCents : price, floor), price);
  const buyer = offer.amountCents;
  // The agent can't accept; at or past the target, the owner decides.
  if (buyer >= target) return { action: "request_approval", reason: "meets_target" };

  const sellerCounters = rounds.filter((r) => r.actorRole === "seller" && r.kind === "counter" && validAmount(r.amountCents));
  const previous = sellerCounters.length ? sellerCounters[sellerCounters.length - 1].amountCents! : price;
  const ceiling = Math.min(price, previous);
  const lowest = Math.max(floor, buyer + STEP_CENTS);
  // Nothing left between the buyer's amount and what the seller would take.
  if (lowest > ceiling) return { action: "request_approval", reason: "close_to_limit" };

  const offersLeft = MAX_BUYER_OFFERS - input.buyerAmounts.length;
  const final = offersLeft <= 0;
  // The buyer's last word clears the minimum: taking it is the owner's call.
  if (final && buyer >= floor) return { action: "request_approval", reason: "final_offer_clears_minimum" };
  // Each counter gives up a share of what's left between the last counter
  // (the target, at first) and the most the buyer has offered.
  const from = Math.min(sellerCounters.length ? previous : target, ceiling);
  const share = final ? SELLER_FINAL_CONCESSION[style] : SELLER_CONCESSION[style] / (sellerCounters.length ? 1 : 2);
  const raw = from - (from - Math.max(floor, buyer)) * share;
  const amount = Math.min(Math.max(ceilToStep(raw), lowest), ceiling);
  return { action: "counter", amountCents: amount, reason: final ? "final_counter" : "concession" };
}

function buyerDecision(input: NegotiationInput): Decision {
  const { listing, offer, limits, style, buyerAmounts } = input;
  const ceiling = limits.ceilingCents;
  if (!validAmount(ceiling)) return { action: "hold", reason: "limits_missing" };
  // The most the item itself may cost: "total up to" counts shipping.
  const itemMax = Math.min(listing.priceCents, ceiling - (limits.ceilingBasis === "total" ? listing.shippingCents : 0));
  if (itemMax < STEP_CENTS) return { action: "hold", reason: "limits_conflict" };
  const used = buyerAmounts.length;

  if (!offer) {
    if (used >= MAX_BUYER_OFFERS) return { action: "hold", reason: "no_offers_left" };
    const last = used ? Math.max(...buyerAmounts) : 0;
    const opening = validAmount(limits.targetCents)
      ? Math.min(limits.targetCents, itemMax)
      : floorToStep(Math.min(listing.priceCents * BUYER_OPENING[style], itemMax));
    // After a decline the minimum is somewhere above the last attempt: go
    // halfway to the max, and offer the max itself with the last one.
    const raised = !used ? 0 : used === MAX_BUYER_OFFERS - 1 ? itemMax : floorToStep(last + (itemMax - last) / 2);
    const amount = Math.min(Math.max(opening, raised, STEP_CENTS), itemMax);
    if (amount <= last) return { action: "hold", reason: "at_limit" };
    return { action: "open", amountCents: amount, reason: used ? "reopening" : "opening" };
  }

  if (offer.status !== "countered" || !validAmount(offer.counterAmountCents)) return { action: "hold", reason: "not_my_turn" };
  const counter = offer.counterAmountCents;
  if (counter <= itemMax) return { action: "accept", reason: "within_ceiling" };
  if (used >= MAX_BUYER_OFFERS) return { action: "request_approval", reason: "over_ceiling_no_offers_left" };

  const own = offer.amountCents;
  // A share of the way to the lower of the counter and the max; the last of
  // the 3 is the most this owner will pay.
  const last = used + 1 >= MAX_BUYER_OFFERS;
  const raw = last ? itemMax : own + (Math.min(counter, itemMax) - own) * BUYER_CONCESSION[style];
  const amount = Math.min(floorToStep(raw), itemMax, counter - STEP_CENTS);
  if (amount <= own) return { action: "request_approval", reason: "over_ceiling" };
  return { action: "counter", amountCents: amount, reason: used + 1 >= MAX_BUYER_OFFERS ? "final_counter" : "concession" };
}

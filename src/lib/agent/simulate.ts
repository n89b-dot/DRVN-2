/**
 * Deterministic negotiation simulations (A2 gate): a seller's agent against a
 * person, a buyer's agent against a person, and agent against agent, before
 * any member sees an agent. The market below enforces the negotiation v2 rules
 * the way offer_open / offer_move do (docs/decisions/negotiation-v2.md §2) and
 * throws on any illegal move, so a simulation that finishes is a negotiation
 * the database would also have accepted. The database-backed run of the same
 * policies, through the real worker role, is tests/operations/agent-worker.test.ts.
 *
 * Everything is seeded: the same seed gives the same transcript.
 */

import { MAX_BUYER_OFFERS, negotiate, type Decision, type NegotiationInput, type NegotiationStyle, type OfferState, type RoundView } from "./negotiate";

/** mulberry32: small, fast, and the same everywhere. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class IllegalMove extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export type Move =
  | { kind: "offer"; amountCents: number }
  | { kind: "counter"; amountCents: number }
  | { kind: "accept" }
  | { kind: "decline" }
  | { kind: "withdraw" }
  | { kind: "wait" };

export type Side = "buyer" | "seller";

export type Listing = { priceCents: number; shippingCents: number; floorCents: number | null };

/** One listing, one buyer: the rules offer_open / offer_move enforce. */
export class Market {
  readonly rounds: (RoundView & { by: "agent" | "person" })[] = [];
  readonly buyerAmounts: number[] = [];
  offer: OfferState | null = null;
  status: "active" | "reserved" = "active";
  soldAtCents: number | null = null;

  constructor(readonly listing: Listing, private readonly agentFloorCents: number | null = null) {}

  /** The effective floor: the higher of the listing's and the agent's minimum. */
  get effectiveFloor() {
    const floors = [this.listing.floorCents, this.agentFloorCents].filter((v): v is number => v !== null);
    return floors.length ? Math.max(...floors) : null;
  }

  turn(): Side | null {
    if (this.status !== "active") return null;
    if (!this.offer || !["open", "countered"].includes(this.offer.status)) {
      return this.buyerAmounts.length < MAX_BUYER_OFFERS ? "buyer" : null;
    }
    return this.offer.status === "open" ? "seller" : "buyer";
  }

  private record(actorRole: Side, kind: string, amountCents: number | null, by: "agent" | "person") {
    this.rounds.push({ roundNo: this.rounds.length + 1, actorRole, kind, amountCents, by });
    if (this.offer) this.offer.roundCount = this.rounds.length;
  }

  apply(side: Side, move: Move, by: "agent" | "person") {
    if (move.kind === "wait") return;
    const live = this.offer && ["open", "countered"].includes(this.offer.status);
    const fail = (code: string, why: string): never => { throw new IllegalMove(code, `${side} ${move.kind}: ${why}`); };
    if (this.status !== "active") fail("OF007", "listing not available");
    if (move.kind === "offer") {
      if (side !== "buyer") fail("42501", "only buyers open");
      if (live) fail("23505", "already a live offer");
      if (this.buyerAmounts.length >= MAX_BUYER_OFFERS) fail("OF001", "no offers left");
      if (move.amountCents <= 0 || move.amountCents > this.listing.priceCents) fail("OF004", "out of bounds");
      this.buyerAmounts.push(move.amountCents);
      const floor = this.effectiveFloor;
      this.offer = { status: floor !== null && move.amountCents < floor ? "declined" : "open", amountCents: move.amountCents, counterAmountCents: null, roundCount: 0 };
      this.rounds.length = 0;
      this.record("buyer", this.offer.status === "declined" ? "below_minimum" : "offer", move.amountCents, by);
      return;
    }
    if (!live || !this.offer) return fail("OF005", "no live offer");
    const offer = this.offer;
    const turn = offer.status === "open" ? "seller" : "buyer";
    if (move.kind === "withdraw") {
      if (side !== "buyer") fail("42501", "only the buyer withdraws");
      offer.status = "withdrawn";
      return this.record(side, "withdraw", null, by);
    }
    if (move.kind === "decline") {
      if (side !== "seller") fail("42501", "only the seller declines");
      offer.status = "declined";
      return this.record(side, "decline", null, by);
    }
    if (side !== turn) fail("OF002", "not your turn");
    if (move.kind === "accept") {
      const amount = side === "seller" ? offer.amountCents : offer.counterAmountCents!;
      offer.status = "accepted";
      this.status = "reserved";
      this.soldAtCents = amount;
      return this.record(side, "accept", amount, by);
    }
    const floor = this.effectiveFloor;
    if (side === "seller") {
      if (move.amountCents <= offer.amountCents || move.amountCents > this.listing.priceCents || (floor !== null && move.amountCents < floor)) {
        fail("OF004", `seller counter ${move.amountCents} out of bounds`);
      }
      offer.status = "countered";
      offer.counterAmountCents = move.amountCents;
      return this.record(side, "counter", move.amountCents, by);
    }
    if (move.amountCents <= offer.amountCents || move.amountCents >= offer.counterAmountCents!) fail("OF004", "buyer counter out of bounds");
    if (this.buyerAmounts.length >= MAX_BUYER_OFFERS) fail("OF001", "no offers left");
    this.buyerAmounts.push(move.amountCents);
    offer.amountCents = move.amountCents;
    offer.counterAmountCents = null;
    if (floor !== null && move.amountCents < floor) {
      offer.status = "declined";
      return this.record(side, "below_minimum", move.amountCents, by);
    }
    offer.status = "open";
    return this.record(side, "counter", move.amountCents, by);
  }
}

export type AgentPolicy = {
  kind: "agent";
  style: NegotiationStyle;
  /** Seller: the agent's minimum and target. Buyer: the ceiling and its basis. */
  minimumCents?: number | null;
  targetCents?: number | null;
  ceilingCents?: number;
  ceilingBasis?: "item" | "total";
};

/** A person, as a deterministic strategy over the market and a random stream. */
export type PersonPolicy = { kind: "person"; name: string; act: (market: Market, side: Side, rand: () => number) => Move };

export type Policy = AgentPolicy | PersonPolicy;

export type Outcome = {
  result: "sold" | "no_deal";
  priceCents: number | null;
  moves: number;
  transcript: string[];
  /** Approvals the agent asked its owner for, and what they were about. */
  approvals: { side: Side; reason: string }[];
  /** Every agent decision, in order. */
  decisions: { side: Side; decision: Decision }[];
};

function agentInput(market: Market, side: Side, policy: AgentPolicy): NegotiationInput {
  return {
    scope: side,
    style: policy.style,
    listing: { priceCents: market.listing.priceCents, shippingCents: market.listing.shippingCents, status: market.status },
    limits: side === "seller"
      ? { floorCents: market.effectiveFloor, targetCents: policy.targetCents ?? null }
      : { ceilingCents: policy.ceilingCents ?? null, ceilingBasis: policy.ceilingBasis ?? "item", targetCents: policy.targetCents ?? null },
    offer: market.offer && ["open", "countered"].includes(market.offer.status) ? { ...market.offer } : null,
    rounds: market.rounds.map(({ roundNo, actorRole, kind, amountCents }) => ({ roundNo, actorRole, kind, amountCents })),
    buyerAmounts: [...market.buyerAmounts],
  };
}

function agentMove(decision: Decision): Move {
  switch (decision.action) {
    case "counter": return { kind: "counter", amountCents: decision.amountCents };
    case "open": return { kind: "offer", amountCents: decision.amountCents };
    case "accept": return { kind: "accept" };
    default: return { kind: "wait" };
  }
}

/**
 * Run one negotiation to its end. An agent that asks for approval is answered
 * by `ownerApproves` (default: the owner says no, so the agent's side waits
 * and the offer lapses).
 */
export function simulate(options: {
  listing: Listing;
  seller: Policy;
  buyer: Policy;
  seed: number;
  ownerApproves?: (side: Side, reason: string) => boolean;
  maxMoves?: number;
}): Outcome {
  const rand = seededRandom(options.seed);
  const agentFloor = options.seller.kind === "agent" ? options.seller.minimumCents ?? null : null;
  const market = new Market(options.listing, agentFloor);
  const transcript: string[] = [];
  const approvals: Outcome["approvals"] = [];
  const decisions: Outcome["decisions"] = [];
  const maxMoves = options.maxMoves ?? 20;
  let moves = 0;
  let idle = 0;
  while (moves < maxMoves && idle < 2) {
    const side = market.turn();
    if (!side) break;
    const policy = side === "seller" ? options.seller : options.buyer;
    let move: Move;
    let by: "agent" | "person";
    if (policy.kind === "agent") {
      const decision = negotiate(agentInput(market, side, policy));
      decisions.push({ side, decision });
      by = "agent";
      move = agentMove(decision);
      if (decision.action === "request_approval") {
        // Asked once per turn: a repeat while waiting is the same card.
        if (idle === 0) approvals.push({ side, reason: decision.reason });
        // The owner, not the agent, accepts.
        if (options.ownerApproves?.(side, decision.reason)) { move = { kind: "accept" }; by = "person"; }
      }
    } else {
      move = policy.act(market, side, rand);
      by = "person";
    }
    if (move.kind === "wait") { idle++; transcript.push(`${side} (${by}) waits`); continue; }
    idle = 0;
    market.apply(side, move, by);
    moves++;
    transcript.push(`${side} (${by}) ${move.kind}${"amountCents" in move ? ` ${move.amountCents}` : ""}`);
  }
  return {
    result: market.soldAtCents !== null ? "sold" : "no_deal",
    priceCents: market.soldAtCents,
    moves,
    transcript,
    approvals,
    decisions,
  };
}

// ---------------------------------------------------------------------------
// People: the counterparties the agent has to cope with.
// ---------------------------------------------------------------------------

const dollars = (cents: number) => Math.round(cents / 100) * 100;

/** A buyer who opens low and creeps up toward a private budget, then takes any counter within it. */
export function haggler(budgetCents: number, openShare = 0.5): PersonPolicy {
  return {
    kind: "person",
    name: `haggler(${budgetCents})`,
    act(market) {
      const offer = market.offer;
      if (!offer || !["open", "countered"].includes(offer.status)) {
        const last = Math.max(0, ...market.buyerAmounts);
        // Declined at once: try halfway to the budget.
        const next = last ? dollars(last + (budgetCents - last) / 2) : dollars(market.listing.priceCents * openShare);
        const amount = Math.min(budgetCents, Math.max(next, last + 100), market.listing.priceCents);
        return amount > last ? { kind: "offer", amountCents: amount } : { kind: "wait" };
      }
      const counter = offer.counterAmountCents!;
      if (counter <= budgetCents) return { kind: "accept" };
      if (market.buyerAmounts.length >= MAX_BUYER_OFFERS) return { kind: "wait" };
      const next = Math.min(budgetCents, dollars((offer.amountCents + counter) / 2), counter - 100);
      return next > offer.amountCents ? { kind: "counter", amountCents: next } : { kind: "wait" };
    },
  };
}

/** A buyer who makes one offer and walks away from any counter. */
export function oneShot(amountShare: number): PersonPolicy {
  return {
    kind: "person",
    name: `oneShot(${amountShare})`,
    act(market) {
      if (!market.offer) return { kind: "offer", amountCents: dollars(market.listing.priceCents * amountShare) };
      return market.offer.status === "countered" ? { kind: "withdraw" } : { kind: "wait" };
    },
  };
}

/** A buyer who probes the minimum: three quick lowballs. */
export function prober(): PersonPolicy {
  return {
    kind: "person",
    name: "prober",
    act(market, _side, rand) {
      if (market.offer && market.offer.status === "countered") return { kind: "withdraw" };
      if (market.offer && market.offer.status === "open") return { kind: "wait" };
      const amount = dollars(market.listing.priceCents * (0.2 + 0.1 * market.buyerAmounts.length + rand() * 0.05));
      return { kind: "offer", amountCents: Math.max(100, amount) };
    },
  };
}

/** A seller who splits the difference down to their own floor, and accepts at or above a target. */
export function splitter(targetCents: number, floorCents: number): PersonPolicy {
  return {
    kind: "person",
    name: `splitter(${targetCents},${floorCents})`,
    act(market) {
      const offer = market.offer;
      if (!offer || offer.status !== "open") return { kind: "wait" };
      if (offer.amountCents >= targetCents) return { kind: "accept" };
      const previous = market.rounds.filter((r) => r.actorRole === "seller" && r.kind === "counter").at(-1)?.amountCents ?? market.listing.priceCents;
      const counter = Math.max(floorCents, dollars((offer.amountCents + previous) / 2), offer.amountCents + 100);
      if (counter > Math.min(previous, market.listing.priceCents)) return offer.amountCents >= floorCents ? { kind: "accept" } : { kind: "decline" };
      return { kind: "counter", amountCents: counter };
    },
  };
}

/** A seller who never negotiates: accepts the asking price, declines anything else. */
export function firmSeller(): PersonPolicy {
  return {
    kind: "person",
    name: "firmSeller",
    act(market) {
      const offer = market.offer;
      if (!offer || offer.status !== "open") return { kind: "wait" };
      return offer.amountCents >= market.listing.priceCents ? { kind: "accept" } : { kind: "decline" };
    },
  };
}

import { expect, it } from "vitest";

import { offerHistoryFromRounds, type OfferRound } from "./offer-history";

const at = (h: number) => new Date(Date.UTC(2026, 9, 17, h)).toISOString();
const rounds: OfferRound[] = [
  { round_no: 3, actor_role: "buyer", kind: "accept", amount_cents: 52000, created_at: at(3) },
  { round_no: 1, actor_role: "buyer", kind: "offer", amount_cents: 40000, created_at: at(1) },
  { round_no: 2, actor_role: "seller", kind: "counter", amount_cents: 52000, created_at: at(2) },
];

it("reads the rounds oldest first, from the seller's side, by role", () => {
  expect(offerHistoryFromRounds(rounds, { incoming: true })).toEqual([
    { label: "Buyer made an offer", at: at(1), amount: 40000 },
    { label: "You countered", at: at(2), amount: 52000 },
    { label: "Buyer accepted the counter", at: at(3) },
  ]);
});

it("reads the same rounds from the buyer's side", () => {
  expect(offerHistoryFromRounds(rounds, { incoming: false }).map((e) => e.label)).toEqual([
    "You made an offer",
    "Seller countered",
    "You accepted the counter",
  ]);
});

it("names who ended it, and never tells the buyer a minimum", () => {
  const ended: OfferRound[] = [
    { round_no: 1, actor_role: "buyer", kind: "below_minimum", amount_cents: 9000, created_at: at(1) },
    { round_no: 2, actor_role: "system", kind: "expire", amount_cents: null, created_at: at(2) },
  ];
  expect(offerHistoryFromRounds(ended, { incoming: true }).map((e) => e.label)).toEqual([
    "Declined automatically: below your minimum",
    "Offer expired unanswered",
  ]);
  expect(offerHistoryFromRounds(ended, { incoming: false })[0].label).toBe("Declined");
});

// The A3 design's negotiation (docs/design/agent-a3 04): agents on both sides.
const agents: OfferRound[] = [
  { round_no: 1, actor_role: "buyer", kind: "offer", amount_cents: 23200, created_at: at(1), actor_task_id: "b" },
  { round_no: 2, actor_role: "seller", kind: "counter", amount_cents: 24500, created_at: at(1), actor_task_id: "s" },
  { round_no: 3, actor_role: "buyer", kind: "counter", amount_cents: 23600, created_at: at(2), actor_task_id: "b" },
  { round_no: 4, actor_role: "seller", kind: "counter", amount_cents: 24100, created_at: at(2), actor_task_id: "s" },
  { round_no: 5, actor_role: "buyer", kind: "counter", amount_cents: 23900, created_at: at(3) },
  { round_no: 6, actor_role: "seller", kind: "accept", amount_cents: null, created_at: at(4) },
];
const mandate = { minimumCents: 23000, targetCents: 24500, style: "balanced" as const };

it("says who acted, marks agent turns, and explains only the seller's own agent", () => {
  const seller = offerHistoryFromRounds(agents, { incoming: true, mandate });
  expect(seller.map((e) => e.label)).toEqual([
    "Buyer's agent made an offer",
    "Your agent countered",
    "Buyer's agent countered",
    "Your agent countered",
    "Buyer countered — offer 3 of 3",
    "You accepted",
  ]);
  expect(seller.map((e) => Boolean(e.viaAgent))).toEqual([true, true, true, true, false, false]);
  expect(seller[1].reason).toBe("Opened at your $245 target. Their $232 is $2 above your minimum.");
  expect(seller[3].reason).toBe("Gave ground $4 from $245: Balanced moves about half the gap each round.");
  expect(seller.filter((e) => e.reason)).toHaveLength(2);
});

it("never shows the buyer the seller agent's reasons, or the minimum behind them", () => {
  const buyer = offerHistoryFromRounds(agents, { incoming: false, mandate });
  expect(buyer.some((e) => e.reason)).toBe(false);
  expect(buyer[1]).toMatchObject({ label: "Seller's agent countered", viaAgent: true });
});

it("calls a counter at the minimum the final one", () => {
  const atFloor: OfferRound[] = [
    { round_no: 1, actor_role: "buyer", kind: "offer", amount_cents: 20000, created_at: at(1) },
    { round_no: 2, actor_role: "seller", kind: "counter", amount_cents: 24500, created_at: at(1), actor_task_id: "s" },
    { round_no: 3, actor_role: "buyer", kind: "counter", amount_cents: 21000, created_at: at(2) },
    { round_no: 4, actor_role: "seller", kind: "counter", amount_cents: 23000, created_at: at(2), actor_task_id: "s" },
  ];
  expect(offerHistoryFromRounds(atFloor, { incoming: true, mandate })[3].reason).toBe("Final counter at your $230 minimum.");
});

// OS-W33 follow-up (20261108110100): withdraw_listing records a system
// 'withdraw' round, so the rounds — not the offer row — are what the offer
// page renders. That round is the seller withdrawing the listing, never the
// buyer withdrawing the offer.
it("reads a listing withdrawal as the seller's, from both sides", () => {
  const withdrawn: OfferRound[] = [
    { round_no: 1, actor_role: "buyer", kind: "offer", amount_cents: 40000, created_at: at(1) },
    { round_no: 2, actor_role: "system", kind: "withdraw", amount_cents: null, created_at: at(2) },
  ];
  const seller = offerHistoryFromRounds(withdrawn, { incoming: true, endedReason: "listing_withdrawn" }).map((e) => e.label);
  const buyer = offerHistoryFromRounds(withdrawn, { incoming: false, endedReason: "listing_withdrawn" }).map((e) => e.label);
  expect(seller).toEqual(["Buyer made an offer", "You withdrew the listing, so the offer ended"]);
  expect(buyer).toEqual(["You made an offer", "The seller withdrew this listing, so the offer ended"]);
  expect([...seller, ...buyer].some((label) => /withdrew the offer/.test(label))).toBe(false);
  // A buyer's own withdrawal still reads as theirs.
  const own: OfferRound[] = [{ round_no: 1, actor_role: "buyer", kind: "withdraw", amount_cents: null, created_at: at(1) }];
  expect(offerHistoryFromRounds(own, { incoming: true })[0].label).toBe("Buyer withdrew the offer");
});

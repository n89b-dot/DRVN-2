import { expect, it } from "vitest";

import { offerHistoryFromRounds, type OfferRound } from "./offer-history";

const at = (h: number) => new Date(Date.UTC(2026, 9, 17, h)).toISOString();
const rounds: OfferRound[] = [
  { round_no: 3, actor_role: "buyer", kind: "accept", amount_cents: 52000, created_at: at(3) },
  { round_no: 1, actor_role: "buyer", kind: "offer", amount_cents: 40000, created_at: at(1) },
  { round_no: 2, actor_role: "seller", kind: "counter", amount_cents: 52000, created_at: at(2) },
];

it("reads the rounds oldest first, from the seller's side", () => {
  expect(offerHistoryFromRounds(rounds, { incoming: true, counterpartyName: "Kaito" })).toEqual([
    { label: "Kaito made an offer", at: at(1), amount: 40000 },
    { label: "You countered", at: at(2), amount: 52000 },
    { label: "Kaito accepted the counter", at: at(3) },
  ]);
});

it("reads the same rounds from the buyer's side", () => {
  expect(offerHistoryFromRounds(rounds, { incoming: false, counterpartyName: "Marisol" }).map((e) => e.label)).toEqual([
    "You made an offer",
    "Marisol countered",
    "You accepted the counter",
  ]);
});

it("names who ended it, and never tells the buyer a minimum", () => {
  const ended: OfferRound[] = [
    { round_no: 1, actor_role: "buyer", kind: "below_minimum", amount_cents: 9000, created_at: at(1) },
    { round_no: 2, actor_role: "system", kind: "expire", amount_cents: null, created_at: at(2) },
  ];
  expect(offerHistoryFromRounds(ended, { incoming: true, counterpartyName: "Tommy" }).map((e) => e.label)).toEqual([
    "Declined automatically: below your minimum",
    "Offer expired unanswered",
  ]);
  expect(offerHistoryFromRounds(ended, { incoming: false, counterpartyName: "Tommy" })[0].label).toBe("Declined");
});

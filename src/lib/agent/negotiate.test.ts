import { describe, expect, it } from "vitest";

import { MAX_BUYER_OFFERS, STEP_CENTS, negotiate, type NegotiationInput, type NegotiationStyle, type RoundView } from "./negotiate";
import { seededRandom } from "./simulate";

const STYLES: NegotiationStyle[] = ["firm", "balanced", "flexible"];

/** A random but legal moment in a negotiation, from either side. */
function randomInput(rand: () => number): NegotiationInput {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  const dollars = (min: number, max: number) => (min + Math.floor(rand() * (max - min + 1))) * 100;
  const price = dollars(20, 5000);
  const shipping = pick([0, 0, 1500, 4000]);
  const scope = rand() < 0.5 ? "seller" : "buyer";
  const used = Math.floor(rand() * (MAX_BUYER_OFFERS + 1));
  const buyerAmounts = Array.from({ length: used }, () => dollars(1, price / 100));
  const buyerAmount = Math.max(STEP_CENTS, Math.min(price - STEP_CENTS, dollars(1, price / 100)));
  const rounds: RoundView[] = [{ roundNo: 1, actorRole: "buyer", kind: "offer", amountCents: buyerAmount }];
  let counter: number | null = null;
  if (rand() < 0.6) {
    counter = Math.min(price, buyerAmount + dollars(1, Math.max(1, (price - buyerAmount) / 100)));
    rounds.push({ roundNo: 2, actorRole: "seller", kind: "counter", amountCents: counter });
  }
  const status = scope === "seller" ? "open" : counter ? "countered" : pick(["open", "countered"] as const);
  return {
    scope,
    style: pick(STYLES),
    listing: { priceCents: price, shippingCents: shipping, status: rand() < 0.95 ? "active" : "reserved" },
    limits: scope === "seller"
      ? { floorCents: rand() < 0.95 ? dollars(1, price / 100) : null, targetCents: rand() < 0.5 ? dollars(1, price / 100) : null }
      : { ceilingCents: dollars(1, Math.round((price * 1.3) / 100)), ceilingBasis: pick(["item", "total"] as const), targetCents: rand() < 0.3 ? dollars(1, price / 100) : null },
    offer: rand() < 0.15 && scope === "buyer"
      ? null
      : { status, amountCents: buyerAmount, counterAmountCents: status === "countered" ? counter ?? buyerAmount + STEP_CENTS : null, roundCount: rounds.length },
    rounds,
    buyerAmounts,
  };
}

describe("negotiate", () => {
  it("never breaks the owner's limits or the negotiation rules (property, 20,000 cases)", () => {
    const rand = seededRandom(20261021);
    for (let i = 0; i < 20_000; i++) {
      const input = randomInput(rand);
      const decision = negotiate(input);
      const where = `case ${i}: ${JSON.stringify({ input, decision })}`;
      const price = input.listing.priceCents;
      if (decision.action === "counter" || decision.action === "open") {
        expect(decision.amountCents % STEP_CENTS, where).toBe(0);
        expect(decision.amountCents, where).toBeGreaterThan(0);
        expect(decision.amountCents, where).toBeLessThanOrEqual(price);
      }
      if (input.scope === "seller") {
        expect(["accept", "open"], where).not.toContain(decision.action);
        if (decision.action === "counter") {
          const offer = input.offer!;
          const previous = input.rounds.filter((r) => r.actorRole === "seller" && r.kind === "counter").at(-1)?.amountCents ?? price;
          expect(decision.amountCents, where).toBeGreaterThan(offer.amountCents);
          expect(decision.amountCents, where).toBeGreaterThanOrEqual(input.limits.floorCents!);
          expect(decision.amountCents, where).toBeLessThanOrEqual(previous);
        }
      } else {
        const itemMax = input.limits.ceilingCents! - (input.limits.ceilingBasis === "total" ? input.listing.shippingCents : 0);
        if (decision.action === "accept") expect(input.offer!.counterAmountCents!, where).toBeLessThanOrEqual(itemMax);
        if (decision.action === "counter") {
          expect(decision.amountCents, where).toBeGreaterThan(input.offer!.amountCents);
          expect(decision.amountCents, where).toBeLessThan(input.offer!.counterAmountCents!);
          expect(decision.amountCents, where).toBeLessThanOrEqual(itemMax);
          expect(input.buyerAmounts.length, where).toBeLessThan(MAX_BUYER_OFFERS);
        }
        if (decision.action === "open") {
          expect(decision.amountCents, where).toBeLessThanOrEqual(itemMax);
          expect(decision.amountCents, where).toBeGreaterThan(Math.max(0, ...input.buyerAmounts));
          expect(input.buyerAmounts.length, where).toBeLessThan(MAX_BUYER_OFFERS);
        }
      }
      if (input.listing.status !== "active") expect(decision, where).toEqual({ action: "hold", reason: "listing_unavailable" });
    }
  });

  it("is deterministic", () => {
    const rand = seededRandom(7);
    for (let i = 0; i < 2_000; i++) {
      const input = randomInput(rand);
      expect(negotiate(structuredClone(input))).toEqual(negotiate(input));
    }
  });

  it("concedes monotonically: a seller's counters never go back up", () => {
    const rand = seededRandom(99);
    for (let i = 0; i < 2_000; i++) {
      const price = (50 + Math.floor(rand() * 2000)) * 100;
      const floor = Math.round(price * (0.4 + rand() * 0.5) / 100) * 100;
      let buyer = Math.round(price * rand() * 0.4 / 100) * 100 + 100;
      const style = STYLES[i % 3];
      const rounds: RoundView[] = [{ roundNo: 1, actorRole: "buyer", kind: "offer", amountCents: buyer }];
      let last = Infinity;
      for (let turn = 0; turn < MAX_BUYER_OFFERS; turn++) {
        const decision = negotiate({
          scope: "seller", style, listing: { priceCents: price, shippingCents: 0, status: "active" },
          limits: { floorCents: floor }, offer: { status: "open", amountCents: buyer, counterAmountCents: null, roundCount: rounds.length },
          rounds, buyerAmounts: rounds.filter((r) => r.actorRole === "buyer").map((r) => r.amountCents!),
        });
        if (decision.action !== "counter") break;
        expect(decision.amountCents).toBeLessThanOrEqual(last);
        last = decision.amountCents;
        rounds.push({ roundNo: rounds.length + 1, actorRole: "seller", kind: "counter", amountCents: decision.amountCents });
        buyer = Math.min(decision.amountCents - 100, buyer + 100 * (1 + Math.floor(rand() * 50)));
        if (buyer <= rounds[rounds.length - 2].amountCents!) break;
        rounds.push({ roundNo: rounds.length + 1, actorRole: "buyer", kind: "counter", amountCents: buyer });
      }
    }
  });

  it("styles order the seller's first counter: firm ≥ balanced ≥ flexible", () => {
    const base = {
      scope: "seller" as const, listing: { priceCents: 100_000, shippingCents: 0, status: "active" },
      limits: { floorCents: 60_000 }, offer: { status: "open" as const, amountCents: 50_000, counterAmountCents: null, roundCount: 1 },
      rounds: [{ roundNo: 1, actorRole: "buyer" as const, kind: "offer", amountCents: 50_000 }], buyerAmounts: [50_000],
    };
    const amount = (style: NegotiationStyle) => {
      const decision = negotiate({ ...base, style });
      return decision.action === "counter" ? decision.amountCents : NaN;
    };
    expect(amount("firm")).toBe(95_000);
    expect(amount("balanced")).toBe(90_000);
    expect(amount("flexible")).toBe(85_000);
  });

  it("the seller's agent asks its owner instead of accepting", () => {
    const decision = negotiate({
      scope: "seller", style: "balanced", listing: { priceCents: 100_000, shippingCents: 0, status: "active" },
      limits: { floorCents: 60_000, targetCents: 80_000 }, offer: { status: "open", amountCents: 82_000, counterAmountCents: null, roundCount: 1 },
      rounds: [], buyerAmounts: [82_000],
    });
    expect(decision).toEqual({ action: "request_approval", reason: "meets_target" });
  });

  it("the buyer's agent accepts within its ceiling and counts shipping on a total ceiling", () => {
    const input: NegotiationInput = {
      scope: "buyer", style: "balanced", listing: { priceCents: 100_000, shippingCents: 5_000, status: "active" },
      limits: { ceilingCents: 90_000, ceilingBasis: "item" }, offer: { status: "countered", amountCents: 70_000, counterAmountCents: 88_000, roundCount: 2 },
      rounds: [], buyerAmounts: [70_000],
    };
    expect(negotiate(input)).toEqual({ action: "accept", reason: "within_ceiling" });
    const total = negotiate({ ...input, limits: { ceilingCents: 90_000, ceilingBasis: "total" } });
    expect(total.action).toBe("counter");
    if (total.action === "counter") expect(total.amountCents).toBeLessThanOrEqual(85_000);
  });

  it("holds on a settled, expired or someone else's turn", () => {
    const base: NegotiationInput = {
      scope: "seller", style: "balanced", listing: { priceCents: 100_000, shippingCents: 0, status: "active" },
      limits: { floorCents: 60_000 }, offer: { status: "countered", amountCents: 70_000, counterAmountCents: 90_000, roundCount: 2 },
      rounds: [], buyerAmounts: [70_000],
    };
    expect(negotiate(base)).toEqual({ action: "hold", reason: "not_my_turn" });
    expect(negotiate({ ...base, offer: { ...base.offer!, status: "accepted" } })).toEqual({ action: "hold", reason: "settled" });
    expect(negotiate({ ...base, offer: { ...base.offer!, status: "open", expiresAt: "2026-01-01T00:00:00Z" }, now: Date.parse("2026-02-01") }))
      .toEqual({ action: "hold", reason: "expired" });
    expect(negotiate({ ...base, limits: {} , offer: { ...base.offer!, status: "open" } })).toEqual({ action: "hold", reason: "limits_missing" });
  });
});

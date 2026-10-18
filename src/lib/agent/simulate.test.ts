import { describe, expect, it } from "vitest";

import type { NegotiationStyle } from "./negotiate";
import { firmSeller, haggler, oneShot, prober, seededRandom, simulate, splitter, type Listing, type Outcome, type PersonPolicy } from "./simulate";

const STYLES: NegotiationStyle[] = ["firm", "balanced", "flexible"];

/** A spread of listings: price, shipping and the listing's own minimum. */
function listings(seed: number, count: number): Listing[] {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, () => {
    const price = (100 + Math.floor(rand() * 3000)) * 100;
    return {
      priceCents: price,
      shippingCents: [0, 1500, 4500][Math.floor(rand() * 3)],
      floorCents: rand() < 0.8 ? Math.round((price * (0.5 + rand() * 0.3)) / 100) * 100 : null,
    };
  });
}

function sellerAccepted(outcome: Outcome) {
  return outcome.transcript.some((line) => line.startsWith("seller (agent) accept"));
}

describe("simulations: the seller's agent against a person", () => {
  const buyers = (listing: Listing): PersonPolicy[] => [
    haggler(listing.priceCents), // pays up to asking
    haggler(Math.round(listing.priceCents * 0.85)),
    haggler(Math.round(listing.priceCents * 0.6), 0.3),
    oneShot(0.7),
    prober(),
  ];

  it("never sells below the effective floor, never accepts by itself, and every move is legal", () => {
    let runs = 0;
    let sold = 0;
    for (const [i, listing] of listings(1, 60).entries()) {
      for (const style of STYLES) {
        const minimum = listing.floorCents === null ? Math.round(listing.priceCents * 0.7 / 100) * 100 : listing.floorCents + (i % 2 ? 0 : 1000);
        for (const buyer of buyers(listing)) {
          const outcome = simulate({ listing, seller: { kind: "agent", style, minimumCents: minimum }, buyer, seed: i * 31 + runs, ownerApproves: () => true });
          runs++;
          const floor = Math.max(listing.floorCents ?? 0, minimum);
          if (outcome.result === "sold") {
            sold++;
            expect(outcome.priceCents!, outcome.transcript.join("\n")).toBeGreaterThanOrEqual(floor);
          }
          expect(sellerAccepted(outcome)).toBe(false);
          for (const { side, decision } of outcome.decisions) {
            if (side === "seller" && decision.action === "counter") expect(decision.amountCents).toBeGreaterThanOrEqual(floor);
          }
          expect(outcome.moves).toBeLessThanOrEqual(20);
        }
      }
    }
    expect(runs).toBe(900);
    expect(sold).toBeGreaterThan(300);
  });

  it("a buyer willing to pay the asking price always gets the part", () => {
    for (const [i, listing] of listings(2, 40).entries()) {
      const outcome = simulate({ listing, seller: { kind: "agent", style: STYLES[i % 3], minimumCents: listing.floorCents ?? Math.round(listing.priceCents * 0.5 / 100) * 100 }, buyer: haggler(listing.priceCents), seed: i, ownerApproves: () => true });
      expect(outcome.result, outcome.transcript.join("\n")).toBe("sold");
    }
  });

  it("a prober never learns the minimum: every lowball is declined and the agent never counters under it", () => {
    for (const [i, listing] of listings(3, 40).entries()) {
      const minimum = Math.round(listing.priceCents * 0.75 / 100) * 100;
      const outcome = simulate({ listing, seller: { kind: "agent", style: "flexible", minimumCents: minimum }, buyer: prober(), seed: i });
      expect(outcome.result).toBe("no_deal");
      const counters = outcome.decisions.filter((d) => d.decision.action === "counter");
      for (const { decision } of counters) if (decision.action === "counter") expect(decision.amountCents).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("when the owner says no to an offer at target, nothing is sold", () => {
    const listing = { priceCents: 100_000, shippingCents: 0, floorCents: 60_000 };
    const outcome = simulate({ listing, seller: { kind: "agent", style: "balanced", targetCents: 80_000 }, buyer: haggler(85_000, 0.85), seed: 1, ownerApproves: () => false });
    expect(outcome.approvals).toEqual([{ side: "seller", reason: "meets_target" }]);
    expect(outcome.result).toBe("no_deal");
  });
});

describe("simulations: the buyer's agent against a person", () => {
  it("never pays more than its ceiling (counting shipping on a total ceiling)", () => {
    let runs = 0;
    let sold = 0;
    for (const [i, listing] of listings(4, 60).entries()) {
      for (const style of STYLES) {
        for (const basis of ["item", "total"] as const) {
          const ceiling = Math.round(listing.priceCents * (0.6 + (i % 5) * 0.1) / 100) * 100;
          for (const seller of [splitter(listing.priceCents, listing.floorCents ?? listing.priceCents * 0.5), splitter(Math.round(listing.priceCents * 0.8), Math.round(listing.priceCents * 0.6)), firmSeller()]) {
            const outcome = simulate({ listing, seller, buyer: { kind: "agent", style, ceilingCents: ceiling, ceilingBasis: basis }, seed: runs });
            runs++;
            if (outcome.result === "sold") {
              sold++;
              const cost = outcome.priceCents! + (basis === "total" ? listing.shippingCents : 0);
              expect(cost, outcome.transcript.join("\n")).toBeLessThanOrEqual(ceiling);
            }
            expect(outcome.moves).toBeLessThanOrEqual(20);
          }
        }
      }
    }
    expect(runs).toBe(1080);
    expect(sold).toBeGreaterThan(200);
  });

  it("closes a deal whenever the seller's floor is comfortably inside the ceiling", () => {
    for (const [i, listing] of listings(5, 40).entries()) {
      const sellerFloor = Math.round(listing.priceCents * 0.6 / 100) * 100;
      const outcome = simulate({
        listing: { ...listing, floorCents: null },
        seller: splitter(listing.priceCents, sellerFloor),
        buyer: { kind: "agent", style: "balanced", ceilingCents: Math.round(listing.priceCents * 0.9 / 100) * 100, ceilingBasis: "item" },
        seed: i,
      });
      expect(outcome.result, outcome.transcript.join("\n")).toBe("sold");
    }
  });

  it("asks its owner before going over the ceiling, and only the owner can say yes", () => {
    const listing = { priceCents: 100_000, shippingCents: 0, floorCents: null };
    const no = simulate({ listing, seller: splitter(100_000, 95_000), buyer: { kind: "agent", style: "balanced", ceilingCents: 80_000, ceilingBasis: "item" }, seed: 3 });
    expect(no.result).toBe("no_deal");
    const yes = simulate({ listing, seller: splitter(100_000, 95_000), buyer: { kind: "agent", style: "balanced", ceilingCents: 80_000, ceilingBasis: "item" }, seed: 3, ownerApproves: () => true });
    expect(yes.approvals.length).toBeGreaterThan(0);
    expect(yes.result).toBe("sold");
    expect(yes.transcript.some((line) => line.startsWith("buyer (person) accept"))).toBe(true);
  });
});

describe("simulations: agent against agent", () => {
  it("never crosses either owner's limits, and deals exactly when the ranges overlap enough", () => {
    let overlapping = 0;
    let dealsWhenOverlapping = 0;
    for (const [i, listing] of listings(6, 80).entries()) {
      for (const sellerStyle of STYLES) {
        for (const buyerStyle of STYLES) {
          const minimum = Math.round(listing.priceCents * (0.55 + (i % 4) * 0.1) / 100) * 100;
          const ceiling = Math.round(listing.priceCents * (0.5 + (i % 6) * 0.1) / 100) * 100;
          const outcome = simulate({
            listing,
            seller: { kind: "agent", style: sellerStyle, minimumCents: minimum },
            buyer: { kind: "agent", style: buyerStyle, ceilingCents: ceiling, ceilingBasis: "item" },
            seed: i,
            // The seller's owner takes a final offer that clears their own minimum; the buyer's never goes over its max.
            ownerApproves: (side) => side === "seller",
          });
          const floor = Math.max(listing.floorCents ?? 0, minimum);
          if (outcome.result === "sold") {
            expect(outcome.priceCents!).toBeGreaterThanOrEqual(floor);
            expect(outcome.priceCents!).toBeLessThanOrEqual(ceiling);
          }
          if (ceiling < floor) expect(outcome.result).toBe("no_deal");
          // The seller's agent never accepts by itself.
          expect(sellerAccepted(outcome)).toBe(false);
          if (ceiling >= floor + listing.priceCents * 0.1) {
            overlapping++;
            if (outcome.result === "sold") dealsWhenOverlapping++;
          }
        }
      }
    }
    expect(overlapping).toBeGreaterThan(100);
    // Two agents that can agree mostly do, without either owner stepping in.
    expect(dealsWhenOverlapping / overlapping).toBeGreaterThan(0.9);
  });

  it("is deterministic: the same seed replays the same negotiation", () => {
    const run = () => simulate({
      listing: { priceCents: 123_400, shippingCents: 1500, floorCents: 70_000 },
      seller: { kind: "agent", style: "balanced", minimumCents: 80_000 },
      buyer: { kind: "agent", style: "flexible", ceilingCents: 100_000, ceilingBasis: "total" },
      seed: 42,
    });
    expect(run()).toEqual(run());
    expect(run().transcript.length).toBeGreaterThan(1);
  });
});

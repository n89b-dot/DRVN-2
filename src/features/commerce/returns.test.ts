import { describe, expect, it } from "vitest";

import { RETURN_TRANSITIONS, canTransition } from "@/lib/domain/states";
import { returnEntitlementCents, ACTIVE_RETURN_STATUSES } from "./returns";

/**
 * The return-domain rules that decide money (§26/§28/§31). The DB guard
 * enforces transitions; these lock the TS mirror and the allocation math.
 */
describe("returnEntitlementCents", () => {
  const items = [
    { price_cents: 30_000, shipping_cents: 2_300 },
    { price_cents: 5_000, shipping_cents: 800 },
  ];

  it("seller-responsibility returns refund item + its original shipping (§26)", () => {
    expect(returnEntitlementCents(items, { includeShipping: true })).toBe(38_100);
    expect(returnEntitlementCents([items[0]], { includeShipping: true })).toBe(32_300);
  });

  it("buyer-responsibility returns keep outbound shipping with the seller", () => {
    expect(returnEntitlementCents(items, { includeShipping: false })).toBe(35_000);
  });

  it("is item-aware: one item's entitlement never includes its siblings (§31)", () => {
    const one = returnEntitlementCents([items[1]], { includeShipping: true });
    expect(one).toBe(5_800);
    expect(one).toBeLessThan(returnEntitlementCents(items, { includeShipping: true }));
  });
});

describe("return lifecycle map", () => {
  it("cannot refund before receipt: no path skips delivered → received", () => {
    // The only ways INTO completed are received and an admin call from
    // escalated — never straight from transit or approval.
    for (const from of ["requested", "approved", "awaiting_shipment", "in_transit", "delivered"] as const) {
      expect(canTransition(RETURN_TRANSITIONS, from, "completed")).toBe(false);
    }
    expect(canTransition(RETURN_TRANSITIONS, "received", "completed")).toBe(true);
  });

  it("expiry only applies before the parcel moves (§27)", () => {
    expect(canTransition(RETURN_TRANSITIONS, "approved", "expired")).toBe(true);
    expect(canTransition(RETURN_TRANSITIONS, "awaiting_shipment", "expired")).toBe(true);
    expect(canTransition(RETURN_TRANSITIONS, "in_transit", "expired")).toBe(false);
    expect(canTransition(RETURN_TRANSITIONS, "delivered", "expired")).toBe(false);
  });

  it("escalation is reachable from every live inspection point (§29)", () => {
    for (const from of ["in_transit", "delivered", "received"] as const) {
      expect(canTransition(RETURN_TRANSITIONS, from, "escalated")).toBe(true);
    }
  });

  it("every ACTIVE status is a real status that pauses the dispute clock (§28)", () => {
    for (const status of ACTIVE_RETURN_STATUSES) {
      expect(RETURN_TRANSITIONS[status]).toBeDefined();
    }
    // Terminal-and-inactive statuses release the clock.
    for (const status of ["completed", "rejected", "expired", "cancelled"] as const) {
      expect(ACTIVE_RETURN_STATUSES).not.toContain(status);
    }
  });
});

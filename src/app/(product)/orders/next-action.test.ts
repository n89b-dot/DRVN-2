import { describe, expect, it } from "vitest";

import type { OrderStatus } from "@/lib/database.types";

import {
  finishCheckoutHref,
  isRawStatus,
  isStateGroup,
  nextAction,
  RAW_STATUSES,
  STATE_GROUPS,
} from "./next-action";

const order = (
  status: OrderStatus,
  overrides: Partial<{
    is_collection: boolean;
    tracking_number: string | null;
    pickup_ready_at: string | null;
  }> = {},
) => ({
  status,
  is_collection: false,
  tracking_number: null,
  pickup_ready_at: null,
  ...overrides,
});

describe("order state groups", () => {
  it("covers every raw status exactly once", () => {
    const grouped = Object.values(STATE_GROUPS).flat();
    expect([...grouped].sort()).toEqual([...RAW_STATUSES].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("validates group and raw-status parameters", () => {
    expect(isStateGroup("active")).toBe(true);
    expect(isStateGroup("everything")).toBe(false);
    expect(isRawStatus("shipped")).toBe(true);
    expect(isRawStatus("shipping")).toBe(false);
    expect(isRawStatus(undefined)).toBe(false);
  });
});

describe("nextAction", () => {
  it("tells a seller a paid order needs dispatch", () => {
    expect(nextAction(order("paid"), true)).toBe("Dispatch required");
  });

  it("walks both parties through the pickup handshake (0054)", () => {
    // Before the seller readies it, the ball is in their court.
    expect(nextAction(order("paid", { is_collection: true }), true)).toBe(
      "Mark it ready for pickup",
    );
    expect(nextAction(order("paid", { is_collection: true }), false)).toBe(
      "Waiting on the seller to prepare pickup",
    );
    // Once ready, the handoff needs the Pickup Pass from the buyer's side.
    const ready = order("paid", { is_collection: true, pickup_ready_at: "2026-08-29T00:00:00Z" });
    expect(nextAction(ready, true)).toBe("At handoff, scan the buyer's Pickup Pass");
    expect(nextAction(ready, false)).toBe("Ready — show your Pickup Pass at handoff");
  });

  it("tells a buyer the same order is waiting on the seller", () => {
    expect(nextAction(order("paid"), false)).toBe("Waiting on dispatch");
  });

  it("asks a buyer to confirm a shipped order", () => {
    expect(nextAction(order("shipped"), false)).toMatch(/confirm when it arrives/);
    expect(nextAction(order("shipped"), true)).toMatch(/waiting on delivery/);
  });

  it("says nothing on settled orders — there is no next move", () => {
    for (const status of ["completed", "cancelled", "refunded", "payment_failed"] as const) {
      expect(nextAction(order(status), true)).toBeNull();
      expect(nextAction(order(status), false)).toBeNull();
    }
  });

  it("never gives both sides the same instruction on a live order", () => {
    for (const status of ["pending", "requires_action", "paid", "shipped", "delivered", "disputed"] as const) {
      expect(nextAction(order(status), true)).not.toBe(nextAction(order(status), false));
    }
  });
});

describe("finishCheckoutHref", () => {
  it("N87: a pending cart order finishes in the cart checkout, not the offer page that refuses it", () => {
    expect(finishCheckoutHref({ id: "order-1", origin_offer_id: null })).toMatch(/^\/checkout(\?|$)/);
  });

  it("a cart order's Finish checkout carries the order, so another device can resume it", () => {
    expect(finishCheckoutHref({ id: "order-1", origin_offer_id: null })).toBe("/checkout?order=order-1");
  });

  it("an accepted offer still finishes on its own checkout page", () => {
    expect(finishCheckoutHref({ id: "order-1", origin_offer_id: "offer-1" })).toBe("/orders/order-1/checkout");
  });
});

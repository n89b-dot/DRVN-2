import { describe, expect, it } from "vitest";

import type { OrderStatus } from "@/lib/database.types";

import {
  isRawStatus,
  isStateGroup,
  nextAction,
  RAW_STATUSES,
  STATE_GROUPS,
} from "./next-action";

const order = (status: OrderStatus, overrides: Partial<{ is_collection: boolean; tracking_number: string | null }> = {}) => ({
  status,
  is_collection: false,
  tracking_number: null,
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

  it("asks a seller to arrange collection when there's nothing to ship", () => {
    expect(nextAction(order("paid", { is_collection: true }), true)).toBe("Arrange collection");
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

import { describe, expect, it } from "vitest";

import { pickupHandoffState, type PickupHandoffOrder } from "./pickup-handoff";

const ready: PickupHandoffOrder = { status: "paid", pre_dispute_status: null, is_collection: true, pickup_ready_at: "2026-11-07T10:00:00Z" };
const open = { chargebackOpen: false };

describe("pickupHandoffState (mirrors pickup_redeem, 20261107210300)", () => {
  it("a paid collection made available is redeemable", () => {
    expect(pickupHandoffState(ready, open)).toBe("redeemable");
  });

  it("a disputed collection never handed over stays redeemable, so the scanned pass works", () => {
    expect(pickupHandoffState({ ...ready, status: "disputed", pre_dispute_status: "paid" }, open)).toBe("redeemable");
  });

  it("not during an unresolved bank chargeback", () => {
    expect(pickupHandoffState({ ...ready, status: "disputed", pre_dispute_status: "paid" }, { chargebackOpen: true })).toBe(
      "not_waiting"
    );
  });

  it("a handoff already made, in or out of a case, is done", () => {
    expect(pickupHandoffState({ ...ready, status: "delivered" }, open)).toBe("done");
    expect(pickupHandoffState({ ...ready, status: "completed" }, open)).toBe("done");
    expect(pickupHandoffState({ ...ready, status: "disputed", pre_dispute_status: "delivered" }, open)).toBe("done");
  });

  it("nothing to hand over: not made available, shipped, refunded, or not a collection", () => {
    expect(pickupHandoffState({ ...ready, pickup_ready_at: null }, open)).toBe("not_waiting");
    expect(pickupHandoffState({ ...ready, status: "disputed", pre_dispute_status: "shipped" }, open)).toBe("not_waiting");
    expect(pickupHandoffState({ ...ready, status: "refunded" }, open)).toBe("not_waiting");
    expect(pickupHandoffState({ ...ready, is_collection: false }, open)).toBe("not_waiting");
  });
});

import { describe, expect, it } from "vitest";

import { canTakeSales, payoutSetupState } from "./payout-readiness";

/**
 * N244 (Neil, 8 Nov 2026): setup started is enough to publish and be bought
 * from; payouts enabled always is; the day-14 restriction takes it away.
 * Mirrors private.seller_can_take_payment (20261108100000), proven in SQL by
 * supabase/tests/payout_setup_started_guard.sql.
 */
const setup = (over: Partial<Parameters<typeof payoutSetupState>[0]> = {}) => ({
  accountId: "acct_1",
  payoutsEnabled: false,
  detailsSubmitted: false,
  restricted: false,
  ...over,
});

describe("payout setup state (N244)", () => {
  it("lets a seller whose details are with Stripe sell before payouts are enabled", () => {
    expect(payoutSetupState(setup({ detailsSubmitted: true }))).toBe("verifying");
    expect(canTakeSales("verifying")).toBe(true);
  });

  it("refuses a seller who hasn't started setup", () => {
    expect(payoutSetupState(setup())).toBe("not_started");
    expect(payoutSetupState(setup({ accountId: null, detailsSubmitted: true }))).toBe("not_started");
    expect(canTakeSales("not_started")).toBe(false);
  });

  it("refuses a seller restricted at day 14, until payouts are enabled", () => {
    expect(payoutSetupState(setup({ detailsSubmitted: true, restricted: true }))).toBe("restricted");
    expect(canTakeSales("restricted")).toBe(false);
    expect(payoutSetupState(setup({ detailsSubmitted: true, restricted: true, payoutsEnabled: true }))).toBe("enabled");
    expect(canTakeSales("enabled")).toBe(true);
  });
});

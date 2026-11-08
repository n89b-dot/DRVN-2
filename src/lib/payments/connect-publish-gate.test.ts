import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The app's publish gate (N244, 20261108100000): with real payments a seller
 * can publish once their Stripe setup has started (details submitted), even
 * before payouts are enabled; not before, and not while restricted at day
 * 14. The stub provider has no gate. The Connect sync stores the
 * details-submitted flag next to payouts_enabled.
 */

const state = vi.hoisted(() => ({
  provider: "stripe",
  profile: null as Record<string, unknown> | null,
  account: {} as Record<string, unknown>,
  update: vi.fn(),
}));

vi.mock("./provider", () => ({ getPaymentProvider: () => ({ name: state.provider }) }));
vi.mock("./stripe", () => ({ stripeClient: () => ({ accounts: { retrieve: async () => state.account } }) }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: state.profile, error: null });
      chain.update = (values: unknown) => {
        state.update(values);
        return { eq: () => ({ select: async () => ({ data: [{ payout_restricted_at: null }], error: null }) }) };
      };
      return chain;
    },
  }),
}));

import { sellerCanPublish, syncConnectAccount } from "./connect";

const profile = (over: Record<string, unknown> = {}) => ({
  stripe_account_id: "acct_1",
  payouts_enabled: false,
  payout_details_submitted: false,
  payout_restricted_at: null,
  ...over,
});

beforeEach(() => {
  state.provider = "stripe";
  state.update.mockReset();
});

describe("publish gate (N244)", () => {
  it("lets a seller publish once their details are with Stripe, before payouts are enabled", async () => {
    state.profile = profile({ payout_details_submitted: true });
    await expect(sellerCanPublish("u1")).resolves.toBe(true);
  });

  it("refuses a seller who hasn't started payout setup", async () => {
    state.profile = profile();
    await expect(sellerCanPublish("u1")).resolves.toBe(false);
    state.profile = null;
    await expect(sellerCanPublish("u1")).resolves.toBe(false);
  });

  it("refuses a seller restricted at day 14 until payouts are enabled", async () => {
    state.profile = profile({ payout_details_submitted: true, payout_restricted_at: "2026-11-01T00:00:00Z" });
    await expect(sellerCanPublish("u1")).resolves.toBe(false);
    state.profile = profile({ payouts_enabled: true, payout_details_submitted: true });
    await expect(sellerCanPublish("u1")).resolves.toBe(true);
  });

  it("has no gate with the stub provider", async () => {
    state.provider = "stub";
    state.profile = profile();
    await expect(sellerCanPublish("u1")).resolves.toBe(true);
  });

  it("stores Stripe's details_submitted with payouts_enabled on sync", async () => {
    state.account = { id: "acct_1", payouts_enabled: false, details_submitted: true, requirements: { currently_due: [] } };
    const status = await syncConnectAccount("acct_1");
    expect(state.update).toHaveBeenCalledWith({ payouts_enabled: false, payout_details_submitted: true });
    expect(status).toMatchObject({ payoutsEnabled: false, detailsSubmitted: true, restricted: false });
  });
});

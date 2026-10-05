import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transferList: vi.fn(),
  transferCreate: vi.fn(),
  reportError: vi.fn(),
  sendAdminAlert: vi.fn(async () => undefined),
}));

vi.mock("./stripe", () => ({
  stripeClient: () => ({ transfers: { list: mocks.transferList, create: mocks.transferCreate } }),
}));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/admin/alerts", () => ({ sendAdminAlert: mocks.sendAdminAlert }));

import { processCarryPayouts } from "./carry-payout-worker";

type Payout = {
  id: string;
  seller_id: string | null;
  amount_cents: number;
  currency: string;
  attempts: number;
  destination: string | null;
  provider_call_may_have_occurred: boolean;
  transfer_reference: string | null;
};

function payout(overrides: Partial<Payout> = {}): Payout {
  return {
    id: "payout-1",
    seller_id: "seller-1",
    amount_cents: 800,
    currency: "USD",
    attempts: 0,
    destination: null,
    provider_call_may_have_occurred: false,
    transfer_reference: null,
    ...overrides,
  };
}

function adminFor(
  claimed: Payout[],
  seller: { stripe_account_id: string | null; payouts_enabled: boolean } | null = {
    stripe_account_id: "acct_seller",
    payouts_enabled: true,
  },
  overrides: Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }> = {}
) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const notifications: unknown[] = [];
  const defaults: Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }> = {
    open_seller_carry_payouts: () => ({ data: claimed.length, error: null }),
    claim_seller_carry_payouts: () => ({ data: claimed, error: null }),
    prepare_seller_carry_payout: (args) => ({ data: args.p_destination, error: null }),
    complete_seller_carry_payout: () => ({ data: "completed", error: null }),
    release_seller_carry_payout: () => ({ data: true, error: null }),
  };
  const admin = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return (overrides[fn] ?? defaults[fn])(args);
    }),
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: seller, error: null }) }) }) };
      }
      return { insert: async (row: unknown) => { notifications.push(row); return { error: null }; } };
    }),
  };
  const called = (fn: string) => calls.filter((call) => call.fn === fn);
  return { admin: admin as unknown as Parameters<typeof processCarryPayouts>[0], calls, called, notifications };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transferList.mockResolvedValue({ data: [], has_more: false });
  mocks.transferCreate.mockResolvedValue({ id: "tr_credit" });
});

describe("processCarryPayouts", () => {
  it("sends the credit once, to the frozen destination, under the payout's own key", async () => {
    const { admin, called, notifications } = adminFor([payout()]);
    const summary = await processCarryPayouts(admin);

    expect(summary).toEqual({ opened: 1, paid: 1, waiting: 0, cancelled: 0, failed: 0 });
    expect(mocks.transferCreate).toHaveBeenCalledTimes(1);
    expect(mocks.transferCreate).toHaveBeenCalledWith(
      {
        amount: 800,
        currency: "usd",
        destination: "acct_seller",
        transfer_group: "carry-payout:payout-1",
        metadata: { carry_payout_id: "payout-1", transfer_operation: "carry-payout:payout-1" },
      },
      { idempotencyKey: "carry-payout:payout-1" }
    );
    // Prepared (lease check, destination frozen) before Stripe; completed after.
    expect(called("prepare_seller_carry_payout")[0].args).toMatchObject({ p_id: "payout-1", p_destination: "acct_seller" });
    expect(called("complete_seller_carry_payout")[0].args).toMatchObject({ p_id: "payout-1", p_transfer_reference: "tr_credit" });
    expect(notifications).toHaveLength(1);
    // No lookup on a first attempt: nothing can have been sent.
    expect(mocks.transferList).not.toHaveBeenCalled();
  });

  it("waits, without using an attempt, while the seller can't be paid", async () => {
    const { admin, called } = adminFor([payout()], { stripe_account_id: "acct_seller", payouts_enabled: false });
    const summary = await processCarryPayouts(admin);

    expect(summary).toMatchObject({ paid: 0, waiting: 1, failed: 0 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    const released = called("release_seller_carry_payout")[0].args;
    expect(released).toMatchObject({ p_status: "pending", p_attempts: null });
    expect(new Date(released.p_next_attempt_at as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("puts the credit back when the seller's account is gone and nothing was sent", async () => {
    const { admin, called } = adminFor([payout({ seller_id: null })], null);
    const summary = await processCarryPayouts(admin);

    expect(summary).toMatchObject({ cancelled: 1, paid: 0 });
    expect(called("release_seller_carry_payout")[0].args).toMatchObject({ p_status: "cancelled" });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
  });

  it("adopts the transfer an interrupted attempt already made instead of sending again", async () => {
    mocks.transferList.mockResolvedValue({
      data: [{ id: "tr_earlier", amount: 800, currency: "usd", destination: "acct_frozen", metadata: { carry_payout_id: "payout-1" } }],
      has_more: false,
    });
    // The seller has since connected a different account; the frozen one wins.
    const { admin, called } = adminFor(
      [payout({ provider_call_may_have_occurred: true, destination: "acct_frozen", attempts: 1 })],
      { stripe_account_id: "acct_new", payouts_enabled: true }
    );
    const summary = await processCarryPayouts(admin);

    expect(summary).toMatchObject({ paid: 1, failed: 0 });
    expect(mocks.transferList).toHaveBeenCalledWith({ transfer_group: "carry-payout:payout-1", limit: 10 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(called("complete_seller_carry_payout")[0].args).toMatchObject({ p_transfer_reference: "tr_earlier" });
  });

  it("re-sends under the same key to the frozen destination when Stripe has no earlier transfer", async () => {
    const { admin } = adminFor(
      [payout({ provider_call_may_have_occurred: true, destination: "acct_frozen", attempts: 1 })],
      { stripe_account_id: "acct_new", payouts_enabled: false }
    );
    const summary = await processCarryPayouts(admin);

    expect(summary).toMatchObject({ paid: 1 });
    expect(mocks.transferCreate).toHaveBeenCalledWith(
      expect.objectContaining({ destination: "acct_frozen", amount: 800 }),
      { idempotencyKey: "carry-payout:payout-1" }
    );
  });

  it("stops and alerts when Stripe's record doesn't match the payout", async () => {
    mocks.transferList.mockResolvedValue({
      data: [{ id: "tr_wrong", amount: 900, currency: "usd", destination: "acct_frozen", metadata: { carry_payout_id: "payout-1" } }],
      has_more: false,
    });
    const { admin, called } = adminFor([payout({ provider_call_may_have_occurred: true, destination: "acct_frozen" })]);
    const summary = await processCarryPayouts(admin);

    expect(summary).toMatchObject({ paid: 0, failed: 1 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(called("release_seller_carry_payout")[0].args).toMatchObject({ p_status: "failed", p_attempts: 8 });
    expect(mocks.sendAdminAlert).toHaveBeenCalledTimes(1);
  });

  it("backs off after a Stripe refusal and alerts once attempts run out", async () => {
    mocks.transferCreate.mockRejectedValue(new Error("balance_insufficient"));
    const first = adminFor([payout({ attempts: 0 })]);
    expect(await processCarryPayouts(first.admin)).toMatchObject({ failed: 1, paid: 0 });
    const retry = first.called("release_seller_carry_payout")[0].args;
    expect(retry).toMatchObject({ p_status: "failed", p_attempts: 1, p_last_error: "balance_insufficient" });
    expect(retry.p_next_attempt_at).not.toBeNull();
    expect(mocks.sendAdminAlert).not.toHaveBeenCalled();

    const last = adminFor([payout({ attempts: 7 })]);
    await processCarryPayouts(last.admin);
    expect(last.called("release_seller_carry_payout")[0].args).toMatchObject({ p_status: "failed", p_attempts: 8, p_next_attempt_at: null });
    expect(mocks.sendAdminAlert).toHaveBeenCalledTimes(1);
  });

  it("does not call Stripe or write to the row once the lease is lost", async () => {
    const { admin, called } = adminFor([payout()], undefined, {
      prepare_seller_carry_payout: () => ({ data: null, error: null }),
    });
    const summary = await processCarryPayouts(admin);

    expect(summary).toMatchObject({ failed: 1, paid: 0 });
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(called("release_seller_carry_payout")).toHaveLength(0);
  });
});

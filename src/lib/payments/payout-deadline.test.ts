import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The payout deadline pass (N244, Neil's ruling 8 Nov 2026; the claim,
 * restriction and dispatch fence are proven in SQL by
 * supabase/tests/payout_setup_started_guard.sql). Each claimed order not yet
 * dispatched is refunded in full through the one refund path, reserved by
 * begin_payout_deadline_refund (20261108110000), which adopts the deadline's
 * own refund in flight and waits while another refund is in flight; an order
 * already refunded is only settled; an unconfirmed or waiting refund retries
 * rather than fails. The reservation rules, the claim rotation and the
 * fences are proven in SQL by supabase/tests/payout_deadline_fences_guard.sql.
 */

const mocks = vi.hoisted(() => ({
  refundOrder: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock("./refunds", () => ({ refundOrder: mocks.refundOrder }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { payoutDeadlineRequestKey, processPayoutDeadlines } from "./payout-deadline";

type Rpc = { data: unknown; error: unknown };

function adminFor(claim: unknown, settle: (order: string) => Rpc = () => ({ data: { complete: true }, error: null })) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_payout_deadline_cancellations") return { data: claim, error: null };
    if (name === "settle_payout_deadline_cancellation") return settle(args.p_order as string);
    throw new Error(`unexpected rpc ${name}`);
  });
  return { rpc };
}

const ORDER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mocks.refundOrder.mockReset();
  mocks.reportError.mockReset();
});

describe("payout deadline pass (N244)", () => {
  it("refunds an undispatched day-14 order in full through the deadline's reservation, then puts the part back", async () => {
    mocks.refundOrder.mockResolvedValue({ ok: true, refundedCents: 10000, reversedCents: 0, feeRefundedCents: 1000, fullyRefunded: true });
    const admin = adminFor({ restricted: 1, paused: 2, claimed: 1, orders: [{ order_id: ORDER, status: "paid" }] });

    const summary = await processPayoutDeadlines(admin as never);

    expect(mocks.refundOrder).toHaveBeenCalledTimes(1);
    const input = mocks.refundOrder.mock.calls[0][1];
    expect(input).toMatchObject({
      orderId: ORDER,
      initiator: { kind: "payout_deadline" },
      payoutDeadline: true,
    });
    // The reservation picks the amount (the whole remainder, once no other
    // refund is in flight) and the key; the pass asks for neither.
    expect(input.amountCents).toBeUndefined();
    expect(input.requestKey).toBeUndefined();
    expect(admin.rpc).toHaveBeenCalledWith("settle_payout_deadline_cancellation", { p_order: ORDER });
    expect(summary).toEqual({ restricted: 1, paused: 2, claimed: 1, refunded: 1, retrying: 0, failed: 0 });
  });

  it("never starts a second refund: a retry uses the same request key, and a refunded order is only settled", async () => {
    expect(payoutDeadlineRequestKey(ORDER)).toBe(payoutDeadlineRequestKey(ORDER));
    const admin = adminFor({ orders: [{ order_id: ORDER, status: "refunded" }] });

    const summary = await processPayoutDeadlines(admin as never);

    expect(mocks.refundOrder).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith("settle_payout_deadline_cancellation", { p_order: ORDER });
    expect(summary.refunded).toBe(1);
  });

  it("keeps an unconfirmed refund retrying, and doesn't settle it", async () => {
    mocks.refundOrder.mockResolvedValue({ ok: false, pending: true, error: "still confirming" });
    const admin = adminFor({ orders: [{ order_id: ORDER, status: "paid" }] });

    const summary = await processPayoutDeadlines(admin as never);

    expect(summary).toMatchObject({ retrying: 1, failed: 0, refunded: 0 });
    expect(admin.rpc).not.toHaveBeenCalledWith("settle_payout_deadline_cancellation", expect.anything());
  });

  it("reports a refused refund as failed, so the worker family shows it", async () => {
    mocks.refundOrder.mockResolvedValue({ ok: false, refused: true, error: "No payment on file for this order." });
    const admin = adminFor({ orders: [{ order_id: ORDER, status: "paid" }] }, () => ({
      data: { ok: false, complete: false, reason: "The refund is not complete yet." },
      error: null,
    }));

    const summary = await processPayoutDeadlines(admin as never);

    expect(summary).toMatchObject({ failed: 1, refunded: 0 });
    expect(mocks.reportError).toHaveBeenCalled();
  });

  it("keeps a claim waiting on another refund in flight retrying: not failed, not settled", async () => {
    mocks.refundOrder.mockResolvedValue({ ok: false, waiting: true, error: "Another refund on this order is still being made." });
    const admin = adminFor({ orders: [{ order_id: ORDER, status: "paid" }] });

    const summary = await processPayoutDeadlines(admin as never);

    expect(summary).toMatchObject({ retrying: 1, failed: 0, refunded: 0 });
    expect(admin.rpc).not.toHaveBeenCalledWith("settle_payout_deadline_cancellation", expect.anything());
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  it("settles an order another path already refunded in full (nothing left to refund)", async () => {
    mocks.refundOrder.mockResolvedValue({ ok: false, refused: true, error: "Nothing left to refund on this order." });
    const admin = adminFor({ orders: [{ order_id: ORDER, status: "paid" }] });

    const summary = await processPayoutDeadlines(admin as never);

    expect(admin.rpc).toHaveBeenCalledWith("settle_payout_deadline_cancellation", { p_order: ORDER });
    expect(summary).toMatchObject({ refunded: 1, failed: 0 });
  });

  it("does nothing when nothing is due (stub payments, or no day-14 sales)", async () => {
    const admin = adminFor({ restricted: 0, paused: 0, claimed: 0, orders: [] });
    await expect(processPayoutDeadlines(admin as never)).resolves.toEqual({
      restricted: 0, paused: 0, claimed: 0, refunded: 0, retrying: 0, failed: 0,
    });
    expect(mocks.refundOrder).not.toHaveBeenCalled();
  });
});

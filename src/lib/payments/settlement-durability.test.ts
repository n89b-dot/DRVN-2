import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const paymentMocks = vi.hoisted(() => ({
  recordExternalRefund: vi.fn(),
  runRefundOperation: vi.fn(),
}));
const alertMocks = vi.hoisted(() => ({ sendAdminAlert: vi.fn() }));
const stripeMocks = vi.hoisted(() => ({ listRefunds: vi.fn() }));

vi.mock("./refunds", () => paymentMocks);
vi.mock("@/lib/admin/alerts", () => alertMocks);
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("./stripe", () => ({
  stripeClient: () => ({ refunds: { list: stripeMocks.listRefunds } }),
}));

import {
  applyAccountUpdate,
  applyChargeRefund,
  applyDisputeEvent,
  applyRefundLifecycleEvent,
  claimWebhookEvent,
  markRequiresAction,
  markWebhookEventProcessed,
} from "./settlement";

type QueryResult = { data: unknown; error: unknown };

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "insert", "upsert", "update", "eq", "in", "is"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function adminWith(...results: QueryResult[]) {
  const builders = results.map(query);
  return {
    from: vi.fn(() => {
      const next = builders.shift();
      if (!next) throw new Error("Unexpected database query");
      return next;
    }),
  };
}

function adminWithRpc(rpcResults: QueryResult[], ...results: QueryResult[]) {
  const admin = adminWith(...results);
  return {
    ...admin,
    rpc: vi.fn(async (name: string) => {
      if (name === "refund_gap_snapshot") {
        // The booked total and in-flight operations from one snapshot: the
        // next queued result stands for the payment rows at that instant.
        const rows = (await (admin.from() as unknown as PromiseLike<QueryResult>)).data as Array<{ refunded_cents: number | null }> | null;
        const booked = (rows ?? []).reduce((sum, row) => sum + (row.refunded_cents ?? 0), 0);
        return { data: { payments: rows?.length ?? 0, booked_cents: booked, in_flight_cents: 0 }, error: null };
      }
      const next = rpcResults.shift();
      if (!next) throw new Error("Unexpected RPC call");
      return next;
    }),
  };
}

function refundedCharge(overrides: Partial<Stripe.Charge> = {}): Stripe.Charge {
  return {
    id: "ch_1",
    payment_intent: "pi_1",
    amount_refunded: 500,
    refunded: false,
    // Current API shape (2026-07-29.dahlia): a Charge has no `refunds` list;
    // refunds come from stripeMocks.listRefunds.
    ...overrides,
  } as unknown as Stripe.Charge;
}

beforeEach(() => {
  vi.clearAllMocks();
  paymentMocks.recordExternalRefund.mockResolvedValue({ applied: true });
  paymentMocks.runRefundOperation.mockResolvedValue({ ok: true });
  alertMocks.sendAdminAlert.mockResolvedValue(undefined);
  stripeMocks.listRefunds.mockResolvedValue({ data: [], has_more: false });
});

describe("webhook persistence failures", () => {
  it("does not treat a failed payment lookup as an unknown refund", async () => {
    const admin = adminWith({ data: null, error: { code: "08006" } });
    await expect(applyChargeRefund(admin as never, refundedCharge())).rejects.toThrow(
      "refund payment lookup failed; retry required"
    );
    expect(alertMocks.sendAdminAlert).not.toHaveBeenCalled();
  });

  it("opens durable recovery when a successful refund is absent from the ledger", async () => {
    const row = {
      id: "pay_1",
      order_id: "order_1",
      amount_cents: 500,
      refunded_cents: 0,
      status: "succeeded",
    };
    const admin = adminWithRpc(
      [{ data: { action: "settle", operation_id: "op_1" }, error: null }],
      { data: [row], error: null },
      // The gap snapshot: nothing booked, nothing still booking.
      { data: [row], error: null },
      { data: { id: "recovery_1" }, error: null }
    );
    stripeMocks.listRefunds.mockResolvedValue({
      data: [{ id: "re_1", amount: 500, status: "succeeded", metadata: { order_id: "order_1" } }],
      has_more: false,
    });
    const charge = refundedCharge();

    await expect(applyChargeRefund(admin as never, charge)).resolves.toBe("recovery_recorded");
  });

  it("uses one stable provider identity for recovery across replays", async () => {
    const first = adminWith(
      { data: [], error: null },
      { data: { id: "recovery_1" }, error: null }
    );
    const second = adminWith(
      { data: [], error: null },
      { data: { id: "recovery_1" }, error: null }
    );
    const charge = refundedCharge();

    await expect(applyChargeRefund(first as never, charge)).resolves.toBe("recovery_recorded");
    await expect(applyChargeRefund(second as never, charge)).resolves.toBe("recovery_recorded");

    const firstUpsert = (first.from.mock.results[1].value.upsert as ReturnType<typeof vi.fn>);
    const secondUpsert = (second.from.mock.results[1].value.upsert as ReturnType<typeof vi.fn>);
    expect(firstUpsert.mock.calls[0][0].recovery_key).toBe("stripe:charge-refund:ch_1:500");
    expect(secondUpsert.mock.calls[0][0].recovery_key).toBe("stripe:charge-refund:ch_1:500");
    expect(firstUpsert.mock.calls[0][1]).toEqual({ onConflict: "recovery_key" });
  });

  it("fetches and books the refund collection from the list, never the charge", async () => {
    const row = {
      id: "pay_1",
      order_id: "order_1",
      amount_cents: 1_000,
      refunded_cents: 0,
      status: "succeeded",
    };
    const booked = { ...row, refunded_cents: 500, status: "partially_refunded" };
    const admin = adminWithRpc(
      [{ data: { action: "settle", operation_id: "op_full" }, error: null }],
      { data: [row], error: null },
      { data: [booked], error: null }
    );
    stripeMocks.listRefunds.mockResolvedValue({
      data: [
        {
          id: "re_full_page",
          amount: 500,
          currency: "usd",
          status: "succeeded",
          metadata: { order_id: "order_1" },
        },
      ],
      has_more: false,
    });
    const charge = refundedCharge();

    await expect(applyChargeRefund(admin as never, charge)).resolves.toBe("committed");
    expect(stripeMocks.listRefunds).toHaveBeenCalledWith({ charge: "ch_1", limit: 100 });
    expect(admin.rpc).toHaveBeenCalledWith(
      "record_refund_provider_event",
      expect.objectContaining({ p_refund_reference: "re_full_page", p_amount_cents: 500 })
    );
    expect(paymentMocks.recordExternalRefund).not.toHaveBeenCalled();
  });

  it("retries instead of acknowledging when full refund pagination is unavailable", async () => {
    stripeMocks.listRefunds.mockRejectedValue(new Error("network timeout"));
    const charge = refundedCharge();
    await expect(applyChargeRefund(adminWith() as never, charge)).resolves.toBe("retry");
  });

  it("journals operation-backed and external refunds separately before ack", async () => {
    const before = {
      id: "pay_1",
      order_id: "order_1",
      amount_cents: 1_000,
      refunded_cents: 0,
      status: "succeeded",
    };
    const fullyApplied = { ...before, refunded_cents: 500, status: "partially_refunded" };
    const admin = adminWithRpc(
      [
        { data: { action: "settle", operation_id: "op_1" }, error: null },
        { data: { action: "settle", operation_id: "op_2" }, error: null },
      ],
      { data: [before], error: null },
      { data: [fullyApplied], error: null }
    );
    stripeMocks.listRefunds.mockResolvedValue({
      data: [
        { id: "re_operation", amount: 300, currency: "usd", status: "succeeded", metadata: { operation_id: "op_1" } },
        { id: "re_external", amount: 200, currency: "usd", status: "succeeded", metadata: { order_id: "order_1" } },
      ],
      has_more: false,
    });
    const charge = refundedCharge({ amount_refunded: 500 });

    await expect(applyChargeRefund(admin as never, charge)).resolves.toBe("committed");
    expect(admin.rpc.mock.calls.filter(([name]) => name === "record_refund_provider_event")).toHaveLength(2);
    expect(paymentMocks.runRefundOperation).toHaveBeenCalledTimes(2);
    expect(paymentMocks.recordExternalRefund).not.toHaveBeenCalled();
  });

  it("does not advance an operation whose immutable provider mapping mismatches", async () => {
    const payment = {
      id: "pay_1",
      order_id: "order_1",
      amount_cents: 1_000,
      refunded_cents: 0,
      status: "succeeded",
    };
    const admin = adminWithRpc(
      [{ data: { action: "recovery_recorded", reason: "operation_mismatch" }, error: null }],
      { data: [payment], error: null },
      { data: [payment], error: null }
    );
    stripeMocks.listRefunds.mockResolvedValue({
      data: [{ id: "re_1", amount: 300, currency: "usd", status: "succeeded", metadata: { operation_id: "op_other" } }],
      has_more: false,
    });
    const charge = refundedCharge();

    await expect(applyChargeRefund(admin as never, charge)).resolves.toBe("recovery_recorded");
    expect(paymentMocks.runRefundOperation).not.toHaveBeenCalled();
    // The payment lookup only: a refund already in recovery skips the gap check.
    expect(admin.from).toHaveBeenCalledTimes(1);
    expect(admin.rpc).not.toHaveBeenCalledWith("refund_gap_snapshot", expect.anything());
  });

  it("handles charge.refunded before the matching refund event without double settlement", async () => {
    const payment = {
      id: "pay_1",
      order_id: "order_1",
      amount_cents: 1_000,
      refunded_cents: 0,
      status: "succeeded",
    };
    const chargeAdmin = adminWithRpc(
      [{ data: { action: "settle", operation_id: "op_1" }, error: null }],
      { data: [payment], error: null },
      { data: [{ ...payment, refunded_cents: 300 }], error: null }
    );
    const listedRefund = {
      id: "re_1",
      amount: 300,
      currency: "usd",
      status: "succeeded",
      metadata: { operation_id: "op_1" },
    } as unknown as Stripe.Refund;
    stripeMocks.listRefunds.mockResolvedValue({ data: [listedRefund], has_more: false });
    const charge = refundedCharge({ amount_refunded: 300 });

    await expect(applyChargeRefund(chargeAdmin as never, charge)).resolves.toBe("committed");
    expect(paymentMocks.runRefundOperation).toHaveBeenCalledTimes(1);

    paymentMocks.runRefundOperation.mockClear();
    const directEvent = {
      id: "evt_refund_after_charge",
      created: 1_800_000_100,
      type: "refund.updated",
      data: { object: listedRefund },
    } as unknown as Stripe.Event;
    const replayAdmin = adminWithRpc([
      { data: { action: "committed", operation_id: "op_1", replayed: true }, error: null },
    ]);
    await expect(
      applyRefundLifecycleEvent(
        replayAdmin as never,
        directEvent,
        directEvent.data.object as Stripe.Refund
      )
    ).resolves.toBe("committed");
    expect(paymentMocks.runRefundOperation).not.toHaveBeenCalled();
  });

  it("handles the exact refund event before charge.refunded without double settlement", async () => {
    const refund = {
      id: "re_event_first",
      amount: 300,
      currency: "usd",
      status: "succeeded",
      payment_intent: "pi_1",
      metadata: {},
      created: 1_800_000_000,
    } as unknown as Stripe.Refund;
    const event = {
      id: "evt_refund_first",
      created: 1_800_000_010,
      type: "refund.updated",
      data: { object: refund },
    } as unknown as Stripe.Event;
    const directAdmin = adminWithRpc(
      [{ data: { action: "settle", operation_id: "op_event_first" }, error: null }],
      { data: [{ order_id: "order_1" }], error: null }
    );
    await expect(applyRefundLifecycleEvent(directAdmin as never, event, refund)).resolves.toBe(
      "committed"
    );

    paymentMocks.runRefundOperation.mockClear();
    const payment = {
      id: "pay_1",
      order_id: "order_1",
      amount_cents: 1_000,
      refunded_cents: 300,
      status: "partially_refunded",
    };
    const chargeAdmin = adminWithRpc(
      [{ data: { action: "committed", operation_id: "op_event_first" }, error: null }],
      { data: [payment], error: null },
      { data: [{ order_id: "order_1" }], error: null },
      { data: [payment], error: null }
    );
    stripeMocks.listRefunds.mockResolvedValue({ data: [refund], has_more: false });
    const charge = refundedCharge({ amount_refunded: 300 });
    await expect(applyChargeRefund(chargeAdmin as never, charge)).resolves.toBe("committed");
    expect(paymentMocks.runRefundOperation).not.toHaveBeenCalled();
  });

  it("requires recovery persistence before returning a recovery outcome", async () => {
    const admin = adminWith(
      { data: [], error: null },
      { data: null, error: { code: "08006" } }
    );
    await expect(applyChargeRefund(admin as never, refundedCharge())).rejects.toThrow(
      "refund recovery could not be persisted; retry required"
    );
  });

  it("returns retry for a lost dispute whose local mapping is not present yet", async () => {
    const admin = adminWith({ data: [], error: null });
    const dispute = { id: "dp_1", payment_intent: "pi_late", status: "lost" } as Stripe.Dispute;
    await expect(applyDisputeEvent(admin as never, dispute, true)).resolves.toBe("retry");
  });

  // Plan 2 item A2: opening a dispute and winning one are the database's
  // (apply_stripe_dispute_event); this function used to write the order's
  // status for both and no longer writes it at all.
  it.each([
    ["a dispute being opened", { id: "dp_open", payment_intent: "pi_1", reason: "fraudulent" }, false],
    ["a dispute that was won", { id: "dp_won", payment_intent: "pi_1", status: "won" }, true],
    ["a won dispute delivered as still open", { id: "dp_won", payment_intent: "pi_1", status: "won" }, false],
  ])("refuses %s without reading or writing anything (plan 2 A2)", async (_, dispute, closed) => {
    const admin = adminWith();
    await expect(applyDisputeEvent(admin as never, dispute as Stripe.Dispute, closed)).rejects.toThrow(
      "applyDisputeEvent books a lost dispute only"
    );
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("does not swallow a requires-action write failure", async () => {
    const admin = adminWith({ data: null, error: { code: "08006" } });
    await expect(
      markRequiresAction(admin as never, { id: "pi_1" } as Stripe.PaymentIntent)
    ).rejects.toThrow("requires-action transition failed; retry required");
  });

  it("does not acknowledge a failed account capability sync", async () => {
    const admin = adminWith({ data: null, error: { code: "08006" } });
    await expect(
      applyAccountUpdate(
        admin as never,
        { id: "acct_1", payouts_enabled: true } as Stripe.Account
      )
    ).rejects.toThrow("failed to sync payouts_enabled; retry required");
  });

  it("does not acknowledge when unblocking a payable seller fails", async () => {
    const admin = adminWith(
      { data: [{ id: "seller_1" }], error: null },
      { data: null, error: { code: "08006" } }
    );
    await expect(
      applyAccountUpdate(
        admin as never,
        { id: "acct_1", payouts_enabled: true } as Stripe.Account
      )
    ).rejects.toThrow("payable seller transfer unblock failed; retry required");
  });

  it("stores setup started (details submitted) with payouts still off (N244, 20261108100000)", async () => {
    const admin = adminWith({ data: [{ id: "seller_1" }], error: null });
    await expect(
      applyAccountUpdate(
        admin as never,
        { id: "acct_1", payouts_enabled: false, details_submitted: true } as Stripe.Account
      )
    ).resolves.toBe("committed");
    const sync = admin.from.mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>;
    expect(sync.update).toHaveBeenCalledWith({ payouts_enabled: false, payout_details_submitted: true });
    // Nothing to release: the money still waits for payouts enabled.
    expect(admin.from).toHaveBeenCalledTimes(1);
  });

  it("releases a payable seller's parked payouts at once, restricted-account backoff included (N8)", async () => {
    const admin = adminWith({ data: [{ id: "seller_1" }], error: null }, { data: [], error: null });
    await expect(
      applyAccountUpdate(admin as never, { id: "acct_1", payouts_enabled: true } as Stripe.Account)
    ).resolves.toBe("committed");
    const unblock = admin.from.mock.results[1].value as Record<string, ReturnType<typeof vi.fn>>;
    expect(unblock.update).toHaveBeenCalledWith({ status: "ready", last_error: null, next_attempt_at: null });
    expect(unblock.eq).toHaveBeenCalledWith("status", "blocked_unpayable");
  });
});

describe("refund lifecycle dispatch", () => {
  const orderId = "11111111-1111-4111-8111-111111111111";
  const operationId = "22222222-2222-4222-8222-222222222222";

  function lifecycleEvent(id: string, status: string): Stripe.Event {
    return {
      id,
      created: 1_800_000_000,
      type: status === "failed" ? "refund.failed" : "refund.updated",
      data: {
        object: {
          id: "re_async",
          object: "refund",
          amount: 700,
          currency: "usd",
          status,
          payment_intent: "pi_async",
          metadata: { order_id: orderId, operation_id: operationId },
          balance_transaction: status === "succeeded" ? "txn_refund" : null,
          failure_balance_transaction: status === "failed" ? "txn_restore" : null,
          failure_reason: status === "failed" ? "insufficient_funds" : undefined,
          pending_reason: status === "pending" ? "processing" : undefined,
        },
      },
    } as unknown as Stripe.Event;
  }

  it("durably retains pending identity without settling local effects", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { action: "pending", operation_id: operationId },
      error: null,
    });
    const event = lifecycleEvent("evt_pending", "pending");

    await expect(
      applyRefundLifecycleEvent({ rpc } as never, event, event.data.object as Stripe.Refund)
    ).resolves.toBe("committed");
    expect(paymentMocks.runRefundOperation).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "record_refund_provider_event",
      expect.objectContaining({
        p_event_id: "evt_pending",
        p_refund_reference: "re_async",
        p_operation_id: operationId,
        p_order_id: orderId,
        p_amount_cents: 700,
        p_currency: "usd",
        p_provider_status: "pending",
      })
    );
  });

  it("settles only after a succeeded lifecycle event", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { action: "settle", operation_id: operationId },
      error: null,
    });
    paymentMocks.runRefundOperation.mockResolvedValueOnce({ ok: true });
    const event = lifecycleEvent("evt_succeeded", "succeeded");

    await expect(
      applyRefundLifecycleEvent({ rpc } as never, event, event.data.object as Stripe.Refund)
    ).resolves.toBe("committed");
    expect(paymentMocks.runRefundOperation).toHaveBeenCalledWith(expect.anything(), operationId);
  });

  it("acknowledges a later failure only after its recovery is committed", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { action: "recovery_recorded", operation_id: operationId, compensated: true },
      error: null,
    });
    const event = lifecycleEvent("evt_failed", "failed");

    await expect(
      applyRefundLifecycleEvent({ rpc } as never, event, event.data.object as Stripe.Refund)
    ).resolves.toBe("recovery_recorded");
    expect(paymentMocks.runRefundOperation).not.toHaveBeenCalled();
  });

  it("does not acknowledge a lifecycle event when the atomic receipt write fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "connection lost" } });
    const event = lifecycleEvent("evt_lost", "succeeded");

    await expect(
      applyRefundLifecycleEvent({ rpc } as never, event, event.data.object as Stripe.Refund)
    ).rejects.toThrow("refund lifecycle event was not committed; retry required");
    expect(paymentMocks.runRefundOperation).not.toHaveBeenCalled();
  });

  it("routes malformed local metadata to recovery instead of adopting by refund id", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { action: "recovery_recorded", reason: "unknown_operation" },
      error: null,
    });
    const event = lifecycleEvent("evt_bad_metadata", "succeeded");
    const object = event.data.object as Stripe.Refund;
    object.metadata = { operation_id: "not-a-uuid", order_id: "also-invalid" };

    await expect(applyRefundLifecycleEvent({ rpc } as never, event, object)).resolves.toBe(
      "recovery_recorded"
    );
    expect(rpc).toHaveBeenCalledWith(
      "record_refund_provider_event",
      expect.objectContaining({
        p_operation_id: "00000000-0000-4000-8000-000000000000",
        p_order_id: null,
      })
    );
    expect(paymentMocks.runRefundOperation).not.toHaveBeenCalled();
  });
});

describe("webhook claim and completion", () => {
  const event = { id: "evt_1", type: "charge.refunded" } as Stripe.Event;

  it("does not process a duplicate when its existing claim cannot be read", async () => {
    const admin = adminWith(
      { data: null, error: { code: "23505" } },
      { data: null, error: { code: "08006" } }
    );
    await expect(claimWebhookEvent(admin as never, event)).rejects.toThrow("retry required");
  });

  it("rejects a claim insert that reports success without an affected row", async () => {
    const admin = adminWith({ data: null, error: null });
    await expect(claimWebhookEvent(admin as never, event)).rejects.toThrow(
      "webhook claim did not persist a row; retry required"
    );
  });

  it("rejects a processed marker that affected no event", async () => {
    const admin = adminWith({ data: [], error: null });
    await expect(markWebhookEventProcessed(admin as never, event.id)).rejects.toThrow(
      "Webhook completion could not be persisted"
    );
  });
});

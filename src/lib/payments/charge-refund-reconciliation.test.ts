import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import { STRIPE_API_VERSION } from "./stripe-api-version";

/**
 * N105: `charge.refunded` on the pinned API version. The Charge in the event
 * has no `refunds` list, so the handler enumerates refunds through
 * `refunds.list({ charge })`, journals each one, and only opens an
 * "unattributed refund" case for money that no local refund accounts for —
 * neither booked nor still being booked by its own operation. Deliveries can
 * arrive in any order, so the event's charge snapshot is never the measure.
 */

const mocks = vi.hoisted(() => ({
  listRefunds: vi.fn(),
  runRefundOperation: vi.fn(),
  sendAdminAlert: vi.fn(),
}));
vi.mock("./refunds", () => ({ recordExternalRefund: vi.fn(), runRefundOperation: mocks.runRefundOperation }));
vi.mock("@/lib/admin/alerts", () => ({ sendAdminAlert: mocks.sendAdminAlert }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("./stripe", () => ({ stripeClient: () => ({ refunds: { list: mocks.listRefunds } }) }));

import { applyChargeRefund, dispatchStripeEvent } from "./settlement";

type Rows = { data: unknown; error: unknown };

/** A Supabase stand-in answering by table, in call order per table. */
function fakeAdmin(tables: Record<string, Rows[]>, rpcAnswers: Rows[] = []) {
  const calls: { table: string; filters: unknown[][] }[] = [];
  const upserts: unknown[] = [];
  const from = vi.fn((table: string) => {
    const queue = tables[table];
    const answer = queue?.shift();
    if (!answer) throw new Error(`Unexpected query on ${table}`);
    const call = { table, filters: [] as unknown[][] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is"]) {
      builder[method] = vi.fn((...args: unknown[]) => {
        call.filters.push([method, ...args]);
        return builder;
      });
    }
    builder.upsert = vi.fn((value: unknown) => {
      upserts.push(value);
      return builder;
    });
    builder.maybeSingle = vi.fn(async () => answer);
    builder.then = (resolve: (value: Rows) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(answer).then(resolve, reject);
    return builder;
  });
  const rpc = vi.fn(async () => {
    const answer = rpcAnswers.shift();
    if (!answer) throw new Error("Unexpected RPC");
    return answer;
  });
  return { admin: { from, rpc } as never, from, rpc, calls, upserts };
}

/** A charge.refunded event exactly as the pinned version delivers it. */
function chargeRefundedEvent(charge: Partial<Stripe.Charge> = {}): Stripe.Event {
  return {
    id: "evt_charge_refunded",
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: 1_800_000_500,
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_current",
        object: "charge",
        amount: 10_000,
        amount_captured: 10_000,
        amount_refunded: 3_000,
        currency: "usd",
        payment_intent: "pi_current",
        refunded: false,
        ...charge,
      },
    },
  } as unknown as Stripe.Event;
}

function refund(id: string, amount: number, status: string, metadata: Record<string, string> = {}) {
  return { id, object: "refund", amount, currency: "usd", status, payment_intent: "pi_current", metadata, created: 1_800_000_400 };
}

const payment = (refunded: number) => ({
  id: "pay_1",
  order_id: "11111111-1111-4111-8111-111111111111",
  amount_cents: 10_000,
  refunded_cents: refunded,
  status: refunded ? "partially_refunded" : "succeeded",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runRefundOperation.mockResolvedValue({ ok: true });
  mocks.sendAdminAlert.mockResolvedValue(undefined);
});

describe("charge.refunded on the pinned API version", () => {
  it("has no refund list on the charge, so refunds come from refunds.list", () => {
    const charge = chargeRefundedEvent().data.object as Stripe.Charge;
    expect("refunds" in charge).toBe(false);
  });

  it("journals every listed refund and acknowledges once the ledger has them", async () => {
    mocks.listRefunds.mockResolvedValue({
      data: [refund("re_app", 3_000, "succeeded", { operation_id: "22222222-2222-4222-8222-222222222222" })],
      has_more: false,
    });
    const { admin, rpc } = fakeAdmin(
      { payments: [{ data: [payment(0)], error: null }, { data: [payment(3_000)], error: null }] },
      [{ data: { action: "settle", operation_id: "22222222-2222-4222-8222-222222222222" }, error: null }]
    );

    await expect(dispatchStripeEvent(admin, chargeRefundedEvent())).resolves.toBe("committed");
    expect(mocks.listRefunds).toHaveBeenCalledWith({ charge: "ch_current", limit: 100 });
    expect(rpc).toHaveBeenCalledWith(
      "record_refund_provider_event",
      expect.objectContaining({ p_event_id: "evt_charge_refunded:refund:re_app", p_refund_reference: "re_app" })
    );
    expect(mocks.runRefundOperation).toHaveBeenCalledTimes(1);
    expect(mocks.sendAdminAlert).not.toHaveBeenCalled();
  });

  it("pages through refunds.list", async () => {
    mocks.listRefunds
      .mockResolvedValueOnce({ data: [refund("re_a", 1_000, "succeeded", { order_id: payment(0).order_id })], has_more: true })
      .mockResolvedValueOnce({ data: [refund("re_b", 2_000, "succeeded", { order_id: payment(0).order_id })], has_more: false });
    const { admin } = fakeAdmin(
      { payments: [{ data: [payment(0)], error: null }, { data: [payment(3_000)], error: null }] },
      [
        { data: { action: "settle", operation_id: "op_a" }, error: null },
        { data: { action: "settle", operation_id: "op_b" }, error: null },
      ]
    );
    await expect(applyChargeRefund(admin, chargeRefundedEvent().data.object as Stripe.Charge)).resolves.toBe("committed");
    expect(mocks.listRefunds).toHaveBeenNthCalledWith(2, { charge: "ch_current", limit: 100, starting_after: "re_a" });
  });

  it("does not open a case for a refund its own operation is still booking", async () => {
    // The app's refund succeeded at Stripe; its operation is applying effects
    // (refunded_cents not booked yet) when charge.refunded lands.
    mocks.listRefunds.mockResolvedValue({ data: [refund("re_app", 3_000, "succeeded", { operation_id: "op_app" })], has_more: false });
    mocks.runRefundOperation.mockResolvedValue({ ok: true });
    const { admin, calls } = fakeAdmin(
      {
        payments: [{ data: [payment(0)], error: null }, { data: [payment(0)], error: null }],
        refund_operations: [
          { data: [{ refund_reference: "re_app", amount_cents: 3_000, status: "effects_pending", effects_completed_at: null }], error: null },
        ],
      },
      [{ data: { action: "settle", operation_id: "op_app" }, error: null }]
    );

    await expect(applyChargeRefund(admin, chargeRefundedEvent().data.object as Stripe.Charge)).resolves.toBe("committed");
    expect(calls.find((c) => c.table === "refund_operations")?.filters).toContainEqual(["in", "refund_reference", ["re_app"]]);
    expect(mocks.sendAdminAlert).not.toHaveBeenCalled();
  });

  it("opens a case for only the cents no local refund accounts for", async () => {
    mocks.listRefunds.mockResolvedValue({
      data: [
        refund("re_app", 3_000, "succeeded", { operation_id: "op_app" }),
        refund("re_dashboard", 1_500, "succeeded"),
      ],
      has_more: false,
    });
    const { admin, upserts } = fakeAdmin(
      {
        payments: [{ data: [{ order_id: payment(0).order_id }], error: null }, { data: [payment(0)], error: null }, { data: [payment(0)], error: null }],
        refund_operations: [
          { data: [{ refund_reference: "re_app", amount_cents: 3_000, status: "provider_succeeded", effects_completed_at: null }], error: null },
        ],
        payment_recoveries: [{ data: { id: "case_1" }, error: null }],
      },
      [
        { data: { action: "settle", operation_id: "op_app" }, error: null },
        { data: { action: "committed", operation_id: "op_dash" }, error: null },
      ]
    );

    await expect(applyChargeRefund(admin, chargeRefundedEvent({ amount_refunded: 4_500 }).data.object as Stripe.Charge)).resolves.toBe(
      "recovery_recorded"
    );
    expect(upserts).toEqual([expect.objectContaining({ kind: "partial_refund_unattributed", amount_cents: 1_500 })]);
  });

  it("does not count a booked operation as still in flight", async () => {
    mocks.listRefunds.mockResolvedValue({ data: [refund("re_app", 3_000, "succeeded")], has_more: false });
    const { admin, upserts } = fakeAdmin(
      {
        payments: [{ data: [{ order_id: payment(0).order_id }], error: null }, { data: [payment(0)], error: null }, { data: [payment(0)], error: null }],
        refund_operations: [
          { data: [{ refund_reference: "re_app", amount_cents: 3_000, status: "completed", effects_completed_at: "2026-11-07T10:00:00Z" }], error: null },
        ],
        payment_recoveries: [{ data: { id: "case_1" }, error: null }],
      },
      [{ data: { action: "committed", operation_id: "op_app" }, error: null }]
    );
    await expect(applyChargeRefund(admin, chargeRefundedEvent().data.object as Stripe.Charge)).resolves.toBe("recovery_recorded");
    expect(upserts).toEqual([expect.objectContaining({ amount_cents: 3_000 })]);
  });
});

describe("charge.refunded delivered out of order", () => {
  it("arriving before refund.created still journals the refund (no case)", async () => {
    mocks.listRefunds.mockResolvedValue({ data: [refund("re_first", 3_000, "succeeded", { operation_id: "op_first" })], has_more: false });
    const { admin, rpc } = fakeAdmin(
      { payments: [{ data: [payment(0)], error: null }, { data: [payment(3_000)], error: null }] },
      [{ data: { action: "settle", operation_id: "op_first" }, error: null }]
    );
    await expect(dispatchStripeEvent(admin, chargeRefundedEvent())).resolves.toBe("committed");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(mocks.sendAdminAlert).not.toHaveBeenCalled();
  });

  it("an old snapshot counting a refund that later failed opens no case", async () => {
    // The event's charge was taken while re_failed was pending (counted in
    // amount_refunded); by delivery it has failed. Only re_ok succeeded.
    mocks.listRefunds.mockResolvedValue({
      data: [refund("re_failed", 2_000, "failed", { operation_id: "op_failed" }), refund("re_ok", 1_000, "succeeded", { operation_id: "op_ok" })],
      has_more: false,
    });
    const { admin } = fakeAdmin(
      { payments: [{ data: [payment(1_000)], error: null }, { data: [payment(1_000)], error: null }] },
      [
        { data: { action: "committed", operation_id: "op_failed" }, error: null },
        { data: { action: "committed", operation_id: "op_ok" }, error: null },
      ]
    );
    await expect(applyChargeRefund(admin, chargeRefundedEvent({ amount_refunded: 3_000 }).data.object as Stripe.Charge)).resolves.toBe("committed");
    expect(mocks.sendAdminAlert).not.toHaveBeenCalled();
  });

  it("a pending refund counted in amount_refunded opens no case", async () => {
    mocks.listRefunds.mockResolvedValue({
      data: [refund("re_ok", 1_000, "succeeded", { operation_id: "op_ok" }), refund("re_pending", 2_000, "pending", { operation_id: "op_pending" })],
      has_more: false,
    });
    const { admin } = fakeAdmin(
      { payments: [{ data: [payment(1_000)], error: null }, { data: [payment(1_000)], error: null }] },
      [
        { data: { action: "committed", operation_id: "op_ok" }, error: null },
        { data: { action: "pending", operation_id: "op_pending" }, error: null },
      ]
    );
    await expect(applyChargeRefund(admin, chargeRefundedEvent({ amount_refunded: 3_000 }).data.object as Stripe.Charge)).resolves.toBe("committed");
  });

  it("an older snapshot delivered after a newer refund was booked opens no case", async () => {
    mocks.listRefunds.mockResolvedValue({
      data: [refund("re_second", 2_000, "succeeded", { operation_id: "op_2" }), refund("re_first", 1_000, "succeeded", { operation_id: "op_1" })],
      has_more: false,
    });
    const { admin } = fakeAdmin(
      { payments: [{ data: [payment(3_000)], error: null }, { data: [payment(3_000)], error: null }] },
      [
        { data: { action: "committed", operation_id: "op_2", replayed: true }, error: null },
        { data: { action: "committed", operation_id: "op_1", replayed: true }, error: null },
      ]
    );
    await expect(applyChargeRefund(admin, chargeRefundedEvent({ amount_refunded: 1_000 }).data.object as Stripe.Charge)).resolves.toBe("committed");
  });

  it("retries, never half-reads, when the list can't be completed", async () => {
    mocks.listRefunds.mockResolvedValue({ data: [], has_more: true });
    const { admin, rpc } = fakeAdmin({});
    await expect(applyChargeRefund(admin, chargeRefundedEvent().data.object as Stripe.Charge)).resolves.toBe("retry");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("retries when an in-flight refund can't be checked", async () => {
    mocks.listRefunds.mockResolvedValue({ data: [refund("re_app", 3_000, "succeeded")], has_more: false });
    const { admin } = fakeAdmin(
      {
        payments: [{ data: [{ order_id: payment(0).order_id }], error: null }, { data: [payment(0)], error: null }, { data: [payment(0)], error: null }],
        refund_operations: [{ data: null, error: { code: "08006" } }],
      },
      [{ data: { action: "committed", operation_id: "op_app" }, error: null }]
    );
    await expect(applyChargeRefund(admin, chargeRefundedEvent().data.object as Stripe.Charge)).rejects.toThrow(
      "in-flight refund lookup failed; retry required"
    );
    expect(mocks.sendAdminAlert).not.toHaveBeenCalled();
  });
});

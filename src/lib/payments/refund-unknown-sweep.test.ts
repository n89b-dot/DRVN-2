import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real resume sweep (resumeIncompleteRefunds → runRefundOperation →
 * ensureProviderRefund) against one in-memory refund_operations row and a
 * fake provider. Only the provider's answer is scripted: a confirmed
 * Stripe-side wait is `awaitingProvider`; an unknown outcome, however often
 * it repeats, stays `retrying` so the refunds family fails (N391 review).
 */

const providerRefund = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/admin/alerts", () => ({ sendAdminAlert: vi.fn() }));
vi.mock("./provider", () => ({ getPaymentProvider: () => ({ refund: providerRefund }) }));
// No Stripe key: the sweep goes straight to the keyed provider call.
vi.mock("./stripe", () => ({ stripeSecretKey: () => null, stripeClient: () => { throw new Error("no Stripe in this test"); }, mapStripeRefundResult: vi.fn() }));
vi.mock("./reversal-recovery", () => ({ recoverTransferReversal: vi.fn() }));

import { resumeIncompleteRefunds } from "./refunds";

const OPERATION = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const ORDER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
type Row = Record<string, unknown>;
let row: Row;

/** refund_operations as PostgREST would answer the sweep's three shapes. */
function fakeAdmin() {
  return {
    rpc,
    from(table: string) {
      if (table !== "refund_operations") throw new Error(`unexpected table ${table}`);
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.update = (fields: Row) => { patch = fields; return builder; };
      builder.eq = (column: string, value: unknown) => { filters.push((r) => r[column] === value); return builder; };
      builder.in = (column: string, values: unknown[]) => { filters.push((r) => values.includes(r[column])); return builder; };
      builder.lt = (column: string, value: string) => { filters.push((r) => String(r[column]) < value); return builder; };
      builder.or = (filter: string) => {
        const due = /^next_attempt_at\.is\.null,next_attempt_at\.lte\.(.+)$/.exec(filter)!;
        filters.push((r) => r.next_attempt_at === null || String(r.next_attempt_at) <= due[1]);
        return builder;
      };
      builder.order = () => builder;
      builder.limit = () => builder;
      const matched = () => filters.every((f) => f(row));
      const apply = () => {
        if (!matched()) return [];
        if (patch) row = { ...row, ...patch };
        return [row];
      };
      builder.maybeSingle = async () => ({ data: matched() ? row : null, error: null });
      builder.then = (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: apply(), error: null });
      return builder;
    },
  } as never;
}

/** Time passes: the backoff ends and the row is old enough to resume. */
const letTimePass = () => { row = { ...row, next_attempt_at: null, updated_at: new Date(Date.now() - 60 * 60_000).toISOString() }; };

beforeEach(() => {
  providerRefund.mockReset();
  rpc.mockReset();
  row = {
    id: OPERATION, order_id: ORDER, payment_reference: "pi_sweep", amount_cents: 2500, currency: "usd",
    reason: "sweep test", requested_by: "admin:test", idempotency_key: `refund:${OPERATION}`,
    refund_reference: null, reversal_reference: null, reversal_due_cents: null, status: "requested",
    external: false, attempts: 0, recovery_id: null, provider_status: null,
    replacement_transfer_reference: null, replaces_adjustment_id: null,
    next_attempt_at: null, updated_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  };
});

describe("resumeIncompleteRefunds with an uncertain provider", () => {
  it("keeps counting repeated unknown outcomes as retrying, never as awaiting the provider", async () => {
    providerRefund.mockResolvedValue({ status: "unknown", reason: "provider timed out" });
    for (let pass = 1; pass <= 3; pass += 1) {
      const summary = await resumeIncompleteRefunds(fakeAdmin(), { batch: 3 });
      expect(summary, `pass ${pass}`).toEqual({ scanned: 1, completed: 0, retrying: 1, awaitingProvider: 0 });
      expect(row.status).toBe("provider_pending");
      expect(row.attempts).toBe(pass);
      // Each retry pushes the next attempt out — which is why health must not
      // rely on next_attempt_at to age this row.
      expect(Date.parse(String(row.next_attempt_at))).toBeGreaterThan(Date.now());
      letTimePass();
    }
    expect(providerRefund).toHaveBeenCalledTimes(3);
    // Same idempotency key every time: retrying never risks a second refund.
    expect(new Set(providerRefund.mock.calls.map((call) => call[2].idempotencyKey))).toEqual(new Set([`refund:${OPERATION}`]));
  });

  it("counts a provider throw as retrying too", async () => {
    providerRefund.mockRejectedValue(new Error("socket hang up"));
    const summary = await resumeIncompleteRefunds(fakeAdmin(), { batch: 3 });
    expect(summary).toEqual({ scanned: 1, completed: 0, retrying: 1, awaitingProvider: 0 });
  });

  it("counts a refund Stripe reports as pending as awaiting the provider", async () => {
    providerRefund.mockResolvedValue({
      status: "pending", reference: "re_sweep", amountCents: 2500, currency: "usd", createdAt: 1_700_000_000,
      paymentReference: "pi_sweep", operationId: OPERATION, orderId: ORDER,
    });
    rpc.mockResolvedValue({ data: { action: "pending", operation_id: OPERATION }, error: null });
    const summary = await resumeIncompleteRefunds(fakeAdmin(), { batch: 3 });
    expect(summary).toEqual({ scanned: 1, completed: 0, retrying: 0, awaitingProvider: 1 });
    expect(rpc).toHaveBeenCalledWith("record_refund_provider_event", expect.objectContaining({ p_refund_reference: "re_sweep" }));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N111: the dispute SLA sweep (dispute-sla.ts). Day 4: one alert per
 * dispute, stamped only after the alert is durably queued. Day 10: an
 * unanswered in-app dispute is refunded through the one refund path —
 * never a bank chargeback, never while a return is open — and a refusal is
 * counted and alerted, not swallowed.
 */

const mocks = vi.hoisted(() => ({
  refundOrder: vi.fn(),
  orderHasActiveReturn: vi.fn(),
  sendAdminAlert: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock("./refunds", () => ({ refundOrder: mocks.refundOrder }));
vi.mock("@/features/commerce/disputes", () => ({ AUTO_REFUND_AFTER_DAYS: 10 }));
vi.mock("@/features/commerce/returns", () => ({ orderHasActiveReturn: mocks.orderHasActiveReturn }));
vi.mock("@/lib/admin/alerts", () => ({ sendAdminAlert: mocks.sendAdminAlert }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

import { processDisputeSla } from "./dispute-sla";

type Result = { data: unknown; error: unknown };
const DAY = 86_400_000;

/**
 * orders reads in the order dispute-sla makes them: the day-4 breach list,
 * then the day-10 stale list. Every write is recorded with its filters.
 */
function fakeAdmin(reads: { breached?: unknown[]; stale?: unknown[]; readError?: unknown; touchError?: unknown }) {
  const events: string[] = [];
  const reads_: { filters: unknown[][] }[] = [];
  const writes: { value: unknown; filters: unknown[][] }[] = [];
  let readIndex = 0;
  const from = vi.fn(() => {
    const filters: unknown[][] = [];
    let write: unknown = null;
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "lt", "order", "limit"]) {
      builder[method] = vi.fn((...args: unknown[]) => {
        filters.push([method, ...args]);
        return builder;
      });
    }
    builder.update = vi.fn((value: unknown) => {
      write = value;
      return builder;
    });
    const settle = async (): Promise<Result> => {
      if (write) {
        writes.push({ value: write, filters });
        events.push(`write:${JSON.stringify(write).includes("dispute_sla_alerted_at") ? "stamp" : "touch"}`);
        const error = !JSON.stringify(write).includes("dispute_sla_alerted_at") ? reads.touchError ?? null : null;
        return { data: null, error };
      }
      reads_.push({ filters });
      const which = readIndex++ === 0 ? reads.breached : reads.stale;
      return { data: which ?? [], error: reads.readError ?? null };
    };
    builder.throwOnError = vi.fn(() => ({
      then: (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
        settle().then((result) => {
          if (result.error) throw result.error;
          return result;
        }).then(resolve, reject),
    }));
    builder.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject);
    return builder;
  });
  return { admin: { from } as never, events, reads: reads_, writes };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refundOrder.mockResolvedValue({ ok: true });
  mocks.orderHasActiveReturn.mockResolvedValue(false);
  mocks.sendAdminAlert.mockImplementation(async () => undefined);
});

describe("day 4: the SLA alert", () => {
  it("alerts each newly breached dispute once, and stamps it only after the alert is queued", async () => {
    const { admin, events, writes } = fakeAdmin({
      breached: [{ id: "o1", total_cents: 5000, dispute_category: "item_not_as_described", disputed_at: new Date(Date.now() - 5 * DAY).toISOString() }],
    });
    mocks.sendAdminAlert.mockImplementation(async () => {
      events.push("alert");
    });
    await expect(processDisputeSla(admin)).resolves.toMatchObject({ slaAlerts: 1, autoRefunded: 0 });
    expect(mocks.sendAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "dispute_over_sla", orderId: "o1", dedupKey: "dispute_over_sla:o1", title: expect.stringContaining("5d") })
    );
    expect(events).toEqual(["alert", "write:stamp"]);
    expect(writes[0].filters).toContainEqual(["eq", "id", "o1"]);
  });

  it("leaves the dispute unstamped when the alert can't be queued, so the next pass tries again", async () => {
    const { admin, writes } = fakeAdmin({ breached: [{ id: "o1", total_cents: 5000, dispute_category: null, disputed_at: null }] });
    mocks.sendAdminAlert.mockRejectedValue(new Error("outbox unavailable"));
    await expect(processDisputeSla(admin)).rejects.toThrow("outbox unavailable");
    expect(writes).toEqual([]);
    expect(mocks.refundOrder).not.toHaveBeenCalled();
  });

  it("asks only for disputed, unstamped orders older than four days", async () => {
    const { admin, reads } = fakeAdmin({});
    await processDisputeSla(admin);
    expect(reads[0].filters).toEqual(expect.arrayContaining([["eq", "status", "disputed"], ["is", "dispute_sla_alerted_at", null], ["limit", 5]]));
    const cutoff = reads[0].filters.find(([m, c]) => m === "lt" && c === "disputed_at")![2] as string;
    expect(Date.now() - Date.parse(cutoff)).toBeGreaterThanOrEqual(4 * DAY - 1000);
  });
});

describe("day 10: the automatic refund", () => {
  it("refunds an ignored in-app dispute through the one refund path", async () => {
    const { admin, reads } = fakeAdmin({ stale: [{ id: "o1" }] });
    await expect(processDisputeSla(admin)).resolves.toMatchObject({ autoRefunded: 1, failed: 0 });
    expect(mocks.refundOrder).toHaveBeenCalledWith(admin, {
      orderId: "o1",
      reason: "Auto-refund: dispute unanswered for 10 days (SLA)",
      initiator: { kind: "dispute_sla" },
      resolveDispute: true,
    });
    // Never a bank chargeback (Stripe refuses refunds on a disputed charge),
    // never one with a live refund offer.
    expect(reads[1].filters).toEqual(
      expect.arrayContaining([["eq", "status", "disputed"], ["is", "refund_offered_at", null], ["is", "stripe_dispute_id", null]])
    );
  });

  it("waits while a return is open: its own deadlines govern", async () => {
    mocks.orderHasActiveReturn.mockResolvedValue(true);
    const { admin, writes } = fakeAdmin({ stale: [{ id: "o1" }] });
    await expect(processDisputeSla(admin)).resolves.toMatchObject({ autoRefunded: 0, failed: 0 });
    expect(mocks.refundOrder).not.toHaveBeenCalled();
    // Rotated to the back of the queue so it can't block the others.
    expect(writes).toHaveLength(1);
  });

  it("counts and alerts a refused refund, and carries on with the next dispute", async () => {
    mocks.refundOrder
      .mockResolvedValueOnce({ ok: false, error: "The refund could not be started — try again." })
      .mockResolvedValueOnce({ ok: true });
    const { admin } = fakeAdmin({ stale: [{ id: "o1" }, { id: "o2" }] });
    await expect(processDisputeSla(admin)).resolves.toMatchObject({ autoRefunded: 1, failed: 1 });
    expect(mocks.sendAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "dispute_auto_refund_failed", orderId: "o1", dedupKey: "dispute_auto_refund_failed:o1" })
    );
    expect(mocks.reportError).toHaveBeenCalledWith("[dispute-sla] auto-refund failed", expect.objectContaining({ orderId: "o1" }));
  });

  it("a dispute resolved between the read and the refund is refused by the refund path, not refunded twice", async () => {
    // Two passes race: the second sees the order already refunded.
    mocks.refundOrder.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "This order is already refunded." });
    const first = fakeAdmin({ stale: [{ id: "o1" }] });
    const second = fakeAdmin({ stale: [{ id: "o1" }] });
    const [a, b] = await Promise.all([processDisputeSla(first.admin), processDisputeSla(second.admin)]);
    expect(a.autoRefunded + b.autoRefunded).toBe(1);
    expect(a.failed + b.failed).toBe(1);
  });

  it("fails the pass, refunding nothing, when the queue can't be read", async () => {
    const { admin } = fakeAdmin({ readError: new Error("database unavailable") });
    await expect(processDisputeSla(admin)).rejects.toThrow("database unavailable");
    expect(mocks.refundOrder).not.toHaveBeenCalled();
  });

  it("refunds nothing when the rotation write fails", async () => {
    const { admin } = fakeAdmin({ stale: [{ id: "o1" }], touchError: new Error("write failed") });
    await expect(processDisputeSla(admin)).rejects.toThrow("write failed");
    expect(mocks.refundOrder).not.toHaveBeenCalled();
  });
});

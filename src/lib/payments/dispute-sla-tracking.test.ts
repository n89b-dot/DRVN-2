import { beforeEach, expect, it, vi } from "vitest";

/**
 * N6 (20261107210300): adding valid tracking is the seller's answer to a
 * not-received case, so the day-10 silence auto-refund leaves it to support.
 */

const mocks = vi.hoisted(() => ({
  refundOrder: vi.fn(),
  orderHasActiveReturn: vi.fn(),
  sendAdminAlert: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock("./refunds", () => ({ refundOrder: mocks.refundOrder }));
vi.mock("@/features/commerce/returns", () => ({ orderHasActiveReturn: mocks.orderHasActiveReturn }));
vi.mock("@/lib/admin/alerts", () => ({ sendAdminAlert: mocks.sendAdminAlert }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

import { processDisputeSla } from "./dispute-sla";

function fakeAdmin(stale: unknown[], tracked: { data: unknown; error: unknown }) {
  let read = 0;
  const from = vi.fn(() => {
    let writing = false;
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "lt", "order", "limit"]) builder[method] = vi.fn(() => builder);
    builder.update = vi.fn(() => {
      writing = true;
      return builder;
    });
    builder.throwOnError = vi.fn(async () => {
      if (writing) return { data: null, error: null };
      return { data: read++ === 0 ? [] : stale, error: null };
    });
    return builder;
  });
  return { from, rpc: vi.fn(async () => tracked) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.orderHasActiveReturn.mockResolvedValue(false);
  mocks.refundOrder.mockResolvedValue({ ok: true });
});

it("leaves a not-received case with valid tracking to support", async () => {
  const admin = fakeAdmin([{ id: "order-1", dispute_category: "item_not_received" }], { data: true, error: null });
  await expect(processDisputeSla(admin as never)).resolves.toMatchObject({ autoRefunded: 0, failed: 0 });
  expect(admin.rpc).toHaveBeenCalledWith("order_has_valid_tracking", { p_order: "order-1" });
  expect(mocks.refundOrder).not.toHaveBeenCalled();
});

it("treats an unanswerable tracking check as answered, never refunding on a guess", async () => {
  const admin = fakeAdmin([{ id: "order-1", dispute_category: "item_not_received" }], { data: null, error: { message: "down" } });
  await expect(processDisputeSla(admin as never)).resolves.toMatchObject({ autoRefunded: 0 });
  expect(mocks.refundOrder).not.toHaveBeenCalled();
  expect(mocks.reportError).toHaveBeenCalled();
});

it("still refunds silence: no tracking, or any other category", async () => {
  const admin = fakeAdmin(
    [
      { id: "order-1", dispute_category: "item_not_received" },
      { id: "order-2", dispute_category: "counterfeit" },
    ],
    { data: false, error: null }
  );
  await expect(processDisputeSla(admin as never)).resolves.toMatchObject({ autoRefunded: 2 });
  expect(admin.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.refundOrder).toHaveBeenCalledTimes(2);
});

import { beforeEach, expect, it, vi } from "vitest";

/**
 * OS-W17 follow-up: "Finish checkout" from the cart resumes a signed-in
 * buyer's held cart checkout by its order, so it works on any device; the
 * page only resumes an order that is the buyer's own, live cart checkout.
 */

const mocks = vi.hoisted(() => ({
  orders: vi.fn(),
  attempt: vi.fn(),
  filters: [] as unknown[][],
  guestOrders: vi.fn(),
}));

function builder(result: () => unknown, single?: () => unknown) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "not", "contains"]) {
    query[method] = (...args: unknown[]) => {
      mocks.filters.push([method, ...args]);
      return query;
    };
  }
  query.maybeSingle = single;
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return query;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === "purchase_attempts" ? builder(() => null, mocks.attempt) : builder(mocks.orders),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/cart", () => ({ getCartIds: vi.fn() }));
vi.mock("@/lib/guest-checkout", () => ({ readGuestOrders: mocks.guestOrders }));

import { loadCheckoutResumeForOrder, loadOwnCheckoutHolds } from "./checkout-data";

const ORDER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.filters.length = 0;
  mocks.guestOrders.mockResolvedValue([]);
});

it("a signed-in buyer's held cart part finishes by its order; an accepted offer on its own page", async () => {
  mocks.orders.mockReturnValue({
    data: [
      { id: ORDER, origin_offer_id: null, order_items: [{ listing_id: "listing-1" }] },
      { id: "order-offer", origin_offer_id: "offer-1", order_items: [{ listing_id: "listing-2" }] },
    ],
    error: null,
  });

  const holds = await loadOwnCheckoutHolds("buyer-1");

  expect(holds.get("listing-1")).toBe(`/checkout?order=${ORDER}`);
  expect(holds.get("listing-2")).toBe("/orders/order-offer/checkout");
});

it("a guest's held part resumes from this device's own checkout", async () => {
  mocks.guestOrders.mockResolvedValue([ORDER]);
  mocks.orders.mockReturnValue({
    data: [{ id: ORDER, origin_offer_id: null, order_items: [{ listing_id: "listing-1" }] }],
    error: null,
  });

  expect((await loadOwnCheckoutHolds(null)).get("listing-1")).toBe("/checkout");
});

it("resumes an order only through the buyer's own bound cart checkout, with its live orders and details", async () => {
  mocks.attempt.mockResolvedValue({
    data: {
      checkout_context: {
        version: 1,
        shipping: { name: "Buyer One", line1: "10 Main Street", city: "Detroit", postcode: "48201", country: "US", isCollection: false },
        quoteIds: { "listing-1": "quote-1" },
      },
      result: { orders: [{ order_id: ORDER }], skipped: [] },
    },
    error: null,
  });
  mocks.orders.mockReturnValue({ data: [{ id: ORDER }], error: null });

  const resumed = await loadCheckoutResumeForOrder("buyer-1", ORDER);

  expect(mocks.filters).toContainEqual(["eq", "buyer_id", "buyer-1"]);
  expect(mocks.filters).toContainEqual(["not", "checkout_request_key", "is", null]);
  expect(mocks.filters).toContainEqual(["contains", "result", { orders: [{ order_id: ORDER }] }]);
  expect(resumed).toEqual({
    orderIds: [ORDER],
    resume: expect.objectContaining({
      shipping: expect.objectContaining({ line1: "10 Main Street" }),
      quoteIds: { "listing-1": "quote-1" },
    }),
  });
});

it("resumes nothing for a guest, a malformed order id, or an order that is no longer live", async () => {
  expect(await loadCheckoutResumeForOrder(null, ORDER)).toBeNull();
  expect(await loadCheckoutResumeForOrder("buyer-1", "not-an-order")).toBeNull();
  expect(mocks.attempt).not.toHaveBeenCalled();

  mocks.attempt.mockResolvedValue({
    data: { checkout_context: { version: 1, shipping: {}, quoteIds: {} }, result: { orders: [{ order_id: ORDER }] } },
    error: null,
  });
  mocks.orders.mockReturnValue({ data: [], error: null });
  expect(await loadCheckoutResumeForOrder("buyer-1", ORDER)).toBeNull();
});

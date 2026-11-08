import { expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import type { ShippingRateQuote } from "@/lib/database.types";

import { freezeOrderShipping, planCartFulfillment } from "./checkout-shipping";

const quote: ShippingRateQuote = {
  id: "quote-1",
  buyer_id: null,
  listing_id: "listing-1",
  provider: "easypost",
  provider_shipment_id: "shipment-provider-1",
  rate_ref: "rate-1",
  carrier: "USPS",
  service: "Priority",
  service_label: "USPS Priority",
  amount_cents: 975,
  currency: "USD",
  est_delivery_days: 2,
  destination_hash: "destination",
  request_fingerprint: null,
  parcel: {},
  consumed_order_id: null,
  expires_at: "2026-09-06T00:00:00.000Z",
  created_at: "2026-09-05T00:00:00.000Z",
};

const orders = [{ order_id: "order-1", listing_ids: ["listing-1"] }];
const quotes = new Map([["listing-1", quote]]);

it("fails closed when the frozen order quote cannot be written", async () => {
  const admin = {
    from: () => ({
      update: () => ({ eq: vi.fn().mockResolvedValue({ error: { message: "write failed" } }) }),
    }),
  };

  await expect(freezeOrderShipping(admin as never, orders, quotes))
    .rejects.toThrow("Shipping quote could not be frozen");
});

it("fails closed when a shipment item link cannot be persisted", async () => {
  const chain = (result: unknown) => {
    const value = {
      eq: () => value,
      is: () => value,
      select: () => value,
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
    return value;
  };
  const admin = {
    from: (table: string) => {
      if (table === "orders") {
        return { update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
      }
      if (table === "order_items") {
        return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [{ id: "item-1", listing_id: "listing-1" }], error: null }) }) };
      }
      if (table === "shipping_rate_quotes") {
        return {
          update: () => chain({ data: { id: "quote-1", consumed_order_id: "order-1" }, error: null }),
          select: () => chain({ data: { consumed_order_id: "order-1" }, error: null }),
        };
      }
      if (table === "shipments") {
        return {
          select: () => chain({ data: null, error: null }),
          insert: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: "shipment-1" }, error: null }) }) }),
        };
      }
      return {
        upsert: vi.fn().mockResolvedValue({ error: { message: "link failed" } }),
      };
    },
  };

  await expect(freezeOrderShipping(admin as never, orders, quotes))
    .rejects.toThrow("Shipping item link could not be created");
});

// OS-W31 (#82's finding): a guest's quote is stored with no buyer (the
// shipping-quote action has no session to bind it to). The guest path plans
// against that quote with the guest's resolved account and freezes it with
// freezeOrderShipping above; only the signed-in durable freeze matches buyers.
function planAdmin(storedQuote: ShippingRateQuote) {
  return {
    from: (table: string) => {
      if (table === "listings") {
        return { select: () => ({ in: vi.fn().mockResolvedValue({
          data: [{ id: "listing-1", title: "Intercooler", shipping_mode: "drvn", allows_collection: false, status: "active" }],
          error: null,
        }) }) };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: storedQuote, error: null }) }) }) };
    },
  };
}

const live = { ...quote, expires_at: new Date(Date.now() + 600_000).toISOString() };
const guestPlan = { listingIds: ["listing-1"], isCollection: false, quoteIds: { "listing-1": "quote-1" }, buyerId: "guest-buyer-1", destinationHash: "destination" };

it("plans a guest's DRVN Shipping against the buyer-less quote the guest was shown", async () => {
  const { plan, error } = await planCartFulfillment(planAdmin(live) as never, guestPlan);
  expect(error).toBeUndefined();
  expect(plan?.overrides).toEqual({ "listing-1": 975 });
  expect(plan?.quotes.get("listing-1")?.id).toBe("quote-1");
});

it("still refuses a quote bound to a different buyer", async () => {
  const { plan, error } = await planCartFulfillment(planAdmin({ ...live, buyer_id: "someone-else" }) as never, guestPlan);
  expect(plan).toBeUndefined();
  expect(error).toMatch(/refresh the rates/);
});

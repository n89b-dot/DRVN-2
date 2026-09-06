import { expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import type { ShippingRateQuote } from "@/lib/database.types";

import { freezeOrderShipping } from "./checkout-shipping";

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

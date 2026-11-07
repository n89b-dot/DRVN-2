import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N96: shipping quotes cost provider quota and rows. A quote needs the
 * caller's own cart, a still-valid stored quote is handed back instead of
 * re-rating, and live rating draws on a fail-closed quota checked before
 * any provider call.
 */

const mocks = vi.hoisted(() => ({
  cartIds: vi.fn(),
  user: vi.fn(),
  listings: vi.fn(),
  stored: vi.fn(),
  storedFilters: [] as [string, string, unknown][],
  insert: vi.fn(),
  getRates: vi.fn(),
  allow: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/abuse-identity", () => ({ abuseIdentity: (_h: unknown, userId?: string) => (userId ? `user:${userId}` : "network:x") }));
vi.mock("@/lib/cart", () => ({ getCartIds: mocks.cartIds }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { shippingQuote: { action: "shipping-quote", limit: 30, windowSeconds: 600, failClosed: true } },
  allowAction: mocks.allow,
  rateLimitMessage: () => "That's a lot at once — try again in a few minutes.",
}));
vi.mock("@/lib/shipping/provider", () => ({
  integratedShippingEnabled: () => true,
  getShippingProvider: () => ({ name: "easypost", getRates: mocks.getRates }),
}));
vi.mock("./checkout-shipping", () => ({ hashDestination: () => "dest-hash" }));
vi.mock("./fulfillment", () => ({
  loadFulfillmentProfile: async () => ({ address_verified_at: "2026-11-01T00:00:00Z", easypost_end_shipper_id: "es_1" }),
  shipFromAddress: () => ({ name: "Seller", street1: "1 Shop St", city: "Austin", postalCode: "78701", country: "US" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.user } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "listings") {
        const chain = { select: () => chain, in: () => chain, eq: () => chain, then: (r: (v: unknown) => unknown) => Promise.resolve(mocks.listings()).then(r) };
        return chain;
      }
      // shipping_rate_quotes: a read (select…limit) or an insert(…).select().
      const read: Record<string, unknown> = {};
      for (const method of ["eq", "is", "gt", "order"]) {
        read[method] = (column: string, value: unknown) => {
          mocks.storedFilters.push([method, column, value]);
          return read;
        };
      }
      read.limit = async () => mocks.stored();
      return {
        select: () => read,
        insert: (rows: unknown[]) => ({ select: async () => mocks.insert(rows) }),
      };
    },
  }),
}));

import { quoteCartShipping } from "./shipping-quote-actions";
import { reusableQuoteSet } from "./shipping-quote-cache";

const PARCEL = { weightOz: 32, lengthIn: 12, widthIn: 10, heightIn: 6 };
const LISTING = {
  id: "listing-1",
  title: "Turbo manifold",
  seller_id: "seller-1",
  status: "active",
  shipping_mode: "drvn",
  weight_oz: 32,
  length_in: 12,
  width_in: 10,
  height_in: 6,
  currency: "USD",
};

function addressForm() {
  const data = new FormData();
  data.set("ship_line1", "1 Main St");
  data.set("ship_city", "Austin");
  data.set("ship_postcode", "78701");
  data.set("ship_country", "US");
  return data;
}

const quoteRow = (id: string, amount: number, shipment = "shp_1", created = "2026-11-07T10:00:00Z", parcel: unknown = PARCEL) => ({
  id,
  service_label: `Service ${id}`,
  amount_cents: amount,
  est_delivery_days: 3,
  provider_shipment_id: shipment,
  parcel,
  created_at: created,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storedFilters.length = 0;
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.user.mockResolvedValue({ data: { user: { id: "buyer-1" } } });
  mocks.listings.mockReturnValue({ data: [LISTING], error: null });
  mocks.stored.mockResolvedValue({ data: [], error: null });
  mocks.allow.mockResolvedValue(true);
  mocks.getRates.mockResolvedValue({
    shipmentRef: "shp_new",
    rates: [{ rateRef: "rate_1", carrier: "UPS", service: "Ground", serviceLabel: "UPS Ground", amountCents: 1500, currency: "USD", estDeliveryDays: 4 }],
  });
  mocks.insert.mockResolvedValue({ data: [{ id: "q-new", service_label: "UPS Ground", amount_cents: 1500, est_delivery_days: 4 }], error: null });
});

describe("quoteCartShipping", () => {
  it("rates nothing without a cart to quote for", async () => {
    mocks.cartIds.mockResolvedValue([]);
    await expect(quoteCartShipping({ groups: [] }, addressForm())).resolves.toEqual({ groups: [] });
    expect(mocks.allow).not.toHaveBeenCalled();
    expect(mocks.getRates).not.toHaveBeenCalled();
  });

  it("rates nothing when the cart has no live DRVN Shipping line", async () => {
    mocks.listings.mockReturnValue({ data: [], error: null });
    await expect(quoteCartShipping({ groups: [] }, addressForm())).resolves.toEqual({ groups: [] });
    expect(mocks.getRates).not.toHaveBeenCalled();
  });

  it("checks the quota before the provider, one unit per line rated live", async () => {
    const result = await quoteCartShipping({ groups: [] }, addressForm());
    expect(mocks.allow).toHaveBeenCalledTimes(1);
    expect(mocks.allow).toHaveBeenCalledWith(expect.objectContaining({ action: "shipping-quote", failClosed: true }), "user:buyer-1");
    expect(mocks.allow.mock.invocationCallOrder[0]).toBeLessThan(mocks.getRates.mock.invocationCallOrder[0]);
    expect(result.groups[0].options).toEqual([{ quoteId: "q-new", serviceLabel: "UPS Ground", amountCents: 1500, estDeliveryDays: 4 }]);
  });

  it("fails closed: an exhausted or unanswerable quota makes no provider call and writes no rows", async () => {
    mocks.allow.mockResolvedValue(false);
    const result = await quoteCartShipping({ groups: [] }, addressForm());
    expect(result).toEqual({ groups: [], error: "That's a lot at once — try again in a few minutes." });
    expect(mocks.getRates).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("keys anonymous callers by network, and reuses only quotes that were anonymous too", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });
    await quoteCartShipping({ groups: [] }, addressForm());
    expect(mocks.allow).toHaveBeenCalledWith(expect.anything(), "network:x");
    expect(mocks.storedFilters).toContainEqual(["is", "buyer_id", null]);
  });

  it("hands back a still-valid stored quote set: no quota, no provider call, no new rows", async () => {
    mocks.stored.mockResolvedValue({ data: [quoteRow("q-2", 2200), quoteRow("q-1", 1400)], error: null });
    const result = await quoteCartShipping({ groups: [] }, addressForm());
    expect(result.groups[0].options.map((o) => o.quoteId)).toEqual(["q-1", "q-2"]);
    expect(mocks.allow).not.toHaveBeenCalled();
    expect(mocks.getRates).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    // Only this buyer's, this destination's, unconsumed and not about to expire.
    expect(mocks.storedFilters).toEqual(
      expect.arrayContaining([
        ["eq", "listing_id", "listing-1"],
        ["eq", "destination_hash", "dest-hash"],
        ["eq", "provider", "easypost"],
        ["is", "consumed_order_id", null],
        ["eq", "buyer_id", "buyer-1"],
      ]),
    );
    const expiry = mocks.storedFilters.find(([method, column]) => method === "gt" && column === "expires_at");
    expect(new Date(String(expiry?.[2])).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
  });
});

describe("reusableQuoteSet", () => {
  it("returns the newest provider set, cheapest first, for the same parcel", () => {
    const set = reusableQuoteSet(
      [
        quoteRow("old-1", 900, "shp_old", "2026-11-07T09:00:00Z"),
        quoteRow("new-2", 2000, "shp_new", "2026-11-07T10:00:00Z"),
        quoteRow("new-1", 1500, "shp_new", "2026-11-07T10:00:00Z"),
      ],
      PARCEL,
    );
    expect(set?.map((o) => o.quoteId)).toEqual(["new-1", "new-2"]);
  });

  it("re-rates when the parcel changed or nothing is stored", () => {
    expect(reusableQuoteSet([quoteRow("q-1", 1500, "shp_1", "2026-11-07T10:00:00Z", { ...PARCEL, weightOz: 48 })], PARCEL)).toBeNull();
    expect(reusableQuoteSet([], PARCEL)).toBeNull();
  });
});

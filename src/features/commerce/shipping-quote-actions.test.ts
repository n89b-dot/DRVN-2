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
  table: [] as Record<string, unknown>[],
  shipFrom: {} as Record<string, unknown>,
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
  shipFromAddress: () => ({ ...mocks.shipFrom }),
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
      read.limit = async () => mocks.stored(mocks.storedFilters.slice());
      return {
        select: () => read,
        insert: (rows: unknown[]) => ({ select: async () => mocks.insert(rows) }),
      };
    },
  }),
}));

import { quoteCartShipping } from "./shipping-quote-actions";
import { quoteRequestFingerprint, reusableQuoteSet } from "./shipping-quote-cache";

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

const FP = "fp-1";
const quoteRow = (id: string, amount: number, shipment = "shp_1", created = "2026-11-07T10:00:00Z", parcel: unknown = PARCEL, fingerprint: string | null = FP) => ({
  id,
  service_label: `Service ${id}`,
  amount_cents: amount,
  est_delivery_days: 3,
  provider_shipment_id: shipment,
  parcel,
  request_fingerprint: fingerprint,
  created_at: created,
});

/** A stored-quote table that honours the read's eq/is filters, like Postgres. */
function useQuoteTable() {
  mocks.table.length = 0;
  let next = 0;
  mocks.insert.mockImplementation(async (rows: Record<string, unknown>[]) => {
    const saved = rows.map((row) => ({ ...row, id: `q-${++next}`, consumed_order_id: null, created_at: new Date(Date.now() + next).toISOString() }));
    mocks.table.push(...saved);
    return { data: saved, error: null };
  });
  mocks.stored.mockImplementation(async (filters: [string, string, unknown][]) => {
    mocks.storedFilters.length = 0;
    const rows = mocks.table.filter((row) =>
      filters.every(([method, column, value]) =>
        method === "eq" || method === "is" ? (row[column] ?? null) === value : true,
      ),
    );
    return { data: rows, error: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storedFilters.length = 0;
  mocks.shipFrom = { name: "Seller", street1: "1 Shop St", city: "Austin", postalCode: "78701", country: "US" };
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
    const fingerprint = quoteRequestFingerprint({
      provider: "easypost",
      from: mocks.shipFrom as never,
      to: { name: "Buyer", street1: "1 Main St", street2: null, city: "Austin", state: null, postalCode: "78701", country: "US", phone: null },
      parcel: PARCEL,
      endShipperRef: "es_1",
    });
    mocks.stored.mockResolvedValue({
      data: [quoteRow("q-2", 2200, "shp_1", undefined, PARCEL, fingerprint), quoteRow("q-1", 1400, "shp_1", undefined, PARCEL, fingerprint)],
      error: null,
    });
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
        ["eq", "request_fingerprint", fingerprint],
      ]),
    );
    const expiry = mocks.storedFilters.find(([method, column]) => method === "gt" && column === "expires_at");
    expect(new Date(String(expiry?.[2])).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
  });
});

describe("quote reuse follows the whole provider request (Codex review of #82)", () => {
  beforeEach(useQuoteTable);

  it("reuses the same request, but re-rates when the apartment changes, so a label can't print the old one", async () => {
    const first = await quoteCartShipping({ groups: [] }, addressForm());
    expect(mocks.getRates).toHaveBeenCalledTimes(1);

    const same = await quoteCartShipping({ groups: [] }, addressForm());
    expect(mocks.getRates).toHaveBeenCalledTimes(1);
    expect(same.groups[0].options.map((o) => o.quoteId)).toEqual(first.groups[0].options.map((o) => o.quoteId));

    // Apartment B instead of A: same line 1, city and postcode, so the same
    // checkout destination hash — but a different provider shipment.
    const withApartment = addressForm();
    withApartment.set("ship_line2", "Apt B");
    mocks.getRates.mockResolvedValueOnce({
      shipmentRef: "shp_apt_b",
      rates: [{ rateRef: "rate_b", carrier: "UPS", service: "Ground", serviceLabel: "UPS Ground", amountCents: 1500, currency: "USD", estDeliveryDays: 4 }],
    });
    const moved = await quoteCartShipping({ groups: [] }, withApartment);
    expect(mocks.getRates).toHaveBeenCalledTimes(2);
    expect(mocks.getRates.mock.calls[1][0].to).toMatchObject({ street2: "Apt B" });
    const movedQuote = mocks.table.find((row) => row.id === moved.groups[0].options[0].quoteId);
    expect(movedQuote?.provider_shipment_id).toBe("shp_apt_b");
    expect(movedQuote?.request_fingerprint).not.toBe(mocks.table[0].request_fingerprint);
  });

  it("re-rates when the recipient, state or phone changes", async () => {
    await quoteCartShipping({ groups: [] }, addressForm());
    for (const [field, value] of [["ship_name", "Someone Else"], ["ship_state", "TX"], ["ship_phone", "555-0100"]] as const) {
      const changed = addressForm();
      changed.set(field, value);
      await quoteCartShipping({ groups: [] }, changed);
    }
    expect(mocks.getRates).toHaveBeenCalledTimes(4);
  });

  it("re-rates when the seller's ship-from address changes", async () => {
    await quoteCartShipping({ groups: [] }, addressForm());
    mocks.shipFrom = { ...mocks.shipFrom, street2: "Unit 4" };
    await quoteCartShipping({ groups: [] }, addressForm());
    expect(mocks.getRates).toHaveBeenCalledTimes(2);
    expect(mocks.getRates.mock.calls[1][0].from).toMatchObject({ street2: "Unit 4" });
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
      FP,
    );
    expect(set?.map((o) => o.quoteId)).toEqual(["new-1", "new-2"]);
  });

  it("re-rates when the parcel or request changed, for rows from before the fingerprint, or when nothing is stored", () => {
    expect(reusableQuoteSet([quoteRow("q-1", 1500, "shp_1", "2026-11-07T10:00:00Z", { ...PARCEL, weightOz: 48 })], PARCEL, FP)).toBeNull();
    expect(reusableQuoteSet([quoteRow("q-1", 1500)], PARCEL, "fp-other")).toBeNull();
    expect(reusableQuoteSet([quoteRow("q-1", 1500, "shp_1", "2026-11-07T10:00:00Z", PARCEL, null)], PARCEL, FP)).toBeNull();
    expect(reusableQuoteSet([], PARCEL, FP)).toBeNull();
  });

  it("fingerprints every address field, and nothing else changes it", () => {
    const base = {
      provider: "easypost",
      from: { name: "Seller", street1: "1 Shop St", city: "Austin", postalCode: "78701", country: "US" },
      to: { name: "Buyer", street1: "1 Main St", street2: "Apt A", city: "Austin", postalCode: "78701", country: "US" },
      parcel: PARCEL,
      endShipperRef: "es_1",
    };
    const fp = quoteRequestFingerprint(base);
    expect(quoteRequestFingerprint({ ...base, to: { ...base.to } })).toBe(fp);
    expect(quoteRequestFingerprint({ ...base, to: { ...base.to, street2: undefined } })).toBe(quoteRequestFingerprint({ ...base, to: { ...base.to, street2: null } }));
    for (const change of [
      { to: { ...base.to, street2: "Apt B" } },
      { to: { ...base.to, name: "Other" } },
      { to: { ...base.to, state: "TX" } },
      { to: { ...base.to, phone: "555" } },
      { from: { ...base.from, street1: "2 Shop St" } },
      { endShipperRef: "es_2" },
      { parcel: { ...PARCEL, heightIn: 7 } },
      { provider: "stub" },
    ]) {
      expect(quoteRequestFingerprint({ ...base, ...change })).not.toBe(fp);
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; count?: number | null; error: { message: string } | null };

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Result>,
  calls: [] as { table: string; method: string; args: unknown[] }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const result = state.tables[table] ?? { data: [], count: 0, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "order", "limit", "range"]) {
        builder[m] = (...args: unknown[]) => {
          state.calls.push({ table, method: m, args });
          return builder;
        };
      }
      builder.maybeSingle = async () => result;
      builder.then = (resolve: (value: Result) => unknown) => resolve(result);
      return builder;
    },
  }),
}));

import { countOpenIdentityReviews, getIdentityReviews, getProductCoverage } from "./product-identity";

beforeEach(() => {
  state.tables = {};
  state.calls = [];
});

describe("getIdentityReviews", () => {
  it("names the products with every number they hold, and the record a review is about", async () => {
    state.tables.product_identity_reviews = {
      count: 2,
      error: null,
      data: [
        {
          id: "r1", kind: "number_across_brands", number_compact: "0280158117", product_ids: ["p1", "p2"],
          listing_id: null, mod_item_id: null, detail: {}, status: "open", resolution_note: null,
          created_at: "2026-10-20T00:00:00Z", resolved_at: null,
        },
        {
          id: "r2", kind: "brandless_number", number_compact: "0280158117", product_ids: ["p1"],
          listing_id: "l1", mod_item_id: null, detail: { number: "0280.158.117" }, status: "open", resolution_note: null,
          created_at: "2026-10-20T00:00:00Z", resolved_at: null,
        },
      ],
    };
    state.tables.products = {
      error: null,
      data: [
        { id: "p1", brand: "Bosch", name: "EV14 injectors", merged_into: null },
        { id: "p2", brand: "Delphi", name: null, merged_into: null },
      ],
    };
    state.tables.product_part_numbers = {
      error: null,
      data: [
        { product_id: "p1", number: "0280-158-117", number_compact: "0280158117" },
        { product_id: "p1", number: null, number_compact: "0986ab1234" },
        { product_id: "p2", number: "0280158117", number_compact: "0280158117" },
      ],
    };
    state.tables.listings = { error: null, data: [{ id: "l1", title: "Injector, no brand" }] };

    const result = await getIdentityReviews("open");
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(result.rows[0].products).toEqual([
      { id: "p1", brand: "Bosch", name: "EV14 injectors", numbers: ["0280-158-117", "0986ab1234"] },
      { id: "p2", brand: "Delphi", name: null, numbers: ["0280158117"] },
    ]);
    expect(result.rows[0].record).toBeNull();
    expect(result.rows[1].record).toEqual({
      label: "Listing: Injector, no brand",
      href: "/admin/listings?q=Injector%2C%20no%20brand",
    });
    // Open reviews: only open ones, oldest first.
    expect(state.calls).toContainEqual({ table: "product_identity_reviews", method: "eq", args: ["status", "open"] });
    expect(state.calls).toContainEqual({
      table: "product_identity_reviews", method: "order", args: ["created_at", { ascending: true }],
    });
  });

  it("returns an empty page instead of throwing when the read fails", async () => {
    state.tables.product_identity_reviews = { data: null, count: null, error: { message: "timeout" } };
    await expect(getIdentityReviews("closed", { page: 2 })).resolves.toEqual({ rows: [], total: 0, page: 2, hasMore: false });
  });
});

describe("getProductCoverage", () => {
  it("reads the latest full run", async () => {
    state.tables.product_grow_runs = {
      error: null,
      data: {
        ran_at: "2026-10-20T04:47:00Z",
        result: {
          full: true,
          coverage: {
            listings: { with_number: 10, with_brand_and_number: 8, eligible: 8, with_product: 8 },
            mod_items: { with_number: 12, with_brand_and_number: 12, eligible: 12, with_product: 12 },
            products: { active: 19, merged: 1 },
            products_on_listings_and_builds: 3,
          },
        },
      },
    };
    const coverage = await getProductCoverage();
    expect(coverage?.listings).toEqual({ withNumber: 10, withBrandAndNumber: 8, eligible: 8, withProduct: 8 });
    expect(coverage?.products).toEqual({ active: 19, merged: 1 });
    expect(coverage?.productsOnListingsAndBuilds).toBe(3);
    expect(state.calls).toContainEqual({ table: "product_grow_runs", method: "eq", args: ["result->>full", "true"] });
  });

  it("is null before any full run", async () => {
    state.tables.product_grow_runs = { data: null, error: null };
    await expect(getProductCoverage()).resolves.toBeNull();
  });
});

describe("countOpenIdentityReviews", () => {
  it("is null when the count fails, so the badge degrades", async () => {
    state.tables.product_identity_reviews = { count: null, error: { message: "timeout" } };
    await expect(countOpenIdentityReviews()).resolves.toBeNull();
  });
});

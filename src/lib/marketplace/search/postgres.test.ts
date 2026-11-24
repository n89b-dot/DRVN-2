import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** Every filter each query was built with, by table. */
const calls: Record<string, [string, ...unknown[]][]> = {};
function query(table: string, rows: unknown[]) {
  const filters: [string, ...unknown[]][] = [];
  calls[table] = filters;
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "in", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      filters.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null });
  return builder;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      query(table, table === "listings" ? [{ id: "active-part" }] : table === "listing_part_numbers" ? [{ listing_id: "active-alternate" }] : []),
    rpc: async () => ({ data: [], error: null }),
  }),
}));

const { PostgresSearchProvider } = await import("./postgres");

describe("part-number search reads only parts for sale", () => {
  it("filters both lookups to active listings, so a draft or sold part cannot take a place in the limit", async () => {
    const ids = await new PostgresSearchProvider().searchIds("11617531423", { limit: 3 });
    expect(ids).toEqual(["active-part", "active-alternate"]);
    expect(calls.listings).toContainEqual(["eq", "status", "active"]);
    // The alternate numbers are another table: the listing's status is read through the join.
    expect(calls.listing_part_numbers).toContainEqual(["select", "listing_id, listings!inner(status)"]);
    expect(calls.listing_part_numbers).toContainEqual(["eq", "listings.status", "active"]);
    expect(calls.listings).toContainEqual(["limit", 3]);
  });
});

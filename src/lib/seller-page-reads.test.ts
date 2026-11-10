import { describe, expect, it } from "vitest";

import { liveViewTotal, offersForListings, offersWithUnread } from "./seller-page-reads";

type Row = Record<string, unknown>;
const id = (n: number) => `id-${String(n).padStart(6, "0")}`;

/**
 * A database that answers at most 1,000 rows per request, whatever `.limit()`
 * asks for, as PostgREST does. `failAfter`: requests that succeed before one fails.
 */
function capped(tables: Record<string, Row[]>, { failAfter = Infinity }: { failAfter?: number } = {}) {
  let requests = 0;
  const client = {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let limit = Infinity;
      let orderBy: string | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
        in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
        is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
        gt: (column: string, value: string) => { filters.push((row) => String(row[column]) > value); return builder; },
        order: (column: string) => { orderBy = column; return builder; },
        limit: (n: number) => { limit = n; return builder; },
        then: (resolve: (value: { data: Row[] | null; error: unknown }) => unknown) => {
          requests += 1;
          if (requests > failAfter) return resolve({ data: null, error: { message: "timeout" } });
          let rows = (tables[table] ?? []).filter((row) => filters.every((keep) => keep(row)));
          if (orderBy) rows = [...rows].sort((a, b) => (String(a[orderBy!]) < String(b[orderBy!]) ? -1 : 1));
          return resolve({ data: rows.slice(0, Math.min(limit, 1000)), error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as never, requests: () => requests };
}

describe("N718: the seller's pages read past 1,000 rows (work review #155)", () => {
  it("N718: the view total counts the 1,001st live listing, and only this seller's live ones", async () => {
    const listings = [
      ...Array.from({ length: 1001 }, (_, i) => ({ id: id(i), seller_id: "me", status: "active", view_count: 2 })),
      { id: id(5000), seller_id: "me", status: "active", view_count: null },
      { id: id(5001), seller_id: "me", status: "sold", view_count: 500 },
      { id: id(5002), seller_id: "someone-else", status: "active", view_count: 500 },
    ];
    expect(await liveViewTotal(capped({ listings }).client, "me")).toBe(2002);
  });

  it("N718: the view total is unknown, not a part of it, when a page fails", async () => {
    const listings = Array.from({ length: 1500 }, (_, i) => ({ id: id(i), seller_id: "me", status: "active", view_count: 1 }));
    expect(await liveViewTotal(capped({ listings }, { failAfter: 1 }).client, "me")).toBeNull();
  });

  it("N718: a listing's offer history keeps the offers past the 1,000th, newest first", async () => {
    const offers = Array.from({ length: 1203 }, (_, i) => ({
      id: id(i), listing_id: i % 2 ? "a" : "b", buyer_id: "buyer", amount_cents: 100, counter_amount_cents: null, status: "declined", expires_at: null,
      // Not in id order: the newest offer is the one with the lowest id.
      created_at: new Date(Date.UTC(2020, 0, 1) + (1203 - i) * 60_000).toISOString(),
    }));
    offers.push({ ...offers[0], id: id(9000), listing_id: "another-seller's" });
    const { rows } = await offersForListings(capped({ offers }).client, ["a", "b"]);
    expect(rows).toHaveLength(1203);
    expect(rows![0].id).toBe(id(0));
    expect(rows![1202].id).toBe(id(1202));
    expect((await offersForListings(capped({ offers }, { failAfter: 1 }).client, ["a", "b"])).rows).toBeNull();
    expect((await offersForListings(capped({ offers }).client, [])).rows).toEqual([]);
  });

  it("N718: an offer whose only unread message is past the 1,000th still shows as unread", async () => {
    const messages = [
      ...Array.from({ length: 1000 }, (_, i) => ({ id: id(i), offer_id: "busy", recipient_id: "me", read_at: null })),
      { id: id(2000), offer_id: "quiet", recipient_id: "me", read_at: null },
      { id: id(2001), offer_id: "read", recipient_id: "me", read_at: "2020-01-01T00:00:00Z" },
      { id: id(2002), offer_id: "theirs", recipient_id: "someone-else", read_at: null },
      { id: id(2003), offer_id: "not-asked", recipient_id: "me", read_at: null },
    ];
    const unread = await offersWithUnread(capped({ messages }).client, ["busy", "quiet", "read", "theirs"], "me");
    expect([...unread!].sort()).toEqual(["busy", "quiet"]);
    expect(await offersWithUnread(capped({ messages }, { failAfter: 1 }).client, ["busy", "quiet"], "me")).toBeNull();
  });

  it("N718: more ids than one request's filter can carry are asked in groups", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `offer-${i}`);
    const db = capped({ messages: [{ id: id(1), offer_id: "offer-449", recipient_id: "me", read_at: null }] });
    expect([...(await offersWithUnread(db.client, ids, "me"))!]).toEqual(["offer-449"]);
    // Three groups of at most 200; the group with a row is read until an empty page.
    expect(db.requests()).toBe(4);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/marketplace/query", () => ({ hydrateListingCards: async (_s: unknown, rows: unknown[]) => rows }));

import { boundedPage, MAX_PAGE, parsePageParam } from "./page-param";
import { fetchStorePage } from "./store/query";

describe("store page numbers (N79)", () => {
  it("accepts whole decimal page numbers", () => {
    expect(parsePageParam("1")).toBe(1);
    expect(parsePageParam("2")).toBe(2);
    expect(parsePageParam("007")).toBe(7);
    expect(parsePageParam(String(MAX_PAGE))).toBe(MAX_PAGE);
  });

  it("treats anything that is not a whole positive page as page 1", () => {
    for (const value of ["1.5", "2.0", "1e12", "1E3", "0x10", "0b11", "-1", "+2", " 3", "3 ", "0", "", "NaN", "Infinity", "½", "٣", "2,000", undefined, null]) {
      expect(parsePageParam(value), String(value)).toBe(1);
    }
  });

  it("caps a huge page at the bound instead of computing an offset from it", () => {
    expect(parsePageParam("501")).toBe(MAX_PAGE);
    expect(parsePageParam("1000000000000")).toBe(MAX_PAGE);
    expect(parsePageParam("9".repeat(400))).toBe(MAX_PAGE);
    expect(parsePageParam("60", 50)).toBe(50);
  });

  it("reads the first of a repeated parameter", () => {
    expect(parsePageParam(["3", "9"])).toBe(3);
    expect(parsePageParam(["1.5", "9"])).toBe(1);
  });

  it("bounds numbers that skipped the parser", () => {
    expect(boundedPage(1.5)).toBe(1);
    expect(boundedPage(1e12)).toBe(MAX_PAGE);
    expect(boundedPage(Number.NaN)).toBe(1);
    expect(boundedPage(Infinity)).toBe(MAX_PAGE);
    expect(boundedPage(-3)).toBe(1);
    expect(boundedPage(4)).toBe(4);
  });

  it("never asks the database for a fractional or unbounded store range", async () => {
    const ranges: [number, number][] = [];
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      range: (from: number, to: number) => {
        ranges.push([from, to]);
        return Promise.resolve({ data: [], count: 0, error: null });
      },
    };
    const supabase = { from: () => query } as never;
    for (const page of [1.5, 1e12, Number.NaN, -1, 3]) {
      await fetchStorePage(supabase, { sellerId: "s", isOwner: false, tab: undefined, page });
    }
    expect(ranges).toEqual([[0, 23], [(MAX_PAGE - 1) * 24, (MAX_PAGE - 1) * 24 + 23], [0, 23], [0, 23], [48, 71]]);
    for (const [from, to] of ranges) {
      expect(Number.isInteger(from) && Number.isInteger(to)).toBe(true);
    }
  });
});

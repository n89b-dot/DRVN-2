import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GarageSheet } from "./garage-data";

const rows = vi.hoisted(() => ({
  listings: [] as { id: string; title: string; price_cents: number; status: string }[],
  mods: [] as { id: string; brand: string | null; product: string | null; raw_text: string | null; linked_listing_id: string | null }[],
  asked: [] as { table: string; filters: unknown[] }[],
  failing: null as string | null,
}));

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

/** Answers the tab's two reads and records what it asked for. */
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const filters: unknown[] = [];
      rows.asked.push({ table, filters });
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => (filters.push(["eq", ...args]), chain),
        in: (...args: unknown[]) => (filters.push(["in", ...args]), chain),
        order: () =>
          Promise.resolve(
            rows.failing === table
              ? { data: null, error: { message: "read failed" } }
              : { data: table === "listings" ? rows.listings : rows.mods, error: null }
          ),
      };
      return chain;
    },
  }),
}));

const { GarageCarParts } = await import("./focused-panels");

const sheet = { id: "car-1", name: "Weekend car" } as GarageSheet;
const render = async () => renderToStaticMarkup(await GarageCarParts({ sheet }));
const section = (html: string, label: string) =>
  html.split('<section>').find((s) => s.includes(`>${label}</span>`)) ?? "";

// G-5: the car's Parts tab is what this car has for sale and has sold, plus
// what came off it and isn't listed — each with List it, or, when it already
// has a listing that isn't live, a way back to that listing.
describe("Garage car Parts tab (G-5)", () => {
  it("reads only this car's listings and its removed mods", async () => {
    rows.asked.length = 0;
    rows.listings = [];
    rows.mods = [];
    await render();
    const listings = rows.asked.find((a) => a.table === "listings")!;
    expect(listings.filters).toContainEqual(["eq", "source_car_id", "car-1"]);
    const mods = rows.asked.find((a) => a.table === "mod_items")!;
    expect(mods.filters).toContainEqual(["eq", "car_id", "car-1"]);
    expect(mods.filters).toContainEqual(["eq", "status", "removed"]);
    // Listings of every status, so a came-off part's paused or withdrawn
    // listing is found rather than dropped.
    expect(listings.filters.filter((f) => (f as unknown[])[0] === "in")).toEqual([]);
  });

  it("groups for sale and sold off this car, and lists what came off unlisted with List it", async () => {
    rows.listings = [
      { id: "l-live", title: "Stock exhaust", price_cents: 25000, status: "active" },
      { id: "l-held", title: "Stock intake", price_cents: 9000, status: "reserved" },
      { id: "l-sold", title: "Stock wheels", price_cents: 60000, status: "sold" },
    ];
    rows.mods = [
      { id: "m-box", brand: "Bilstein", product: "B6 shocks", raw_text: null, linked_listing_id: null },
      { id: "m-listed", brand: "Stock", product: "Exhaust", raw_text: null, linked_listing_id: "l-live" },
    ];
    const html = await render();

    const forSale = section(html, "For sale");
    expect(forSale).toContain("Stock exhaust");
    expect(forSale).toContain('href="/listings/l-live"');
    expect(forSale).toContain("Reserved");
    expect(forSale).not.toContain("Stock wheels");

    const sold = section(html, "Sold");
    expect(sold).toContain("Stock wheels");
    expect(sold).toContain('href="/listings/l-sold"');

    const cameOff = section(html, "Came off, not listed");
    expect(cameOff).toContain("Bilstein B6 shocks");
    expect(cameOff).toMatch(/href="\/sell\?car=car-1&amp;mod=m-box"[^>]*>List it</);
    // A part that is already a listing is not offered for listing again.
    expect(cameOff).not.toContain("Stock Exhaust");
    expect(cameOff).not.toContain("mod=m-listed");
    expect(html.match(/>List it</g)).toHaveLength(1);
  });

  it("keeps a came-off part whose listing is paused, withdrawn or taken down, opening that listing", async () => {
    rows.listings = [
      { id: "l-paused", title: "Stock seats", price_cents: 30000, status: "paused" },
      { id: "l-withdrawn", title: "Stock bumper", price_cents: 8000, status: "archived" },
      { id: "l-down", title: "Stock mirrors", price_cents: 4000, status: "removed" },
    ];
    rows.mods = [
      { id: "m-seats", brand: "Recaro", product: "Seats", raw_text: null, linked_listing_id: "l-paused" },
      { id: "m-bumper", brand: null, product: null, raw_text: "Front bumper", linked_listing_id: "l-withdrawn" },
      { id: "m-mirrors", brand: "Stock", product: "Mirrors", raw_text: null, linked_listing_id: "l-down" },
    ];
    const html = await render();
    const cameOff = section(html, "Came off, not listed");
    for (const [name, line, id] of [
      ["Recaro Seats", "Listing paused", "l-paused"],
      ["Front bumper", "Listing withdrawn", "l-withdrawn"],
      ["Stock Mirrors", "Listing taken down", "l-down"],
    ]) {
      expect(cameOff).toContain(name);
      expect(cameOff).toContain(line);
      expect(cameOff).toMatch(new RegExp(`href="/listings/${id}/edit"[^>]*>Open listing<`));
    }
    // None of them is offered as a new listing, and none appears for sale.
    expect(html).not.toContain(">List it<");
    expect(section(html, "For sale")).toContain("Nothing listed off this car right now.");
  });

  it("fails loudly instead of showing an empty tab when a read fails", async () => {
    rows.listings = [];
    rows.mods = [];
    for (const table of ["listings", "mod_items"]) {
      rows.failing = table;
      await expect(render()).rejects.toThrow(/Could not load/);
    }
    rows.failing = null;
  });

  it("says so when nothing is for sale, and shows no empty groups", async () => {
    rows.listings = [];
    rows.mods = [];
    const html = await render();
    expect(section(html, "For sale")).toContain("Nothing listed off this car right now.");
    expect(html).not.toContain(">Sold</span>");
    expect(html).not.toContain("Came off, not listed");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GarageSheet } from "./garage-data";

const rows = vi.hoisted(() => ({
  listings: [] as { id: string; title: string; price_cents: number; status: string }[],
  mods: [] as { id: string; brand: string | null; product: string | null; raw_text: string | null; linked_listing_id: string | null }[],
  asked: [] as { table: string; filters: unknown[] }[],
}));

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
        order: () => Promise.resolve({ data: table === "listings" ? rows.listings : rows.mods, error: null }),
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
// what came off it and isn't listed — each with List it.
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

  it("says so when nothing is for sale, and shows no empty groups", async () => {
    rows.listings = [];
    rows.mods = [];
    const html = await render();
    expect(section(html, "For sale")).toContain("Nothing listed off this car right now.");
    expect(html).not.toContain(">Sold</span>");
    expect(html).not.toContain("Came off, not listed");
  });
});

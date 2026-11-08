import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GarageSheet } from "./garage-data";
import { loadGarageCars } from "./garage-data";
import { GarageSwitcher } from "./garage-switcher";

const sheet = (id: string, name: string): GarageSheet =>
  ({ id, name, slug: id, cover_image_url: null }) as GarageSheet;

/** The two reads loadGarageCars makes, answered from memory. */
function fakeSupabase(cars: { id: string; name: string; created_at: string }[], mainCarId: string | null) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === "cars"
            ? Promise.resolve({ data: cars, error: null })
            : { maybeSingle: () => Promise.resolve({ data: { main_car_id: mainCarId }, error: null }) },
      }),
    }),
  } as unknown as Parameters<typeof loadGarageCars>[0];
}

const chips = (html: string) =>
  [...html.matchAll(/<a[^>]*class="fbtn[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<a[^>]*href="([^"]+)"[^>]*class="fbtn[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map(
    (m) => ({ href: m[1] ?? m[3], text: (m[2] ?? m[4]).replace(/<[^>]+>/g, "").trim() })
  );

// G-1: the switcher strip is every car, main first, plus All cars (the list
// the garage has always been) and one Add vehicle.
describe("Garage switcher strip (G-1)", () => {
  it("orders the owner's cars main first, then newest first", async () => {
    const cars = await loadGarageCars(
      fakeSupabase(
        [
          { id: "old", name: "Old", created_at: "2025-01-01" },
          { id: "new", name: "New", created_at: "2026-06-01" },
          { id: "main", name: "Main", created_at: "2024-01-01" },
        ],
        "main"
      ),
      "owner"
    );
    expect(cars.map((c) => c.id)).toEqual(["main", "new", "old"]);
  });

  it("shows All cars and every car, in the order given, each linking to its focus", () => {
    const html = renderToStaticMarkup(
      <GarageSwitcher sheets={[sheet("main", "Main"), sheet("new", "New"), sheet("old", "Old")]} currentCarId="new" />
    );
    expect(chips(html)).toEqual([
      { href: "/garage?car=all", text: "All cars" },
      { href: "/garage?car=main", text: "Main" },
      { href: "/garage?car=new", text: "New" },
      { href: "/garage?car=old", text: "Old" },
    ]);
    // The focused car is the selected chip; All cars is selected without one.
    expect(html).toMatch(/aria-current="true"[^>]*href="\/garage\?car=new"|href="\/garage\?car=new"[^>]*aria-current="true"/);
    const all = renderToStaticMarkup(<GarageSwitcher sheets={[sheet("main", "Main")]} />);
    expect(all).toMatch(/aria-current="true"[^>]*href="\/garage\?car=all"|href="\/garage\?car=all"[^>]*aria-current="true"/);
  });

  it("mounts the one Add vehicle control it is given, once, at the end", () => {
    const html = renderToStaticMarkup(
      <GarageSwitcher sheets={[sheet("main", "Main")]} add={<button type="button">Add vehicle</button>} />
    );
    expect(html.match(/Add vehicle/g)).toHaveLength(1);
    expect(html.lastIndexOf("Add vehicle")).toBeGreaterThan(html.lastIndexOf("/garage?car=main"));
  });

  it("is absent for an empty garage, which opens on the add-car form instead", () => {
    expect(renderToStaticMarkup(<GarageSwitcher sheets={[]} />)).toBe("");
  });
});

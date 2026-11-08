import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/social/card-actions", () => ({
  CardEngagement: ({ trailing }: { trailing?: React.ReactNode }) => <div className="engage">{trailing}</div>,
}));
vi.mock("@/features/commerce/quick-commerce", () => ({
  ListingCartButton: ({ title }: { title: string }) => <button type="button" aria-label={`Add to cart — ${title}`}>Cart</button>,
}));

import type { FeedItem } from "@/lib/feed";

import { FeedMosaicCell } from "./mosaic";

const at = "2026-11-01T12:00:00Z";
const build = {
  kind: "car", id: "c1", slug: "golf-r", name: "Track Golf", meta: null, cover_url: null, created_at: at, lastActivityAt: at,
  vehicle: { year: 2019, make: "Volkswagen", model: "Golf R" }, updateCount: 3, forSaleCount: 2, ownerName: "Dana",
} as unknown as FeedItem;
const update = {
  kind: "update", id: "p1", carSlug: "golf-r", title: "Coilovers in", intro: "Finally fitted the KWs.", cover_url: null,
  created_at: at, carName: "Track Golf", carVehicle: { year: 2019, make: "Volkswagen", model: "Golf R" }, reactions: 0, ownerName: "Dana",
} as unknown as FeedItem;
const part = {
  kind: "part", id: "l1", title: "Stock exhaust", price_cents: 25000, condition: "used_good", grade: null, cover_url: null,
  created_at: at, sellerName: "Dana", sourceCarName: "2019 Volkswagen Golf R",
} as unknown as FeedItem;

const render = (item: FeedItem) => renderToStaticMarkup(<FeedMosaicCell item={item} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// E-2: the three post kinds are one card; they differ by their label and one
// line — build → car + counts, update → title + car, part → price + car + cart.
describe("feed card kinds (E-2)", () => {
  it("labels each kind and keeps the same card for all three", () => {
    for (const [item, label] of [[build, "Build"], [update, "Update"], [part, "For sale"]] as const) {
      const html = render(item);
      expect(html).toMatch(/class="mcell[ "]/);
      expect(text(html)).toContain(label);
    }
  });

  it("build: the car and its counts — no price, no cart", () => {
    const html = render(build);
    const t = text(html);
    expect(t).toContain("Track Golf");
    expect(t).toContain("2019 Volkswagen Golf R");
    expect(t).toContain("3 updates · 2 parts for sale");
    expect(html).not.toContain("mcell__price");
    expect(html).not.toContain("Add to cart");
  });

  it("update: the title and the car — no counts, no price, no cart", () => {
    const html = render(update);
    const t = text(html);
    expect(t).toContain("Coilovers in");
    expect(t).toContain("2019 Volkswagen Golf R");
    expect(t).not.toMatch(/\d+ updates?/);
    expect(html).not.toContain("mcell__price");
    expect(html).not.toContain("Add to cart");
    // With no title, the first line leads instead.
    expect(text(render({ ...update, title: "" } as FeedItem))).toContain("Finally fitted the KWs.");
  });

  it("part: the price, the car it came off and the cart", () => {
    const html = render(part);
    const t = text(html);
    expect(t).toContain("$250");
    expect(t).toContain("2019 Volkswagen Golf R");
    expect(html).toContain('aria-label="Add to cart — Stock exhaust"');
    expect(t).not.toMatch(/\d+ updates?/);
    // A part with no source car simply has no car line.
    expect(text(render({ ...part, sourceCarName: null } as FeedItem))).not.toContain("Golf R");
  });
});

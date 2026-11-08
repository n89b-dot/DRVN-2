import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/activity/mod-actions", () => ({ markModRemoved: vi.fn() }));

import type { ActivityBlock } from "@/lib/activity-blocks";

import { MarkRemovedOffer } from "./mark-removed-offer";
import { partsStillFitted } from "./still-fitted";

const sheet = [
  { id: "m-off", status: "installed", brand: "Stock", product: "Exhaust", raw_text: null },
  { id: "m-swap", status: "installed", brand: null, product: null, raw_text: "Stock springs" },
  { id: "m-gone", status: "removed", brand: "Old", product: "Intake", raw_text: null },
  { id: "m-new", status: "installed", brand: "KW", product: "V3", raw_text: null },
];

// A-3: publishing an update that says a part came off offers to mark it
// removed on the build sheet — for "removed" and "replaced" alike.
describe("mark the part removed after publishing (A-3)", () => {
  it("offers each part the update says came off that the sheet still has fitted", () => {
    const blocks: ActivityBlock[] = [
      { type: "mod", action: "removed", modItemId: "m-off", label: "Stock exhaust" },
      { type: "mod", action: "replaced", modItemId: "m-swap", label: "Stock springs" },
      { type: "mod", action: "removed", modItemId: "m-gone", label: "Old intake" },
      { type: "mod", action: "installed", modItemId: "m-new", label: "KW V3" },
      { type: "mod", action: "removed", modItemId: null, label: "Something typed in" },
    ];
    expect(partsStillFitted(blocks, sheet)).toEqual([
      { id: "m-off", label: "Stock Exhaust" },
      { id: "m-swap", label: "Stock springs" },
    ]);
  });

  it("renders the offer with Mark it off the car and Leave it for each", () => {
    const html = renderToStaticMarkup(
      <MarkRemovedOffer carId="car-1" mods={[{ id: "m-off", label: "Stock Exhaust" }]} />
    );
    expect(html).toContain('aria-label="Update the build sheet"');
    expect(html).toContain("This update says a part came off.");
    expect(html).toContain("Mark it off the car");
    expect(html).toContain('aria-label="Leave Stock Exhaust on the sheet"');
  });

  it("offers nothing when no part is still fitted", () => {
    expect(renderToStaticMarkup(<MarkRemovedOffer carId="car-1" mods={[]} />)).toBe("");
  });
});

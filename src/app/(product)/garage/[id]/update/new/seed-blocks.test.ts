import { describe, expect, it } from "vitest";

import { modBlockSellHref } from "@/features/composer/sell-link";

import { modPickerLabel, seedChangeBlocks } from "./seed-blocks";

const mods = [
  { id: "m-kw", brand: "KW", product: "V3 coilovers", raw_text: null, status: "installed" },
  { id: "m-old", brand: "Bilstein", product: "B6 shocks", raw_text: null, status: "removed" },
  { id: "m-raw", brand: null, product: null, raw_text: "Stock airbox", status: "removed" },
];

// A-3: the composer shows a sell link on "replaced" as well as "removed";
// blocks seeded from the build sheet carry the mod id.
describe("composer sell link and seeded blocks (A-3)", () => {
  it("offers Sell this part on removed and replaced blocks that name a build entry", () => {
    expect(modBlockSellHref("removed", "m-old", "car-1")).toBe("/sell?car=car-1&mod=m-old");
    expect(modBlockSellHref("replaced", "m-old", "car-1")).toBe("/sell?car=car-1&mod=m-old");
  });

  it("offers none on an install or update, or on a typed-in part with no build entry", () => {
    expect(modBlockSellHref("installed", "m-kw", "car-1")).toBeNull();
    expect(modBlockSellHref("updated", "m-kw", "car-1")).toBeNull();
    expect(modBlockSellHref("removed", null, "car-1")).toBeNull();
  });

  it("seeds “what changed” blocks with the mod id — removed parts included", () => {
    const blocks = seedChangeBlocks({ added: "KW V3 coilovers", removed: "Bilstein B6 shocks|Stock airbox" }, mods);
    expect(blocks).toEqual([
      { type: "mod", action: "installed", modItemId: "m-kw", label: "KW V3 coilovers" },
      { type: "mod", action: "removed", modItemId: "m-old", label: "Bilstein B6 shocks" },
      { type: "mod", action: "removed", modItemId: "m-raw", label: "Stock airbox" },
    ]);
    // So a seeded removal gets its sell link straight away.
    const removed = blocks[1];
    expect(removed.type === "mod" && modBlockSellHref(removed.action, removed.modItemId, "car-1")).toBe(
      "/sell?car=car-1&mod=m-old"
    );
  });

  it("matches a removal only among removed parts, and leaves an unknown label as a plain block", () => {
    const blocks = seedChangeBlocks({ added: "Bilstein B6 shocks", removed: "KW V3 coilovers|Gone part" }, mods);
    expect(blocks.map((b) => (b.type === "mod" ? b.modItemId : "?"))).toEqual([null, null, null]);
  });

  it("still names a part that came off as such in the picker", () => {
    expect(modPickerLabel(mods[1])).toBe("Bilstein B6 shocks — off the car");
    expect(modPickerLabel(mods[0])).toBe("KW V3 coilovers");
  });
});

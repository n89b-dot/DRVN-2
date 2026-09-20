import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * L-4 — a shop's product photo never becomes a listing photo.
 *
 * A mod added by pasting a link carries the shop's own studio image. It shows
 * a NEW part, it isn't the seller's to republish, and a buyer looking at a
 * used-parts marketplace must never be shown one as if it were the item.
 *
 * The guard is structural: the sell prefill doesn't select the column, so
 * there is nothing to pass along by accident. That is easy to undo with one
 * well-meaning edit widening the projection, so it is asserted here rather
 * than trusted to a comment.
 */
describe("sell form prefill from a build line", () => {
  const source = readFileSync(join(process.cwd(), "src/app/(product)/sell/page.tsx"), "utf8");

  it("never reads a mod's imported shop photo", () => {
    const modSelect = source.match(/from\("mod_items"\)\s*\n\s*\.select\("([^"]+)"\)/);
    expect(modSelect, "the mod prefill query moved — re-point this guard").not.toBeNull();
    const columns = modSelect![1].split(",").map((c) => c.trim());
    expect(columns).not.toContain("image_url");
    expect(columns).not.toContain("*");
  });

  it("carries the part identity the build already recorded", () => {
    const modSelect = source.match(/from\("mod_items"\)\s*\n\s*\.select\("([^"]+)"\)/);
    const columns = modSelect![1].split(",").map((c) => c.trim());
    for (const column of ["brand", "product", "part_number", "category"]) {
      expect(columns, `prefill lost ${column}`).toContain(column);
    }
  });
});

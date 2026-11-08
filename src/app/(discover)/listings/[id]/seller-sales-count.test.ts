import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * N71 — "N sold on DRVN" on a listing's seller line is a trust claim buyers
 * rely on, so it counts sales buyers paid for (profile_sales_count, the
 * profile's own figure), never the seller's listings marked sold: "Mark
 * sold" is the seller's own click. The SQL side (a marked-sold part doesn't
 * count) is proved in supabase/tests/listing_write_boundary_guard.sql.
 */
describe("listing seller line sales count", () => {
  const source = readFileSync(join(process.cwd(), "src/app/(discover)/listings/[id]/page.tsx"), "utf8");

  it("reads the paid-order count", () => {
    expect(source).toContain('supabase.rpc("profile_sales_count", { p_profile: listing.seller_id })');
    expect(source).toMatch(/\$\{sold\} sold on DRVN/);
  });

  it("never counts the seller's listings marked sold", () => {
    expect(source).not.toMatch(/\.eq\("status", "sold"\)/);
  });
});

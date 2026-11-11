import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { classifyArrival, isListingArrival, LISTING_ARRIVALS } from "./arrival";

const HOST = "drvn.app";
const at = (path: string) => `https://${HOST}${path}`;

describe("OS-R-arrival: a listing view names the surface it came from", () => {
  it.each([
    ["/cars/r34-gtr", "car"],
    ["/cars/r34-gtr/activity/8c1f", "post"],
    ["/posts/8c1f", "post"],
    ["/u/neil", "profile"],
    ["/u/neil?view=parts", "store"],
    ["/u/neil?tab=parts", "store"],
    ["/u/neil?view=forsale", "store"],
    ["/profile", "profile"],
    ["/marketplace?q=coilovers", "marketplace"],
    ["/marketplace/suspension/coilovers", "marketplace"],
    ["/explore", "explore"],
    ["/home", "home"],
    ["/", "front"],
    ["/saved", "saved"],
    ["/listings/abc", "listing"],
    ["/agent", "agent"],
    ["/orders/123", "other"],
  ])("%s → %s", (path, expected) => {
    expect(classifyArrival(at(path), HOST)).toBe(expected);
  });

  it("tells an outside site, no referrer and junk apart", () => {
    expect(classifyArrival("https://www.google.com/", HOST)).toBe("external");
    expect(classifyArrival("https://drvn.app.evil.test/cars/x", HOST)).toBe("external");
    expect(classifyArrival(null, HOST)).toBe("direct");
    expect(classifyArrival("", HOST)).toBe("direct");
    expect(classifyArrival("not a url", HOST)).toBe("direct");
    expect(classifyArrival("javascript:alert(1)", HOST)).toBe("direct");
    // Without a known host nothing can be called same-site.
    expect(classifyArrival(at("/cars/x"), null)).toBe("external");
  });

  it("only ever reports a value the database accepts (N1075)", () => {
    // The table as the database holds it (supabase/schema/, plan 2 items A1 and A6).
    const table = readFileSync(join(process.cwd(), "supabase/schema/tables/public.listing_view_arrivals.sql"), "utf8");
    const check = table.match(/listing_view_arrivals_arrival_check CHECK \(\(?arrival = ANY \(ARRAY\[([^\]]*)\]/);
    expect(check).not.toBeNull();
    const allowed = [...check![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(allowed).toEqual([...LISTING_ARRIVALS]);
    expect(isListingArrival("car")).toBe(true);
    expect(isListingArrival("https://drvn.app/cars/x")).toBe(false);
  });
});

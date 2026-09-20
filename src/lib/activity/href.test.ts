import { describe, expect, it } from "vitest";

import { postHref } from "./href";

describe("where a post lives (W-5)", () => {
  it("keeps the URL a post with a car has always had", () => {
    // Every link already in the world points at this shape. Changing it to
    // /posts/ for consistency would break all of them for no gain.
    expect(postHref({ id: "p1", carSlug: "shirayuki-s15" })).toBe(
      "/cars/shirayuki-s15/activity/p1"
    );
    expect(postHref({ id: "p1", car: { slug: "shirayuki-s15" } })).toBe(
      "/cars/shirayuki-s15/activity/p1"
    );
  });

  it("gives a carless post somewhere of its own", () => {
    expect(postHref({ id: "p2" })).toBe("/posts/p2");
    expect(postHref({ id: "p2", carSlug: null })).toBe("/posts/p2");
    expect(postHref({ id: "p2", car: null })).toBe("/posts/p2");
  });
});

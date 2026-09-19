import { describe, expect, it } from "vitest";

import { FEED_TABS, resolveFeedTab } from "./feed";

describe("feed tabs — the shared Home/Explore segmentation", () => {
  it("segments the feed into All · Builds · Updates · Parts, in that order", () => {
    expect(FEED_TABS.map((t) => t.label)).toEqual(["All", "Builds", "Updates", "Parts"]);
  });

  it("has exactly one parts segment — Parts already means parts for sale", () => {
    expect(FEED_TABS.filter((t) => /part|sale/i.test(t.label))).toHaveLength(1);
  });

  /**
   * The marketplace is a front door (PRD 2026-09 E-5), so no segment is
   * signed-in-only. The retired v3.1 §8.2 gate lived on a `loggedInOnly`
   * flag here; this asserts the shape can't grow one back unnoticed.
   */
  it("shows every segment to everyone, signed in or not", () => {
    expect(FEED_TABS.map((t) => t.key)).toEqual(["all", "cars", "updates", "parts"]);
    expect(FEED_TABS.some((t) => "loggedInOnly" in t)).toBe(false);
    expect(resolveFeedTab("parts")).toBe("parts");
  });

  it("falls back to All for unknown values", () => {
    expect(resolveFeedTab("for-sale")).toBe("all");
    expect(resolveFeedTab(undefined)).toBe("all");
    expect(resolveFeedTab(["cars"])).toBe("all");
  });
});

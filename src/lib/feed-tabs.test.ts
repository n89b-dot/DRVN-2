import { describe, expect, it } from "vitest";

import { FEED_TABS, resolveFeedTab, visibleFeedTabs } from "./feed";

describe("feed tabs — the shared Home/Explore segmentation", () => {
  it("segments the feed into All · Builds · Updates · Parts, in that order", () => {
    expect(FEED_TABS.map((t) => t.label)).toEqual(["All", "Builds", "Updates", "Parts"]);
  });

  it("has exactly one parts segment — Parts already means parts for sale", () => {
    expect(FEED_TABS.filter((t) => /part|sale/i.test(t.label))).toHaveLength(1);
  });

  it("hides Parts from signed-out viewers and refuses it as a deep link", () => {
    expect(visibleFeedTabs(false).map((t) => t.key)).toEqual(["all", "cars", "updates"]);
    expect(resolveFeedTab("parts", false)).toBe("all");
    expect(resolveFeedTab("parts", true)).toBe("parts");
  });

  it("falls back to All for unknown values", () => {
    expect(resolveFeedTab("for-sale", true)).toBe("all");
    expect(resolveFeedTab(undefined, true)).toBe("all");
    expect(resolveFeedTab(["cars"], true)).toBe("all");
  });
});

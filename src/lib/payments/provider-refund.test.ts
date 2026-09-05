import { describe, expect, it } from "vitest";

import { stubRefundReference } from "./provider";

describe("stub refund identity", () => {
  it("deduplicates a replay but gives two partial operations distinct refund references", () => {
    const first = stubRefundReference("stub_payment", 2_000, "refund:order:a:2000");
    const firstReplay = stubRefundReference("stub_payment", 2_000, "refund:order:a:2000");
    const second = stubRefundReference("stub_payment", 3_000, "refund:order:a:5000");

    expect(firstReplay).toBe(first);
    expect(second).not.toBe(first);
    expect(first).toMatch(/^stub_refund_[0-9a-f]{32}$/);
  });
});

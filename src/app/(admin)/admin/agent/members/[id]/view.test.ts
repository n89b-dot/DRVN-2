import { describe, expect, it } from "vitest";

import { approvalTitle, eventLine, limitsLine } from "./view";

/** Readiness report two, 70: an admin viewer never reads a member's floor or ceiling, or an amount derived from one. */
describe("one member's agent on the admin page", () => {
  const seller = { scope: "seller", style: "balanced", minimum_cents: 41_000, target_cents: 48_000, ceiling_cents: null, ceiling_basis: null };
  const buyer = { scope: "buyer", style: "firm", minimum_cents: null, target_cents: null, ceiling_cents: 52_500, ceiling_basis: "total" };
  const counter = { kind: "move", inputs: { kind: "counter", amount_cents: 41_000 }, result: {} };
  const approval = { reason: "close_to_limit", amount_cents: 50_000 };
  const money = /\$|410|480|525|500/;

  it("a viewer sees states and styles, no amount anywhere", () => {
    for (const line of [limitsLine(seller, false), limitsLine(buyer, false), eventLine(counter, false), approvalTitle(approval, false)]) {
      expect(line).not.toMatch(money);
    }
    expect(limitsLine(seller, false)).toContain("balanced");
    expect(eventLine(counter, false)).toBe("counter");
  });

  it("a full admin, once audited, sees the amounts", () => {
    expect(limitsLine(seller, true)).toMatch(/minimum \$410.*target \$480/);
    expect(limitsLine(buyer, true)).toMatch(/max \$525.*item \+ shipping/);
    expect(eventLine(counter, true)).toMatch(/counter \$410/);
    expect(approvalTitle(approval, true)).toMatch(/\$500/);
  });
});

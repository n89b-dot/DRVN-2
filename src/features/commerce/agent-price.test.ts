import { describe, expect, it } from "vitest";

import { agentPriceLine, type PriceRound } from "./agent-price";

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const round = (round_no: number, actor_role: PriceRound["actor_role"], kind: PriceRound["kind"], amount_cents: number | null, agent = false): PriceRound => ({
  round_no,
  actor_role,
  kind,
  amount_cents,
  created_at: at(round_no),
  actor_task_id: agent ? `task-${round_no}` : null,
});

describe("agentPriceLine (AG-4: the checkout says when an agent set the price)", () => {
  it("names the buyer's own agent when it accepted the seller's counter", () => {
    const line = agentPriceLine([
      round(1, "buyer", "offer", 105000, true),
      round(2, "seller", "counter", 140000),
      round(3, "buyer", "counter", 120000, true),
      round(4, "seller", "counter", 128000),
      round(5, "buyer", "accept", null, true),
    ]);
    expect(line?.by).toBe("your_agent");
    expect(line?.at).toBe(at(5));
    expect(line?.text).toMatch(/^Price set by your agent on .*, within the max you set\.$/);
  });

  it("names the seller's agent when a person accepted its counter", () => {
    // Rounds are read in whatever order the database gave them.
    const line = agentPriceLine([
      round(3, "buyer", "accept", null),
      round(1, "buyer", "offer", 23200),
      round(2, "seller", "counter", 24000, true),
    ]);
    expect(line?.by).toBe("sellers_agent");
    expect(line?.at).toBe(at(2));
    expect(line?.text).toMatch(/^Price agreed with the seller's agent on /);
  });

  it("names the buyer's agent, not the seller's, when both acted and the buyer's accepted", () => {
    const line = agentPriceLine([
      round(1, "buyer", "offer", 23200, true),
      round(2, "seller", "counter", 24000, true),
      round(3, "buyer", "accept", null, true),
    ]);
    expect(line?.by).toBe("your_agent");
  });

  it("says nothing when people set the price", () => {
    expect(agentPriceLine([round(1, "buyer", "offer", 23200), round(2, "seller", "counter", 24000), round(3, "buyer", "accept", null)])).toBeNull();
    // The seller accepted the buyer's own offer; their agent had only countered earlier.
    expect(
      agentPriceLine([
        round(1, "buyer", "offer", 23200),
        round(2, "seller", "counter", 25000, true),
        round(3, "buyer", "counter", 24000),
        round(4, "seller", "accept", null),
      ]),
    ).toBeNull();
  });

  it("says nothing without an acceptance, or with no rounds at all", () => {
    expect(agentPriceLine([])).toBeNull();
    expect(agentPriceLine([round(1, "buyer", "offer", 23200, true), round(2, "seller", "decline", null)])).toBeNull();
  });
});

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

  it("names the buyer's agent when the seller accepted its opening offer by hand", () => {
    // The buyer's agent offers $800; the seller taps Accept. The accept is a
    // person's, but the price is the one the agent offered.
    const line = agentPriceLine([round(1, "buyer", "offer", 80000, true), round(2, "seller", "accept", null)]);
    expect(line?.by).toBe("your_agent");
    expect(line?.at).toBe(at(1));
    expect(line?.text).toMatch(/^Your agent offered this price on .+, within the max you set, and the seller accepted\.$/);
  });

  it("names the buyer's agent when the seller accepted its counter", () => {
    const line = agentPriceLine([
      round(1, "buyer", "offer", 70000),
      round(2, "seller", "counter", 90000),
      round(3, "buyer", "counter", 82000, true),
      round(4, "seller", "accept", null),
    ]);
    expect(line?.by).toBe("your_agent");
    expect(line?.at).toBe(at(3));
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

  it("reads the agent from the mandate version once the task link has cleared", () => {
    // actor_task_id is set null when the agent's task is deleted (account
    // deletion, retention); mandate_version has no foreign key and stays.
    const cleared = (r: PriceRound): PriceRound => ({ ...r, actor_task_id: null, mandate_version: 3 });
    const line = agentPriceLine([round(1, "buyer", "offer", 105000), round(2, "seller", "counter", 128000), cleared(round(3, "buyer", "accept", null))]);
    expect(line?.by).toBe("your_agent");
    expect(agentPriceLine([round(1, "buyer", "offer", 105000), cleared(round(2, "seller", "counter", 128000)), round(3, "buyer", "accept", null)])?.by).toBe(
      "sellers_agent",
    );
  });
});

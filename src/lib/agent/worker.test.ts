import { describe, expect, it } from "vitest";

import { handBack, negotiationInput, runAgentPass, type AgentDb, type JobContext } from "./worker";

const context: JobContext = {
  job: { id: "j", kind: "offer_turn", expected_action: "offer_move", offer_id: "o", round_no: 1 },
  task: { id: "t", scope: "seller", status: "working" },
  mandate: { id: "m", version: 2, status: "active", style: "balanced", target_cents: null, ceiling_cents: null, ceiling_basis: null },
  effective_floor_cents: 60000,
  listing: { id: "l", status: "active", price_cents: 100000, shipping_cents: 0, shipping_mode: "flat" },
  offer: { id: "o", status: "open", amount_cents: 50000, counter_amount_cents: null, round_count: 1, expires_at: null },
  rounds: [{ round_no: 1, actor_role: "buyer", kind: "offer", amount_cents: 50000, by_agent: false }],
  buyer_amounts: [50000],
  halted: null,
};

/** Records every call; answers the claim and the context, and fails the named functions with a code. */
function fakeDb(fail: Record<string, string> = {}, ctx = context) {
  const calls: { text: string; values?: unknown[] }[] = [];
  const db: AgentDb = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("agent_claim_jobs")) return { rows: [{ job_id: "j", lease_id: "lease", task_id: "t", kind: "offer_turn", expected_action: "offer_move", listing_id: "l", offer_id: "o", round_no: 1 }] as never };
      if (text.includes("agent_job_context")) return { rows: [{ context: ctx }] as never };
      for (const [fn, code] of Object.entries(fail)) if (text.includes(fn)) throw Object.assign(new Error(fn), { code });
      return { rows: [] };
    },
  };
  return { db, calls };
}

describe("the agent worker's pass", () => {
  it("decides with negotiate() and makes the one call the job allows", async () => {
    const { db, calls } = fakeDb();
    const result = await runAgentPass(db);
    expect(result).toMatchObject({ claimed: 1, moved: 1, handedBack: 0 });
    const move = calls.find((call) => call.text.includes("agent_offer_move"))!;
    expect(move.values).toEqual(["j", "lease", "o", "counter", 90000, 1]);
  });

  it("hands a refused job back with its code, for monitoring", async () => {
    const { db, calls } = fakeDb({ agent_offer_move: "AG003" });
    const result = await runAgentPass(db);
    expect(result.codes).toEqual({ AG003: 1 });
    expect(calls.at(-1)!.values).toEqual(["j", "lease", "cancelled", "AG003", false]);
  });

  it("leaves a job whose lease is gone alone", async () => {
    const { db, calls } = fakeDb({ agent_offer_move: "AG001" });
    await runAgentPass(db);
    expect(calls.some((call) => call.text.includes("agent_finish_job"))).toBe(false);
  });

  it("retries under a kill switch instead of acting", async () => {
    const { db, calls } = fakeDb({}, { ...context, halted: "seller" });
    const result = await runAgentPass(db);
    expect(result.moved).toBe(0);
    expect(calls.some((call) => call.text.includes("agent_offer_move"))).toBe(false);
    expect(calls.at(-1)!.values).toEqual(["j", "lease", "retry", "AG004", false]);
  });

  it("maps every refusal to retry, cancel or fail", () => {
    expect(handBack("AG004")).toEqual({ outcome: "retry", endTask: false });
    expect(handBack("OF003")).toEqual({ outcome: "cancelled", endTask: false });
    expect(handBack("OF007")).toEqual({ outcome: "failed", endTask: true });
    expect(handBack("AG006")).toEqual({ outcome: "failed", endTask: false });
    expect(handBack("AG001")).toBeNull();
    expect(handBack(undefined)).toEqual({ outcome: "retry", endTask: false });
  });

  it("gives the buyer's agent its ceiling and never a floor", () => {
    const input = negotiationInput({ ...context, task: { ...context.task, scope: "buyer" }, effective_floor_cents: null, mandate: { ...context.mandate, ceiling_cents: 90000, ceiling_basis: "item" } });
    expect(input.limits).toEqual({ ceilingCents: 90000, ceilingBasis: "item", targetCents: null });
  });
});

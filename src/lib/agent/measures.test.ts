import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AGENT_MEASURES,
  approximationNote,
  explainReading,
  formatMeasure,
  formatReading,
  MEASURE_MIN_SAMPLE,
  type MeasureDef,
  readMeasure,
} from "./measures";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261024100000_agent_admin_measure.sql"), "utf8");
const doc = readFileSync(join(process.cwd(), "docs/site/agent-measures.md"), "utf8");

function def(scope: MeasureDef["scope"], measure: string): MeasureDef {
  const found = AGENT_MEASURES.find((item) => item.scope === scope && item.measure === measure);
  if (!found) throw new Error(`no measure ${scope}:${measure}`);
  return found;
}

/** Text a cell would show, for asserting no number appears. */
const hasDigit = (text: string) => /\d/.test(text);

describe("agent measures", () => {
  it("every measure with a number is one the database computes; every other one isn't; all are documented", () => {
    for (const item of AGENT_MEASURES) {
      const computed = item.basis.kind === "computed" || item.basis.kind === "approximation";
      if (computed) expect(sql, `${item.measure} isn't computed`).toContain(`'${item.measure}'`);
      else expect(sql, `${item.measure} is computed, so it can't be marked ${item.basis.kind}`).not.toContain(`'${item.measure}'`);
      expect(doc, `${item.measure} isn't in agent-measures.md`).toContain(`\`${item.measure}\``);
    }
  });

  it("every measure the PRD lists for 'Does the agent help?' is on the page with a status", () => {
    for (const measure of [
      "paid_sales_vs_manual",
      "share_without_seller_action",
      "agent_deal_paid_rate",
      "agent_deal_cancel_rate",
      "time_to_first_useful_task",
      "repeat_share",
      "incorrect_action_rate",
      "cost_per_task_usd",
    ]) {
      expect(AGENT_MEASURES.some((item) => item.measure === measure), measure).toBe(true);
    }
  });

  it("each scope and measure pair is listed once", () => {
    const keys = AGENT_MEASURES.map((item) => `${item.scope}:${item.measure}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("formats a suppressed value as a dash", () => {
    expect(formatMeasure("share", null)).toBe("—");
    expect(formatMeasure("share", 0.256)).toBe("26%");
    expect(formatMeasure("usd", 1.5)).toBe("$1.50");
  });
});

describe("measure statuses", () => {
  it("unavailable instrumentation: the headline has no manual-listing baseline, whatever is stored", () => {
    const headline = def("seller", "paid_sales_vs_manual");
    const reading = readMeasure(headline, { value: 0.4, sample: 50 }, true);
    expect(reading.status).toBe("unavailable_instrumentation");
    expect(explainReading(reading)).toMatch(/No manual-listing baseline/);
    expect(formatReading(headline, reading)).toBe("Unavailable");
  });

  it("unavailable instrumentation: true per-task cost, since chat turns record no task", () => {
    const reading = readMeasure(def("all", "cost_per_task_usd"), undefined, true);
    expect(reading.status).toBe("unavailable_instrumentation");
    expect(explainReading(reading)).toMatch(/record no task/);
  });

  it("missing computation: a measure the records support but nothing computes", () => {
    const net = def("seller", "agent_net_sales_usd");
    const reading = readMeasure(net, { value: 120, sample: 9 }, true);
    expect(reading.status).toBe("missing_computation");
    expect(formatReading(net, reading)).toBe("Not computed");
  });

  it("missing computation: a day the job never computed is not a zero", () => {
    const offers = def("seller", "offers_handled");
    const reading = readMeasure(offers, undefined, false);
    expect(reading.status).toBe("missing_computation");
    expect(hasDigit(formatReading(offers, reading))).toBe(false);
  });

  it("missing computation: an ungrouped measure with no row on a computed day", () => {
    expect(readMeasure(def("all", "permission_denials"), undefined, true).status).toBe("missing_computation");
  });

  it("missing computation: enough cases but no stored value", () => {
    expect(readMeasure(def("seller", "price_position"), { value: null, sample: 8 }, true).status).toBe("missing_computation");
  });

  it("insufficient sample: fewer than five cases is suppressed, never shown as a number", () => {
    const share = def("seller", "share_without_seller_action");
    const reading = readMeasure(share, { value: null, sample: MEASURE_MIN_SAMPLE - 1 }, true);
    expect(reading).toEqual({ status: "insufficient_sample", sample: MEASURE_MIN_SAMPLE - 1 });
    expect(formatReading(share, reading)).toBe(`Under ${MEASURE_MIN_SAMPLE}`);
    // A count of 1–4 is suppressed too.
    expect(readMeasure(def("seller", "agent_deals"), { value: null, sample: 3 }, true).status).toBe("insufficient_sample");
  });

  it("insufficient sample: a share, median or ratio with no cases has nothing to measure", () => {
    for (const [scope, measure] of [
      ["seller", "agent_deal_cancel_rate"],
      ["seller", "price_position"],
      ["all", "cost_per_completed_task_usd"],
    ] as const) {
      const reading = readMeasure(def(scope, measure), { value: null, sample: 0 }, true);
      expect(reading.status, measure).toBe("insufficient_sample");
      expect(explainReading(reading)).toMatch(/No cases/);
    }
    // Grouped by scope: no approvals that day writes no row at all.
    expect(readMeasure(def("seller", "minutes_to_answer"), undefined, true).status).toBe("insufficient_sample");
  });

  it("measured zero: a total with no cases is a real zero", () => {
    const denials = def("all", "permission_denials");
    const reading = readMeasure(denials, { value: null, sample: 0 }, true);
    expect(reading).toEqual({ status: "measured_zero", sample: 0 });
    expect(formatReading(denials, reading)).toBe("0");
    expect(formatReading(def("all", "model_cost_usd"), readMeasure(def("all", "model_cost_usd"), { value: null, sample: 0 }, true))).toBe("$0.00");
    // Grouped by scope: no approvals asked that day is zero approvals.
    expect(readMeasure(def("buyer", "approvals"), undefined, true).status).toBe("measured_zero");
  });

  it("measured zero: a share of zero over enough cases", () => {
    const cancel = def("seller", "agent_deal_cancel_rate");
    const reading = readMeasure(cancel, { value: 0, sample: 12 }, true);
    expect(reading).toEqual({ status: "measured_zero", sample: 12 });
    expect(formatReading(cancel, reading)).toBe("0%");
  });

  it("measured: a value over enough cases", () => {
    const paid = def("seller", "agent_deal_paid_rate");
    const reading = readMeasure(paid, { value: 0.8, sample: 10 }, true);
    expect(reading).toEqual({ status: "measured", value: 0.8, sample: 10 });
    expect(formatReading(paid, reading)).toBe("80%");
  });
});

describe("approximation labels", () => {
  it("price position says it uses the current asking price and latest minimum", () => {
    expect(approximationNote(def("seller", "price_position"))).toMatch(/current asking price.*latest mandate minimum/);
  });

  it("repeat use and active members say they read the mutable updated_at", () => {
    expect(approximationNote(def("all", "repeat_share"))).toMatch(/updated_at, which every later change overwrites/);
    expect(approximationNote(def("all", "active_members"))).toMatch(/updated_at, which every later change overwrites/);
  });

  it("daily cost divided by tasks is labelled as not a per-task cost", () => {
    const ratio = def("all", "cost_per_completed_task_usd");
    expect(ratio.label).toBe("Daily model cost ÷ tasks completed");
    expect(approximationNote(ratio)).toMatch(/^Not a per-task cost/);
  });

  it("order outcomes say they are the status at the day's last recompute", () => {
    for (const measure of ["agent_deal_cancel_rate", "agent_deal_paid_rate"]) {
      expect(approximationNote(def("seller", measure)), measure).toMatch(/status as of the day's last recompute/);
    }
  });

  it("answers and their timing say later answers aren't seen", () => {
    expect(approximationNote(def("seller", "approvals_answered"))).toMatch(/later answer still counts as waiting/);
    expect(approximationNote(def("seller", "minutes_to_answer"))).toMatch(/slowest answers are left out/);
    expect(approximationNote(def("seller", "share_without_seller_action"))).toMatch(/steps in later isn't seen/);
  });

  it("model cost says it is a lower bound", () => {
    expect(approximationNote(def("all", "model_cost_usd"))).toMatch(/^A lower bound/);
  });

  it("exact and unmeasured measures carry no approximation label", () => {
    expect(approximationNote(def("seller", "offers_handled"))).toBeNull();
    expect(approximationNote(def("all", "permission_denials"))).toBeNull();
    expect(approximationNote(def("seller", "paid_sales_vs_manual"))).toBeNull();
  });

  it("an approximation is still read like any computed measure", () => {
    const reading = readMeasure(def("seller", "price_position"), { value: 0.42, sample: 6 }, true);
    expect(formatReading(def("seller", "price_position"), reading)).toBe("0.42");
  });
});

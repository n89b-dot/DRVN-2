import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AGENT_MEASURES, formatMeasure } from "./measures";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261024100000_agent_admin_measure.sql"), "utf8");
const doc = readFileSync(join(process.cwd(), "docs/site/agent-measures.md"), "utf8");

describe("agent measures", () => {
  it("every measure on the admin page is one the database computes, and is documented", () => {
    for (const def of AGENT_MEASURES) {
      expect(sql, `${def.measure} isn't computed`).toContain(`'${def.measure}'`);
      expect(doc, `${def.measure} isn't in agent-measures.md`).toContain(`\`${def.measure}\``);
    }
  });

  it("formats a suppressed value as a dash", () => {
    expect(formatMeasure("share", null)).toBe("—");
    expect(formatMeasure("share", 0.256)).toBe("26%");
    expect(formatMeasure("usd", 1.5)).toBe("$1.50");
  });
});

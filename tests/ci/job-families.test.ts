// N680: the job inventory cannot lose a worker family silently. Three copies
// of the family list must agree: the runbook's (docs/production-runbook.md §4,
// between the job-families markers), the SQL guard's values clause
// (supabase/tests/job_inventory_health_guard.sql, FAIL 4b–4c) and the app's
// (src/lib/job-inventory.ts, which job-inventory.test.ts holds to the latest
// migration). A restatement that drops a family fails the guard on the
// database; a change to the list has to touch all three on purpose.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { JOB_INVENTORY } from "../../src/lib/job-inventory";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

/** "job:family" pairs, sorted. */
const pairs = (rows: Array<[string, string]>) => rows.map(([job, family]) => `${job}:${family}`).sort();

export function runbookFamilies(runbook: string): string[] {
  const block = runbook.split("<!-- job-families:start -->")[1]?.split("<!-- job-families:end -->")[0];
  if (!block) throw new Error("docs/production-runbook.md has no job-families block");
  const rows: Array<[string, string]> = [];
  for (const line of block.split("\n")) {
    const match = /^- `(drvn-[a-z-]+)`: (.+)$/.exec(line.trim());
    if (!match) continue;
    for (const family of match[2].matchAll(/`([A-Za-z]+)`/g)) rows.push([match[1], family[1]]);
  }
  return pairs(rows);
}

export function guardFamilies(guard: string): string[] {
  const block = guard.split("insert into pg_temp.expected_families(job, family) values")[1]?.split(";")[0];
  if (!block) throw new Error("job_inventory_health_guard.sql has no expected_families list");
  return pairs([...block.matchAll(/\('(drvn-[a-z-]+)', '([A-Za-z]+)'\)/g)].map((m) => [m[1], m[2]] as [string, string]));
}

describe("worker families stay complete (N680)", () => {
  const app = pairs(JOB_INVENTORY.flatMap((entry) => entry.families.map((family) => [entry.job, family] as [string, string])));

  it("N680: the runbook lists every family the app's inventory has, job by job", () => {
    expect(runbookFamilies(read("docs/production-runbook.md"))).toEqual(app);
  });

  it("N680: the SQL guard holds the database to the same list", () => {
    expect(guardFamilies(read("supabase/tests/job_inventory_health_guard.sql"))).toEqual(app);
  });

  it("N680: the money pass keeps payoutDeadlines and the daily jobs keep theirs", () => {
    for (const pair of ["drvn-transfer-worker:payoutDeadlines", "drvn-ledger-reconciliation:ledgerReconciliation", "drvn-saved-search-digests:savedSearchDigests"]) {
      expect(app).toContain(pair);
    }
  });

  it("N680: the parsers fail when a family is dropped", () => {
    const runbook = read("docs/production-runbook.md").replace(", `payoutDeadlines`", "");
    expect(runbookFamilies(runbook)).not.toEqual(app);
    const guard = read("supabase/tests/job_inventory_health_guard.sql").replace("    ('drvn-transfer-worker', 'payoutDeadlines'),\n", "");
    expect(guardFamilies(guard)).not.toEqual(app);
  });
});

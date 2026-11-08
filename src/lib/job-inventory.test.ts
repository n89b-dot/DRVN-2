import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REQUIRED_FAMILIES, REQUIRED_JOBS } from "../../scripts/check-worker-health.mjs";

import { JOB_INVENTORY, JOB_NAMES, WORKER_FAMILIES } from "./job-inventory";

const MIGRATIONS = resolve(__dirname, "..", "..", "supabase", "migrations");
const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
const read = (name: string) => readFileSync(join(MIGRATIONS, name), "utf8");

/** What pg_cron runs after every migration in order: the last schedule of each name. */
function scheduledByMigrations(): Map<string, string> {
  const jobs = new Map<string, string>();
  const pattern = /cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'/g;
  for (const name of files) for (const match of read(name).matchAll(pattern)) jobs.set(match[1], match[2]);
  return jobs;
}

/** The rows of the latest private.scheduled_job_inventory() definition. */
function databaseInventory(): Map<string, { schedule: string; families: string[]; budget: string }> {
  const latest = files.filter((name) => read(name).includes("function private.scheduled_job_inventory()")).at(-1);
  if (!latest) throw new Error("no migration defines private.scheduled_job_inventory()");
  const body = read(latest).split("function private.scheduled_job_inventory()")[1].split("$$;")[0];
  const rows = new Map<string, { schedule: string; families: string[]; budget: string }>();
  const row = /\('(drvn-[^']+)',\s*'([^']+)',\s*'(?:[^']|'')*',\s*array\[([^\]]*)\](?:::text\[\])?,\s*interval '([^']+)'\)/g;
  for (const match of body.matchAll(row)) {
    rows.set(match[1], { schedule: match[2], families: match[3].split(",").map((f) => f.trim().replace(/^'|'$/g, "")).filter(Boolean), budget: match[4] });
  }
  return rows;
}

const minutes = (interval: string) => {
  const [amount, unit] = interval.split(" ");
  return Number(amount) * (unit.startsWith("hour") ? 60 : 1);
};

describe("the one job inventory", () => {
  it("lists exactly the jobs the migrations schedule, on the same schedules", () => {
    const scheduled = scheduledByMigrations();
    expect([...scheduled.keys()].sort()).toEqual([...JOB_NAMES].sort());
    for (const entry of JOB_INVENTORY) expect(scheduled.get(entry.job), entry.job).toBe(entry.schedule);
  });

  it("matches the database's inventory row for row", () => {
    const database = databaseInventory();
    expect([...database.keys()].sort()).toEqual([...JOB_NAMES].sort());
    for (const entry of JOB_INVENTORY) {
      const row = database.get(entry.job)!;
      expect(row.schedule, entry.job).toBe(entry.schedule);
      expect(row.families, entry.job).toEqual([...entry.families]);
      expect(minutes(row.budget), entry.job).toBe(entry.budgetMinutes);
    }
  });

  it("drives every worker family from exactly one job, agent and the money pass included", () => {
    expect(new Set(WORKER_FAMILIES).size).toBe(WORKER_FAMILIES.length);
    for (const family of ["agent", "transfers", "refunds", "deliveryAutoConfirm", "listingImports", "media"]) expect(WORKER_FAMILIES).toContain(family);
  });

  it("is the list the independent monitor requires", () => {
    expect([...REQUIRED_FAMILIES].sort()).toEqual([...WORKER_FAMILIES].sort());
    expect([...REQUIRED_JOBS].sort()).toEqual([...JOB_NAMES].sort());
  });

  it("is the table the production runbook tells an operator to check (R76)", () => {
    const runbook = readFileSync(resolve(__dirname, "..", "..", "docs", "production-runbook.md"), "utf8");
    const rows = [...runbook.matchAll(/^\| `(drvn-[a-z-]+)` \| `([^`]+)` \|/gm)].map((match) => `${match[1]} ${match[2]}`);
    expect(rows.sort()).toEqual(JOB_INVENTORY.map((entry) => `${entry.job} ${entry.schedule}`).sort());
    const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    const teens = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
    const n = JOB_INVENTORY.length;
    const count = n < 10 ? ones[n] : n < 20 ? teens[n - 10] : `twenty${n % 10 ? `-${ones[n % 10]}` : ""}`;
    expect(n).toBeLessThan(30);
    expect(runbook).toContain(`Confirm the ${count} pg_cron jobs`);
  });

  it("gives each job a budget of more than one interval", () => {
    for (const entry of JOB_INVENTORY) {
      const every = /^\*\/(\d+) \* \* \* \*$/.exec(entry.schedule);
      const interval = every ? Number(every[1]) : entry.schedule === "30 seconds" ? 0.5 : /^\d+ \* \* \* \*$/.test(entry.schedule) ? 60 : 24 * 60;
      expect(entry.budgetMinutes, entry.job).toBeGreaterThan(interval);
    }
  });
});

describe("the chat photo sweep's cadence (N232)", () => {
  // The storage reference report counts a missing chat photo as retention
  // only once a sweep pass can have run since it turned 48 hours old
  // (private.agent_chat_sweep_interval). The sweep runs in every
  // drvn-agent-worker pass, so the two intervals must agree.
  it("matches drvn-agent-worker's schedule", () => {
    const latest = files.filter((name) => read(name).includes("function private.agent_chat_sweep_interval()")).at(-1)!;
    const interval = /agent_chat_sweep_interval\(\)[\s\S]*?select interval '(\d+) minutes'/.exec(read(latest))?.[1];
    const agent = JOB_INVENTORY.find((entry) => entry.job === "drvn-agent-worker")!;
    expect(agent.families).toContain("agent");
    expect(agent.schedule).toBe(`*/${interval} * * * *`);
  });
});

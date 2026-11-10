import { expect, it } from "vitest";

import { REQUIRED_CONFIG } from "../../scripts/check-worker-health.mjs";

import { secretDigestHex } from "./cron-auth";
import { JOB_INVENTORY, JOB_NAMES } from "./job-inventory";
import { EMAIL_ONLY_FAMILY, EMAIL_ONLY_JOB, WORKER_FAMILIES, evaluateWorkerHealth, workerUrlStatus } from "./worker-health";

const SECRET = "c".repeat(40);
const config = { searchEnabled: true, analyticsEnabled: true, emailEnabled: true, cronSecret: SECRET };
const snapshot = () => ({
  families: WORKER_FAMILIES.map((family) => ({ family, stale: false, reason: null as string | null, last_success: "2026-11-07T10:00:00Z" })),
  jobs: JOB_NAMES.map((job) => ({ job, stale: false, reason: null as string | null, last_success: "2026-11-07T10:00:00Z" })),
  queues: [] as { kind: string; status: string; overdue: boolean; count?: number; oldest?: string; attempts_max?: number | null }[],
  config: {
    scheduler: true,
    run_history: true,
    pg_net: true,
    worker_url: "https://drvn.example/api/jobs/transfers",
    worker_secret_sha256: secretDigestHex(SECRET),
  } as Record<string, unknown>,
});

it("is healthy, with no problems, when everything ran", () => {
  const result = evaluateWorkerHealth(snapshot(), config);
  expect(result.unhealthy).toBe(false);
  expect(result.problems).toEqual([]);
  expect(result.config).toEqual({ scheduler: "ok", runHistory: "ok", pgNet: "ok", workerUrl: "ok", workerSecret: "ok" });
});

it("does not mistake duplicate, malformed or missing families and jobs for full coverage", () => {
  const dup = snapshot(); dup.families[1] = dup.families[0];
  expect(() => evaluateWorkerHealth(dup, config)).toThrow("Incomplete");
  const noAgent = snapshot(); noAgent.families = noAgent.families.filter((f) => f.family !== "agent");
  expect(() => evaluateWorkerHealth(noAgent, config)).toThrow("Incomplete");
  const noJob = snapshot(); noJob.jobs = noJob.jobs.filter((j) => j.job !== "drvn-explore-trending");
  expect(() => evaluateWorkerHealth(noJob, config)).toThrow("Incomplete");
  const old = snapshot() as Partial<ReturnType<typeof snapshot>>; delete old.jobs;
  expect(() => evaluateWorkerHealth(old, config)).toThrow("Incomplete");
});

it("names a stopped job, a failing family and an overdue queue", () => {
  const s = snapshot();
  s.jobs.find((j) => j.job === "drvn-search-words")!.stale = true;
  s.jobs.find((j) => j.job === "drvn-search-words")!.reason = "overdue";
  s.families.find((f) => f.family === "refunds")!.stale = true;
  s.families.find((f) => f.family === "refunds")!.reason = "failing";
  s.queues.push({ kind: "webhooks", status: "retrying", overdue: true, count: 2, oldest: "2026-11-07T08:00:00Z", attempts_max: 5 });
  s.queues.push({ kind: "transfers", status: "blocked_unpayable", overdue: false, count: 4 });
  const result = evaluateWorkerHealth(s, config);
  expect(result.unhealthy).toBe(true);
  expect(result.problems).toEqual([
    { area: "job", name: "drvn-search-words", reason: "overdue", since: "2026-11-07T10:00:00Z" },
    { area: "family", name: "refunds", reason: "failing", since: "2026-11-07T10:00:00Z" },
    { area: "queue", name: "webhooks/retrying", reason: "overdue", since: "2026-11-07T08:00:00Z", count: 2, attempts: 5 },
  ]);
});

it("surfaces held recovery and stuck processing, which the database marks overdue", () => {
  for (const q of [{ kind: "financial_recovery", status: "open", overdue: true }, { kind: "transfers", status: "processing", overdue: true }]) {
    const s = snapshot(); s.queues.push(q);
    expect(evaluateWorkerHealth(s, config).unhealthy).toBe(true);
  }
});

it("explicitly disables only optional configured-off work", () => {
  const s = snapshot();
  s.families.find((f) => f.family === "analytics")!.stale = true;
  s.queues.push({ kind: "analytics", status: "failed", overdue: true });
  expect(evaluateWorkerHealth(s, { ...config, analyticsEnabled: false }).unhealthy).toBe(false);
  s.queues.push({ kind: "financial_recovery", status: "open", overdue: true });
  expect(evaluateWorkerHealth(s, { ...config, searchEnabled: false, analyticsEnabled: false }).unhealthy).toBe(true);
});

// Plan 2 item A5: with no email provider chosen (R-email) the hourly digest
// job has nothing to send, so neither it nor its family can page anyone. The
// moment a provider is configured they are judged like every other job.
it("leaves the saved-search digest job and family out of health while no email provider exists (R-email)", () => {
  const s = snapshot();
  const job = s.jobs.find((j) => j.job === "drvn-saved-search-digests")!;
  job.stale = true;
  job.reason = "overdue";
  const family = s.families.find((f) => f.family === "savedSearchDigests")!;
  family.stale = true;
  family.reason = "failing";

  const withProvider = evaluateWorkerHealth(s, config);
  expect(withProvider.unhealthy).toBe(true);
  expect(withProvider.problems).toEqual([
    { area: "job", name: "drvn-saved-search-digests", reason: "overdue", since: "2026-11-07T10:00:00Z" },
    { area: "family", name: "savedSearchDigests", reason: "failing", since: "2026-11-07T10:00:00Z" },
  ]);

  const withoutProvider = evaluateWorkerHealth(s, { ...config, emailEnabled: false });
  expect(withoutProvider.unhealthy).toBe(false);
  expect(withoutProvider.problems).toEqual([]);
  // Still listed, and marked, so the monitor's completeness check passes and
  // an operator can see why it is not judged.
  expect(withoutProvider.jobs.find((j) => j.job === "drvn-saved-search-digests")).toMatchObject({ stale: false, disabled: true, reason: "overdue" });
  expect(withoutProvider.families.find((f) => f.family === "savedSearchDigests")).toMatchObject({ stale: false, disabled: true });
});

it("the job that leaves health with email drives the digest family and nothing else (R-email)", () => {
  expect(JOB_INVENTORY.find((entry) => entry.job === EMAIL_ONLY_JOB)?.families).toEqual([EMAIL_ONLY_FAMILY]);
  expect(JOB_INVENTORY.filter((entry) => entry.families.includes(EMAIL_ONLY_FAMILY)).map((entry) => entry.job)).toEqual([EMAIL_ONLY_JOB]);
});

it("with no email provider, every other job and family is still judged (R-email)", () => {
  const s = snapshot();
  s.jobs.find((j) => j.job === "drvn-saved-search-worker")!.stale = true;
  s.families.find((f) => f.family === "savedSearches")!.stale = true;
  s.families.find((f) => f.family === "receipts")!.stale = true;
  const result = evaluateWorkerHealth(s, { ...config, emailEnabled: false });
  expect(result.problems.map((p) => `${p.area}:${p.name}`)).toEqual(["job:drvn-saved-search-worker", "family:savedSearches", "family:receipts"]);
  expect(result.jobs.filter((j) => j.disabled).map((j) => j.job)).toEqual(["drvn-saved-search-digests"]);
  expect(result.families.filter((f) => f.disabled).map((f) => f.family)).toEqual(["savedSearchDigests"]);
});

it("reports scheduler configuration that would leave every HTTP worker silent", () => {
  const cases: [Record<string, unknown>, string, string][] = [
    [{ worker_url: null }, "workerUrl", "missing"],
    [{ worker_url: "http://drvn.example/api/jobs/transfers" }, "workerUrl", "invalid"],
    [{ worker_url: "https://drvn.example/api/jobs/search" }, "workerUrl", "invalid"],
    [{ worker_secret_sha256: null }, "workerSecret", "missing"],
    [{ worker_secret_sha256: secretDigestHex("not the deployment's secret") }, "workerSecret", "mismatch"],
    [{ scheduler: false }, "scheduler", "missing"],
    [{ run_history: false }, "runHistory", "disabled"],
    [{ pg_net: false }, "pgNet", "missing"],
  ];
  for (const [change, name, reason] of cases) {
    const s = snapshot(); Object.assign(s.config, change);
    const result = evaluateWorkerHealth(s, config);
    expect(result.problems, name).toEqual([{ area: "config", name, reason }]);
  }
});

it("never returns the scheduler's URL or secret digest", () => {
  const result = evaluateWorkerHealth(snapshot(), config);
  const text = JSON.stringify(result);
  expect(text).not.toContain(secretDigestHex(SECRET));
  expect(text).not.toContain("drvn.example");
});

it("accepts a local worker URL over http only for loopback", () => {
  expect(workerUrlStatus("http://localhost:3005/api/jobs/transfers")).toBe("ok");
  expect(workerUrlStatus("https://user:pw@drvn.example/api/jobs/transfers")).toBe("invalid");
  expect(workerUrlStatus("not a url")).toBe("invalid");
});

it("reports exactly the configuration checks the independent monitor requires", () => {
  const result = evaluateWorkerHealth(snapshot(), config);
  expect(Object.keys(result.config).sort()).toEqual(Object.keys(REQUIRED_CONFIG).sort());
  const unchecked = evaluateWorkerHealth(snapshot(), { ...config, cronSecret: undefined });
  expect(unchecked.problems).toEqual([{ area: "config", name: "workerSecret", reason: "unchecked" }]);
  for (const [name, state] of Object.entries(unchecked.config)) expect((REQUIRED_CONFIG as Record<string, string[]>)[name]).toContain(state);
});

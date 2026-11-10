import { secretDigestHex, secretsEqual } from "./cron-auth";
import { JOB_NAMES, WORKER_FAMILIES } from "./job-inventory";

export { WORKER_FAMILIES } from "./job-inventory";

type Family = { family: string; stale: boolean; reason?: string | null; last_success?: string | null; disabled?: boolean };
type Job = { job: string; stale: boolean; reason?: string | null; last_success?: string | null; families?: string[]; disabled?: boolean };
type Queue = { kind: string; status: string; overdue: boolean; count?: number; oldest?: string | null; attempts_max?: number | null; disabled?: boolean };
type RawConfig = {
  scheduler?: boolean;
  run_history?: boolean;
  pg_net?: boolean;
  worker_url?: string | null;
  worker_secret_sha256?: string | null;
};

/**
 * One thing an operator must act on. `area` and `name` say where (a worker
 * family, a pg_cron job, a queue as kind/status, or a piece of configuration);
 * `reason` says what, in the snapshot's own words. Never carries a secret,
 * URL or member data — it is what the paging destination receives.
 */
export type HealthProblem = {
  area: "family" | "job" | "queue" | "config";
  name: string;
  reason: string;
  since?: string | null;
  count?: number;
  attempts?: number | null;
};

export type HealthConfigStatus = {
  scheduler: "ok" | "missing";
  runHistory: "ok" | "disabled";
  pgNet: "ok" | "missing";
  workerUrl: "ok" | "missing" | "invalid";
  workerSecret: "ok" | "missing" | "mismatch" | "unchecked";
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal"]);

/** The scheduler's one worker URL (invoke_*_worker derive every route from it). */
export function workerUrlStatus(value: string | null | undefined): HealthConfigStatus["workerUrl"] {
  if (!value) return "missing";
  let url: URL;
  try { url = new URL(value); } catch { return "invalid"; }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  return secure && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith("/api/jobs/transfers") ? "ok" : "invalid";
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

// The one job, and the one family it drives, that exist only to send email.
// job-inventory.test.ts would fail if the inventory stopped pairing them.
export const EMAIL_ONLY_JOB = "drvn-saved-search-digests";
export const EMAIL_ONLY_FAMILY = "savedSearchDigests";

/**
 * Validates worker_health_snapshot() against the inventory this deployment
 * expects and turns it into problems. Throws when the snapshot is incomplete,
 * so a partial read can never look healthy. `cronSecret` is the deployment's
 * CRON_SECRET: the scheduler's copy (job_config) is compared with it as a
 * digest, so a scheduler sending the wrong bearer shows up as configuration,
 * not as every HTTP worker going quiet at once.
 *
 * Work whose provider this deployment has not configured is listed but not
 * judged (`disabled: true`): the search and analytics families and their
 * queues, and, with no email provider, the saved-search digest job and its
 * family (plan 2 item A5: the hourly job has nothing to send until a provider
 * is chosen, so it must not page). Configure the provider and the same rows
 * are judged again.
 */
export function evaluateWorkerHealth(
  value: unknown,
  config: { searchEnabled: boolean; analyticsEnabled: boolean; emailEnabled: boolean; cronSecret?: string },
) {
  const health = value as { families?: Family[]; jobs?: Job[]; queues?: Queue[]; config?: RawConfig } | null;
  const complete = <T, K extends keyof T>(rows: T[] | undefined, key: K, required: readonly string[]) =>
    Array.isArray(rows) &&
    rows.every((row) => row && isText(row[key]) && typeof (row as { stale?: unknown }).stale === "boolean") &&
    new Set(rows.map((row) => row[key])).size === rows.length &&
    required.every((name) => rows.some((row) => row[key] === name));
  if (
    !health ||
    !complete(health.families, "family", WORKER_FAMILIES) ||
    !complete(health.jobs, "job", JOB_NAMES) ||
    !Array.isArray(health.queues) ||
    health.queues.some((q) => !q || !isText(q.kind) || !isText(q.status) || typeof q.overdue !== "boolean") ||
    !health.config ||
    typeof health.config !== "object"
  ) throw new Error("Incomplete worker health contract");

  const disabled = new Set<string>();
  if (!config.searchEnabled) disabled.add("search");
  if (!config.analyticsEnabled) disabled.add("analytics");
  const disabledJobs = new Set<string>();
  if (!config.emailEnabled) {
    disabled.add(EMAIL_ONLY_FAMILY);
    disabledJobs.add(EMAIL_ONLY_JOB);
  }
  const families = health.families!.map((f) => (disabled.has(f.family) ? { ...f, stale: false, disabled: true } : f));
  const jobs = health.jobs!.map((j) => (disabledJobs.has(j.job) ? { ...j, stale: false, disabled: true } : j));
  const queues = health.queues.map((q) => (disabled.has(q.kind) ? { ...q, disabled: true } : q));

  const raw = health.config;
  const secretDigest = raw.worker_secret_sha256;
  const status: HealthConfigStatus = {
    scheduler: raw.scheduler === true ? "ok" : "missing",
    runHistory: raw.run_history === true ? "ok" : "disabled",
    pgNet: raw.pg_net === true ? "ok" : "missing",
    workerUrl: workerUrlStatus(raw.worker_url),
    workerSecret: !secretDigest
      ? "missing"
      : !config.cronSecret
        ? "unchecked"
        : secretsEqual(secretDigest, secretDigestHex(config.cronSecret)) ? "ok" : "mismatch",
  };

  const problems: HealthProblem[] = [];
  for (const [name, state] of Object.entries(status)) {
    // An unverified secret is not a verified one: only "ok" passes.
    if (state !== "ok") problems.push({ area: "config", name, reason: state });
  }
  for (const job of jobs) {
    if (job.stale) problems.push({ area: "job", name: job.job, reason: job.reason ?? "stale", since: job.last_success ?? null });
  }
  for (const family of families) {
    if (family.stale) problems.push({ area: "family", name: family.family, reason: family.reason ?? "stale", since: family.last_success ?? null });
  }
  for (const queue of queues) {
    if (!queue.disabled && queue.overdue) {
      problems.push({ area: "queue", name: `${queue.kind}/${queue.status}`, reason: "overdue", since: queue.oldest ?? null, count: queue.count, attempts: queue.attempts_max ?? null });
    }
  }

  // The scheduler's secret and URL never leave this function.
  return { families, jobs, queues, config: status, problems, unhealthy: problems.length > 0 };
}

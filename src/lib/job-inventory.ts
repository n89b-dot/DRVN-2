/**
 * Every job pg_cron must run, as `private.scheduled_job_inventory()`
 * (latest 20261108100000) lists them: name, exact schedule, the worker families it
 * drives (recorded in worker_runs by the route or function it calls) and how
 * long it may go without a successful run. The database's copy is the one
 * health judges against; this copy lets the app and the independent monitor
 * check that the snapshot covers all of them. `job-inventory.test.ts` holds
 * both copies, the monitor's lists and the migrations' cron.schedule calls to
 * the same set.
 */
export type ScheduledJob = {
  job: string;
  schedule: string;
  /** Worker families this job's run is recorded as; empty for SQL-only jobs. */
  families: readonly string[];
  budgetMinutes: number;
};

export const JOB_INVENTORY: readonly ScheduledJob[] = [
  { job: "drvn-agent-worker", schedule: "*/5 * * * *", families: ["agent"], budgetMinutes: 30 },
  { job: "drvn-cron-history-prune", schedule: "27 4 * * *", families: [], budgetMinutes: 26 * 60 },
  { job: "drvn-deletion-worker", schedule: "*/5 * * * *", families: ["deletions"], budgetMinutes: 30 },
  { job: "drvn-delivery-auto-confirm", schedule: "23 * * * *", families: ["deliveryAutoConfirm"], budgetMinutes: 180 },
  { job: "drvn-dispute-sla", schedule: "5 8 * * *", families: [], budgetMinutes: 26 * 60 },
  { job: "drvn-explore-builders", schedule: "*/10 * * * *", families: [], budgetMinutes: 30 },
  { job: "drvn-explore-trending", schedule: "*/2 * * * *", families: [], budgetMinutes: 30 },
  { job: "drvn-grow-products", schedule: "17 * * * *", families: [], budgetMinutes: 180 },
  { job: "drvn-grow-products-full", schedule: "47 4 * * *", families: [], budgetMinutes: 26 * 60 },
  // Read-only Stripe ↔ ledger comparison (N115, lib/payments/ledger-reconciliation.ts).
  { job: "drvn-ledger-reconciliation", schedule: "50 5 * * *", families: ["ledgerReconciliation"], budgetMinutes: 26 * 60 },
  { job: "drvn-listing-edit-sweep", schedule: "45 3 * * *", families: [], budgetMinutes: 26 * 60 },
  { job: "drvn-listing-import-sweep", schedule: "37 3 * * *", families: ["listingImports"], budgetMinutes: 26 * 60 },
  { job: "drvn-marketplace-counts", schedule: "30 seconds", families: [], budgetMinutes: 10 },
  { job: "drvn-media-gc", schedule: "17 3 * * *", families: ["media"], budgetMinutes: 26 * 60 },
  { job: "drvn-prune-rate-limits", schedule: "15 3 * * *", families: [], budgetMinutes: 26 * 60 },
  { job: "drvn-release-reservations", schedule: "*/5 * * * *", families: [], budgetMinutes: 30 },
  { job: "drvn-saved-search-digests", schedule: "41 * * * *", families: ["savedSearchDigests"], budgetMinutes: 180 },
  { job: "drvn-saved-search-worker", schedule: "*/30 * * * *", families: ["savedSearches"], budgetMinutes: 90 },
  { job: "drvn-search-words", schedule: "23 * * * *", families: [], budgetMinutes: 180 },
  { job: "drvn-search-worker", schedule: "*/2 * * * *", families: ["search"], budgetMinutes: 30 },
  {
    job: "drvn-transfer-worker",
    schedule: "*/10 * * * *",
    // The whole money pass (runMoneyWorkerPass).
    families: ["expiries", "captures", "transfers", "transferReconciliation", "refunds", "labelVoids", "returns", "disputes", "payoutDeadlines", "alerts", "receipts", "analytics"],
    budgetMinutes: 30,
  },
];

export const JOB_NAMES: readonly string[] = JOB_INVENTORY.map((entry) => entry.job);

/** Every worker family, each driven by exactly one job. */
export const WORKER_FAMILIES: readonly string[] = JOB_INVENTORY.flatMap((entry) => entry.families);

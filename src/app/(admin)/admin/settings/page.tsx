import { cookies } from "next/headers";

import { Rv } from "@/components/livesheet";
import {
  AUDIT_PAGE_SIZE,
  DISPUTE_SLA_DAYS,
  ORDERS_PAGE_SIZE,
  getAdminRoster,
  getWorkerJobs,
  type WorkerJobRow,
} from "@/lib/admin/queries";
import { resolvePaymentsMode, type PaymentsMode } from "@/lib/env";
import { cx } from "@/lib/format";

import { TestAlertButton, ThemeSetting } from "./settings-controls";

export const dynamic = "force-dynamic";

/** The five events the webhook carries — mirrored from lib/admin/alerts.ts. */
const ALERT_TRIGGERS = [
  "dispute over SLA",
  "dispute escalated",
  "auto-refund failed",
  "recovery case opened",
  "transfer stuck",
];

/** Each background job in the words an operator would use for it. */
const JOB_LABEL: Record<string, string> = {
  expiries: "Release expired holds",
  captures: "Confirm captured payments",
  transfers: "Pay out sellers",
  transferReconciliation: "Reconcile payouts",
  refunds: "Finish interrupted refunds",
  labelVoids: "Void unused shipping labels",
  returns: "Advance return timers",
  disputes: "Dispute deadlines and auto-refunds",
  alerts: "Deliver admin alerts",
  receipts: "Send guest receipts",
  analytics: "Purchase analytics",
  search: "Search index",
  deletions: "Account deletions and exports",
  savedSearches: "Saved-search alerts",
  media: "Clean up unused uploads",
};

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function JobRow({ job }: { job: WorkerJobRow }) {
  const failedLast = Boolean(
    job.lastFailure && (!job.lastSuccess || job.lastFailure > job.lastSuccess)
  );
  const desc = job.disabled
    ? "Switched off in this environment."
    : job.lastSuccess
      ? `Last ran ${ago(job.lastSuccess)}${failedLast && job.lastFailure ? ` · last attempt failed ${ago(job.lastFailure)}` : ""}.`
      : job.lastFailure
        ? `Never succeeded · last attempt failed ${ago(job.lastFailure)}.`
        : "Has never run.";
  const [chip, label] = job.disabled
    ? ["chip", "off"]
    : job.stale
      ? ["chip chip--live", job.lastSuccess ? "overdue" : "never ran"]
      : failedLast
        ? ["chip chip--warn", "retrying"]
        : ["chip chip--ok", "running"];
  return (
    <Setting name={JOB_LABEL[job.family] ?? job.family} desc={desc}>
      <span className={chip}>{label}</span>
    </Setting>
  );
}

function Setting({
  name,
  desc,
  children,
}: {
  name: string;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="setrow">
      <div className="min-w-0">
        <p className="setrow__name">{name}</p>
        <p className="setrow__desc">{desc}</p>
      </div>
      {children && <div className="setrow__ctl">{children}</div>}
    </div>
  );
}

/**
 * Console settings — honest about where each dial actually lives. Two things
 * are settable from a browser (theme, test alert); the rest is deliberately
 * read-only with its real home named, because SLA windows live in code
 * review, secrets live in the deploy environment, and admin keys live in
 * SQL. A settings page that pretended otherwise would be a second, less
 * audited way to run the marketplace.
 */
export default async function AdminSettingsPage() {
  const [roster, jar, jobs] = await Promise.all([getAdminRoster(), cookies(), getWorkerJobs()]);
  const night = jar.get("ls-theme")?.value === "night";

  const webhookUrl = process.env.ADMIN_ALERT_WEBHOOK_URL;
  let webhookHost: string | null = null;
  if (webhookUrl) {
    try {
      webhookHost = new URL(webhookUrl).hostname;
    } catch {
      webhookHost = "configured (unparseable URL)";
    }
  }

  // Env-derived ops state — booleans and the resolved mode only, never the
  // values themselves. resolvePaymentsMode can throw on a fatal shape (e.g.
  // PAYMENTS_MODE=stripe with no secret key); a settings page is exactly the
  // wrong place to crash over that, so it's caught and surfaced as a row.
  let paymentsMode: PaymentsMode | null = null;
  let paymentsModeError: string | null = null;
  try {
    paymentsMode = resolvePaymentsMode();
  } catch (error) {
    paymentsModeError = error instanceof Error ? error.message : "Could not resolve payments mode.";
  }
  const monitoringConfigured = Boolean(process.env.SENTRY_DSN);
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET);
  const overdueJobs = jobs?.filter((job) => job.stale).length ?? 0;

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Settings</h1>
        <p className="pagehead__sub">
          What the console can change from here, and where everything else is really managed.
          Operational dials deliberately live in code, env, and SQL — not behind a form.
        </p>
      </Rv>

      <div className="deck deck--two mb-8">
        <section className="tile" aria-label="Appearance">
          <span className="microlabel">Appearance</span>
          <Setting name="Theme" desc="This browser only — stored as a cookie, shared with the product app.">
            <ThemeSetting initialNight={night} />
          </Setting>
        </section>

        <section className="tile" aria-label="Alerts">
          <span className="microlabel">Alerts</span>
          <Setting
            name="Webhook"
            desc={
              webhookHost
                ? `Delivering to ${webhookHost} — Slack-compatible JSON.`
                : "Not configured. Set ADMIN_ALERT_WEBHOOK_URL in the deploy environment; unset means alerts are silently skipped."
            }
          >
            <span className={cx(webhookHost ? "chip chip--ok" : "chip chip--warn")}>
              {webhookHost ? "configured" : "off"}
            </span>
          </Setting>
          <Setting name="Triggers" desc={ALERT_TRIGGERS.join(" · ")} />
          <Setting name="Delivery check" desc="Posts a harmless test message down the webhook.">
            <TestAlertButton configured={Boolean(webhookHost)} />
          </Setting>
        </section>
      </div>

      <section className="tile mb-8" aria-label="Background jobs">
        <span className="microlabel">Background jobs</span>
        <p className="order__meta mb-2">
          {!cronSecretConfigured
            ? "CRON_SECRET is unset, so the scheduler can't run any job. Set it in the deploy environment."
            : jobs === null
              ? "Couldn't read job history. Reload to try again."
              : overdueJobs
                ? `${overdueJobs} ${overdueJobs === 1 ? "job is" : "jobs are"} overdue — holds, payouts or alerts may be stuck. On a local dev server, run scripts/dev-jobs.sh (see its header).`
                : "Every job has run on schedule."}
        </p>
        {jobs?.map((job) => <JobRow key={job.family} job={job} />)}
      </section>

      <div className="deck deck--two mb-8">
        <section className="tile" aria-label="Operations">
          <span className="microlabel">Operations</span>
          <Setting
            name="Payments mode"
            desc={
              paymentsModeError
                ? "Could not resolve — misconfigured. Fix in the deploy environment; see the exact rule in src/lib/env.ts (resolvePaymentsMode)."
                : paymentsMode === "stripe"
                  ? "Live Stripe integration — real charges, real transfers."
                  : "Stub provider — no real money moves. Fine for dev, refused in production without an explicit override."
            }
          >
            {paymentsModeError ? (
              <span className="chip chip--live">error</span>
            ) : (
              <span className={cx("chip", paymentsMode === "stripe" ? "chip--ok" : "chip--warn")}>
                {paymentsMode}
              </span>
            )}
          </Setting>
          <Setting
            name="Alert destination"
            desc={
              webhookHost
                ? "ADMIN_ALERT_WEBHOOK_URL is set — see Alerts above for delivery detail."
                : "Not configured — alerts accumulate as undelivered outbox rows instead of reaching anyone."
            }
          >
            <span className={cx("chip", webhookHost ? "chip--ok" : "chip--warn")}>
              {webhookHost ? "configured" : "not configured"}
            </span>
          </Setting>
          <Setting
            name="Monitoring (Sentry)"
            desc={
              monitoringConfigured
                ? "SENTRY_DSN is set — errors and captured messages ship there."
                : "SENTRY_DSN is unset — errors log to the platform's own logs only. Required for live-money production (validatePaymentsEnv)."
            }
          >
            <span className={cx("chip", monitoringConfigured ? "chip--ok" : "chip--warn")}>
              {monitoringConfigured ? "configured" : "not configured"}
            </span>
          </Setting>
          <p className="order__meta mt-3">
            Read-only, booleans and resolved mode only — no secret values are ever displayed here.
          </p>
        </section>

        <section className="tile" aria-label="Queues and limits">
          <span className="microlabel">Queues &amp; limits</span>
          <Setting
            name="Dispute SLA"
            desc="Days of seller silence before a dispute is flagged and the sweep escalates it."
          >
            <span className="kv">
              <b>{DISPUTE_SLA_DAYS} days</b>
            </span>
          </Setting>
          <Setting name="Table pages" desc="Rows per page across the console's queues.">
            <span className="kv">
              <b>{ORDERS_PAGE_SIZE}</b>
            </span>
          </Setting>
          <Setting name="Audit pages" desc="Entries per page in the append-only log.">
            <span className="kv">
              <b>{AUDIT_PAGE_SIZE}</b>
            </span>
          </Setting>
          <p className="order__meta mt-3">
            Compiled into the build (src/lib/admin/queries.ts) — changing them is a code review,
            on purpose.
          </p>
        </section>

        <section className="tile" aria-label="Access">
          <span className="microlabel">Access ({roster.length})</span>
          <div className="rowlist">
            {roster.map((m) => {
              const stub = !m.displayName && !m.username;
              return (
                <div key={m.userId} className="jobrow">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className={cx("order__name !text-body", stub && "person--stub")}>
                      {m.displayName ?? (m.username ? `@${m.username}` : `User ${m.userId.slice(0, 8)}`)}
                    </span>
                    {m.role === "viewer" ? (
                      <span className="chip chip--warn">read-only</span>
                    ) : (
                      <span className="status-plain">admin</span>
                    )}
                  </div>
                  <p className="order__meta mt-0.5">
                    since {new Date(m.addedAt).toLocaleDateString()}
                    {m.note && ` · “${m.note}”`}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="order__meta mt-3">
            Membership and roles are managed in SQL (admin_users, 0018/0023) — there is no grant
            button here, by design. Every mutation re-checks this table server-side.
          </p>
        </section>
      </div>
    </>
  );
}

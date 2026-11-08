# Operations — jobs, admin, selling IA, observability

> The operational systems in one place. Runtime procedures (production setup,
> reconciliation, worker scheduling) live in `docs/production-runbook.md`;
> this page explains how the pieces fit.

## Background jobs (brief §AI — decision of record)

DRVN's async architecture is **Postgres-owned**, deliberately:

- **In-database (pg_cron):** reservation release (5 min), rate-limit pruning
  (daily), dispute-SLA sweep (daily), and the HTTP invokers via pg_net —
  transfer worker (10 min), search (2 min), account deletions (5 min),
  saved searches (30 min), media GC and the listing-import sweep (daily).
  Nine jobs in all; the table is in `docs/production-runbook.md` §4. Every
  HTTP job reaches the app through `job_config`'s worker URL and secret.
- **Worker routes** (bearer `CRON_SECRET`, 404 otherwise):
  - `/api/jobs/transfers` — one money pass (`runMoneyWorkerPass`,
    `src/lib/money-worker.ts`): expired holds, capture reconciliation, due
    transfers, transfer reconciliation, refund resume, label voids, return
    timers, dispute SLA, alert outbox, purchase analytics and receipts, each
    recorded in `worker_runs`. The retry heartbeat for every durable money
    queue. The console's "Run worker now" runs exactly this pass.
  - `/api/jobs/search` and `/api/jobs/account-deletions` — search index
    delivery; account deletions and data exports.
  - `/api/jobs/media-gc` — staged-upload sweep (48h, heals before deleting).
  - `/api/jobs/saved-searches` — saved-search matching → one summary
    notification per search per pass.
  - `/api/jobs/listing-imports` — importer retention sweep (0047): expires
    overdue imports (48h) and scrubs source payloads from week-old terminal
    rows. pg_cron runs it daily beside media-gc
    (`drvn-listing-import-sweep`, 20261004150000), tracked as the
    `listingImports` worker family. See [listing-import](listing-import.md).
- **Local dev:** the shared dev database's pg_net can't reach a dev server on
  localhost, so there `scripts/dev-jobs.sh` (launchd agent `cc.drvn2.jobs`,
  every 2 minutes) calls the same routes on the database's schedule, and
  `scripts/dev-stripe-listen.sh` (`cc.drvn2.stripe`) forwards Stripe test
  events. Setup: `docs/production-runbook.md` §12.
- **Durable queues as tables:** `transfer_intents` (leased,
  FOR UPDATE SKIP LOCKED), `refund_operations` (8-state machine),
  `admin_alert_outbox`, `payment_recoveries`, `webhook_events` (dedup).

**Decision:** the new non-financial workloads (search indexing fire-and-forget
+ scripted reindex; saved-search matching on a worker pass) fit this pattern
cleanly, so **PGMQ was not adopted** — nothing currently needs SQS semantics —
and **Redis / Trigger.dev / Inngest are not introduced** (no workload
justifies them; financial truth stays database-owned regardless). Medusa-style
step/compensation ideas informed the worker passes' idempotent, resumable
shape; the framework itself was never a candidate. Revisit PGMQ if a workload
appears that needs competing consumers or backpressure across processes.

## The agent (A2 — foundation, invisible to members)

The agent acts for one member at a time and only through the database.
Decisions of record: [`docs/decisions/agent-foundations.md`](../decisions/agent-foundations.md);
data rules: [`agent-data-rules.md`](../decisions/agent-data-rules.md);
runbook: `docs/production-runbook.md` §13.

- **The worker's identity.** `agent_worker` is its own Postgres role, created
  NOLOGIN by `20261021100100`, with no table grants. It can execute eight
  functions (`agent_claim_jobs`, `agent_renew_lease`, `agent_job_context`,
  `agent_offer_move`, `agent_offer_open`, `agent_request_approval`,
  `agent_record_decision`, `agent_finish_job`). Each write needs a job the
  worker claimed, with a live lease whose action, offer and round match the
  call; the function then loads the owner from task → mandate and re-checks
  role, suspension, mandate state and expiry, limits and the kill switches.
  Giving the role a login is an operator step (runbook §13a);
  `src/lib/agent/worker-db.ts` refuses any connection that isn't agent_worker.
- **The outbox.** A trigger on `offer_rounds` writes `agent_jobs` in the same
  transaction as every move, whoever made it, for the side whose turn it now
  is, and settles tasks when an offer ends. `agent_reconcile_outbox` re-queues
  anything missed and returns lost leases.
- **The pass.** `src/lib/agent/worker.ts` claims jobs, reads the owner's view
  (`agent_job_context`: the owner's own limits, the listing's public facts,
  the moves both sides see), lets `negotiate.ts` decide, and makes the one
  call. A refusal is handed back with its code (`agent_finish_job`), which
  becomes telemetry. `/api/jobs/agent` runs reconcile, retention, one pass
  (only with `AGENT_WORKER_DATABASE_URL`) and the health check.
  `20261026100000_agent_hosted_schedule.sql` schedules it as the
  `drvn-agent-worker` pg_cron job every 5 minutes through
  `invoke_remediation_worker('agent')`, and gives `worker_health_snapshot` an
  `agent` family on a 30-minute budget; the runbook's §4 table lists all
  twenty-one jobs (`private.scheduled_job_inventory()`, mirrored in
  `src/lib/job-inventory.ts`).
- **Kill switches** (`/admin/agent`, `admin_set_agent_control`): all, buyer
  side, seller side, one member's agent, one mandate, one listing, one
  account. Seeded with `all` on. Existing offers and orders are never touched.
- **Monitoring** (`agent_health`, `src/lib/agent/monitor.ts`): stuck tasks,
  stale jobs, repeated decisions, permission denials and model errors, to
  operational telemetry (Sentry), never product analytics; ids, codes and
  counts only. `agent_telemetry` keeps 30 days.
- **Capabilities** (`src/lib/capabilities/`): typed reads and moves with zod
  contracts and risk levels, run with the member's own client. The model is
  held to the R0–R1 reads allow-listed per scope; the money and limits
  capabilities never reach it. `src/lib/ai/run.ts` wraps the SDK tool runner
  (default model `claude-opus-5-5`, `AGENT_MODEL` to change), redacts what the
  member typed and returns every tool result as untrusted data. No member
  reaches the model until A3c.

## Transaction diagnostics (§AF)

`orders.correlation_id` (0039) names a checkout: shared by the basket's
orders and stamped into the Stripe PaymentIntent metadata, so Stripe's
dashboard and DRVN meet on one id. The admin order sheet composes the
**transaction timeline** — order stamps, retained webhook events, transfer
lifecycle, refund operations, admin actions — via the pure, unit-tested
builder in `src/lib/admin/diagnostics.ts`. Deliberately never a money-path
key; heavy OpenTelemetry deferred until there's a distributed system to
trace.

## Admin operations (§K)

- **Cases** (`/admin/cases`, 0046): disputes and reports as claimable work —
  status/priority/assignment/labels over the existing objects. Lifecycle is
  trigger-owned (opening a dispute creates the case; any resolution path
  resolves it). Mutations go through `auditedAction` under the `case.`
  capability family.
- **Dossier**: the admin order sheet is the dispute dossier — listing
  snapshot, condition comparison, evidence (signed URLs), money state, the
  transaction timeline, the thread, both parties, prior actions.
- **Authorization** (§L): `assert_admin_actor()` (0040) makes the database
  refuse a non-admin actor before ANY admin mutation, service role or not;
  the audit log's trigger refuses non-admin actors for every role. The
  future-roles seam is `src/lib/admin/capabilities.ts` (action families →
  required role); shops/staff/moderators extend there without changing call
  sites. A lapsed 15-minute MFA check sends the admin through
  `/admin-verify?next=` and back to the console page they were on.
- **Background jobs** (Admin → Settings): when each job family last
  succeeded or failed, from `worker_health_snapshot()` — the data
  `/api/health/workers` serves a monitor — marked running, retrying,
  overdue or never ran (search and analytics read "off" without Typesense or
  PostHog). "Run worker now" (Admin → Payments) runs the full money pass,
  not just transfers.
- **Reads fail loudly.** Orders, disputes, listings and users throw on a
  failed read, so the console shows its error page with a retry rather than
  an empty "Nothing matches". An order or dispute id (or its first
  characters) is searched as a uuid range; a users search containing `@`
  matches account emails.
- **Telling the truth.** The orders Money column says "not paid" for unpaid,
  failed and cancelled orders and "held" only when DRVN holds payment; a
  user's Sales counts paid orders only; Settings shows "Stripe in TEST mode"
  on a test key; a member who asked to delete their account shows as
  "Deleting", not suspended, and can't be unsuspended. CSV export writes
  cells starting `=`, `+`, `-` or `@` as plain text.
- **Reports and moderation** (`f57b5c7`, migration `20260928182300`).
  Members can report a listing, a user, a post or a reply (`ReportButton`;
  never on their own content). The report queue lists Post and Reply rows
  with "Remove post" / "Remove reply": it deletes the content, keeps its text
  in the audit log, tells the author (`post_removed` / `comment_removed`),
  marks the report actioned and tells the reporter (`report_reviewed`).
  Resolving starts on "Choose…" — there is no default outcome — and the
  reporter hears the outcome either way.
- **Suspension stops activity.** Restrictive RLS blocks a suspended member
  from posting, replying and making offers; they see a plain notice
  (`src/lib/suspension.ts`) and are told when they're suspended, with the
  reason, and when it's lifted (`account_suspended` / `account_restored`).
  Messages (`20260929110000`) and listing Q&A (`20260929120000`) carry the
  same guard, so a suspended member can't message or ask either.

## Selling IA (§J — decision of record)

Marketplace is discovery; **Selling** is operations. The rail's collapsible
group (unfolded on selling pages, folded elsewhere) and the `familynav` strip cover Selling → My Listings → Offers →
Orders → Payouts; marketplace surfaces carry no operational strip. Orders
stays one shared surface (purchases + sales) homed with Selling; buyers keep
reaching orders from Home/notifications, and anyone who has listed a part
opens it on Sales.
`/payouts` is the one money view: the Connect account's state and the action
that sets it up, then the ledger. Settings → Payments keeps fees and saved
cards and links to `/payouts` (an old `/settings#payouts` link redirects
there). Mobile keeps the Index sheet (no bottom nav): the family
is a labeled group, every register one tap deep.

## Analytics (§AE)

`src/lib/analytics.ts` — a typed event taxonomy behind one `capture()` seam.
PostHog is the optional self-hostable sink (`POSTHOG_KEY`/`POSTHOG_HOST`);
unconfigured, capture is a no-op. Server-side only: no autocapture, no
session replay, no sensitive fields — adding an event means extending the
union, which is the review gate. Env-based feature flags via
`flagEnabled("x")` → `FLAG_X`.

## Stripe lifecycle

The money model is documented where it's operated: `README.md` (the money
model), `docs/production-runbook.md` (setup, reconciliation, recovery),
`tests/stripe/README.md` (what the integration suite proves and what remains
stub-covered). The webhook is the settlement authority; every refund is a
`refund_operations` state machine row; transfers move via leased intents once
delivery plus the clearing hold has passed: 2 days after delivery, or at once
on a plausible buyer confirmation (an owner setting in
`public.settlement_settings`; `docs/decisions/payout-hold.md`).

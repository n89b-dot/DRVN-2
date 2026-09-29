# Operations — jobs, admin, selling IA, observability

> The operational systems in one place. Runtime procedures (production setup,
> reconciliation, worker scheduling) live in `docs/production-runbook.md`;
> this page explains how the pieces fit.

## Background jobs (brief §AI — decision of record)

DRVN's async architecture is **Postgres-owned**, deliberately:

- **In-database (pg_cron):** reservation release (5 min), rate-limit pruning
  (daily), transfer-worker invocation via pg_net (10 min), dispute-SLA sweep
  (daily).
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
    rows. Run daily beside media-gc — it has no database schedule, so it
    needs its own. See [listing-import](listing-import.md).
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
  Messaging needs the same guard on `messages` inserts (Messages area).

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
`refund_operations` state machine row; transfers move on delivery + 7-day
clearing via leased intents.

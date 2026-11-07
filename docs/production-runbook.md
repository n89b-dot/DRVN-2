# Production runbook

For the September 2026 change, follow [the remediation rollout](remediation-rollout.md) before using the historical setup instructions below. Its migrations have been applied to disposable local databases and, on 2026-09-24, to the shared dev project (see `supabase/MIGRATIONS.md`) — never to production.

How to stand up (and stand back up) a production DRVN, separate from the dev
project `grunnjojhdevhuckujmc`. Written to be followed top to bottom the first
time, and section-by-section afterwards. Rev E items: production project,
baselined migration history, rehearsed restore.

## 1. Create the production Supabase project

1. New project in the Supabase dashboard (region close to the UK userbase).
   Never reuse the dev project: it holds test users, test orders, and a
   migration history that only exists in `supabase/MIGRATIONS.md`.
2. Record the project ref, DB password, publishable key, and secret key in the
   deployment platform's secret store — not in the repo, not in `.env.local`.
3. Auth settings: enable email confirmation (dev has it off for e2e), set the
   site URL to the production domain, add it to the redirect allowlist.

## 2. Apply the schema

On a **fresh, empty** project the whole migration tree applies cleanly in
filename order. 0001 drops every table in `public` — it is only safe on an
empty database. **Never replay the tree (or 0001) against a project that
already has a schema**; for an existing project apply only the reviewed,
unapplied files, as recorded in `supabase/MIGRATIONS.md`.

`scripts/apply-migration.mjs` is the committed runner: it reads
`SUPABASE_DB_PASSWORD` and `NEXT_PUBLIC_SUPABASE_URL` from `.env.local`,
connects directly to `db.<ref>.supabase.co:5432` (IPv6 unless the project has
the IPv4 add-on), runs one file and notifies PostgREST to reload its schema.
Point `.env.local` at the target project first, then:

```bash
# from the repo root, against a FRESH project only
for f in supabase/migrations/*.sql; do
  echo "== $f"
  node scripts/apply-migration.mjs "$f" || break
done
```

Each file is a transaction with its own self-checks; a failing self-check
raises and the loop stops. The dashboard SQL editor is the alternative.
`supabase db push` is not used (see §3 for why history is seeded instead).

Then verify:

- The guard suites are **not** run against a hosted project — they insert
  fixture rows (rolled back) and `scripts/test-sql-guards.sh` refuses any
  non-local host. CI's `sql-guard` job builds a blank Postgres from the same
  chain on every push and runs every `supabase/tests/*_guard.sql` (55+
  suites; each must print `all … checks passed`). Confirm that job is green
  for the exact commit you applied.
- On the hosted project: every file's self-check NOTICEs appeared with no
  error; `select jobname, schedule from cron.job order by 1;` lists the nine
  jobs in §4; `select id, public from storage.buckets order by 1;` lists the
  buckets the migrations create (avatars, car-images, activity-images,
  listing-images public; dispute-evidence, message-photos, account-exports
  private).

## 3. Seed the migration history

So the Supabase CLI recognises what has been applied (and never tries to run
0001), record every applied file in `supabase_migrations.schema_migrations`.
The version is the filename up to the first underscore (`0001`, …,
`20261004150000`); the name is the rest. Generate the statement from the
files actually applied rather than maintaining a list by hand:

```bash
{
  echo "create schema if not exists supabase_migrations;"
  echo "create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"
  echo "insert into supabase_migrations.schema_migrations (version, name) values"
  for f in supabase/migrations/*.sql; do
    b=$(basename "$f" .sql); printf "  ('%s', '%s'),\n" "${b%%_*}" "${b#*_}"
  done | sed '$ s/),$/)/'
  echo "on conflict (version) do nothing;"
} > /tmp/drvn-migration-history.sql
```

Review the file, then run it in the SQL editor (or with
`node scripts/apply-migration.mjs /tmp/drvn-migration-history.sql`). Re-run
it after each later migration lands; `on conflict do nothing` makes it
idempotent. Keep `supabase/MIGRATIONS.md` as the human record of what was
applied where and when.

## 4. Wire the app

Environment (deployment platform). Boot-time validation:
`src/instrumentation.ts` runs `validatePaymentsEnv()` (`src/lib/env.ts`). In
**live-money mode** — `NODE_ENV=production` with Stripe selected — every row
marked *required (live)* is checked together and the server refuses to start
if any is missing or invalid.

| Variable | Live-money production | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | required | production project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `…_ANON_KEY`) | required | browser-safe key |
| `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) | required | server only; bypasses RLS |
| `PAYMENTS_MODE` | recommended `stripe` | unset = `stripe` when `STRIPE_SECRET_KEY` is set. Production refuses stub mode (or a missing key) unless `PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true`, which is for non-public sandboxes only |
| `STRIPE_SECRET_KEY` | required | `sk_live_…` flips `paymentsAreLive()`; the terms' and fees page's test-mode notices disappear at the same moment |
| `STRIPE_WEBHOOK_SECRET` | required (live) | signing secret of the platform endpoint below |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | required (live) | signing secret of the Connect endpoint (`account.updated` on sellers' accounts) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | required (live) | live publishable key |
| `SENTRY_DSN` | required (live) | must be an `https:` DSN with a key and a numeric project path (`https://<key>@<host>/<project id>`) |
| `ADMIN_ALERT_WEBHOOK_URL` | required (live), `https:` | operator alerts (Slack-compatible body). Outside live-money mode it may be unset; alerts then accumulate as `disabled` outbox rows in Admin → Payments |
| `NEXT_PUBLIC_SITE_URL` | required (live), `https:` | the canonical origin only — no path, query, fragment or credentials |
| `CRON_SECRET` | required (live), ≥ 32 chars | bearer for every `/api/jobs/*` route and `/api/health/workers`; the same value goes in `job_config.transfer_worker_secret` and the monitor's `DRVN_MONITOR_SECRET` |
| `GUEST_RECEIPT_SECRET` | required (live), ≥ 32 chars | signs guest receipt and checkout-identity cookies and keys the hashed network identity used for guest abuse limits. Any production build without it throws on the first guest checkout or anonymous rate-limit check. Rotating it invalidates outstanding guest receipts |
| `TRUST_PROXY_HEADERS` | unset on Vercel; `true` only behind another verified proxy; `false` to disable | identifies signed-out visitors (hashed, never stored raw) for checkout, sign-in, password-reset and error-report rate limits. **On Vercel** (`VERCEL=1`, set by the platform) the app trusts `X-Vercel-Forwarded-For`, then `X-Forwarded-For`, with no setting: Vercel documents that it overwrites `X-Forwarded-For` and does not forward client-supplied addresses ([request headers](https://vercel.com/docs/headers/request-headers)). **Elsewhere** set `true` only once you have confirmed (host docs plus a test request with a forged header) that the ingress replaces client `X-Forwarded-For`. With no trusted source every signed-out visitor shares one `unattributed` bucket — safe, but one busy visitor can rate-limit all guests, so live-money production logs a `[startup]` warning. Sign-in and reset limits per address are skipped in that state (a shared bucket would let one attacker lock everyone out); the per-email limits still apply |
| `FLAG_INTEGRATED_SHIPPING_V1`, `EASYPOST_API_KEY`, `EASYPOST_WEBHOOK_SECRET` | optional | DRVN Shipping; see §10. `SHIPPING_MODE` / `SHIPPING_ALLOW_STUB_IN_PRODUCTION` override |
| `ANTHROPIC_API_KEY` (+ `LISTING_IMPORT_MODEL`, `LISTING_IMPORT_AI_MODE`) | optional | listing importer; unset in production = importing shows "temporarily unavailable" |
| `TYPESENSE_URL`, `TYPESENSE_API_KEY` | optional | both set = Typesense search; unset = Postgres search, and the `search` health family reports disabled |
| `POSTHOG_KEY`, `POSTHOG_HOST` | optional | consented analytics only; unset = the `analytics` health family reports disabled |
| `SENTRY_RELEASE` | optional | release tag; falls back to the platform's commit SHA |

Stripe (live mode). `scripts/owner/stripe-webhooks.mjs --live` creates or
updates both endpoints below (dry run by default; `docs/owner/README.md`).

1. Webhook endpoint (events on **your account**) →
   `https://<domain>/api/stripe/webhook`, subscribed to exactly the events
   `dispatchStripeEvent` (`src/lib/payments/settlement.ts`) handles:
   `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.requires_action`, `charge.refunded`, `refund.created`,
   `refund.updated`, `refund.failed`, `charge.dispute.created`,
   `charge.dispute.closed`, `account.updated`. Anything else is acknowledged
   as irrelevant. Its signing secret is `STRIPE_WEBHOOK_SECRET`.
2. Connect enabled, Express accounts (transfers capability). Charges are
   separate charges and transfers on the platform account, so payment, refund
   and dispute events arrive on the platform endpoint above.
   `account.updated` for a seller's Express account is an event on the
   *connected* account, delivered only to a **Connect endpoint**: add a second
   endpoint ("events on connected accounts") at the same URL with the single
   event `account.updated`, and put its signing secret in
   `STRIPE_CONNECT_WEBHOOK_SECRET`. The route accepts an event signed with
   either secret. Without it a seller whose payouts are switched on (or off)
   after onboarding isn't picked up, and transfers blocked on an unpayable
   seller stay blocked; live mode refuses to start without it.

Scheduler → worker handoff (0020). All HTTP workers derive their URL from
this one row and authenticate with this secret:

```sql
insert into public.job_config (key, value) values
  ('transfer_worker_url', 'https://<domain>/api/jobs/transfers'),
  ('transfer_worker_secret', '<CRON_SECRET value>')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Confirm the nine pg_cron jobs (times are the database's UTC):

| Job | Schedule | Runs |
|---|---|---|
| `drvn-release-reservations` | `*/5 * * * *` | `release_expired_reservations()` (SQL) — lapsed checkout holds and offers |
| `drvn-prune-rate-limits` | `15 3 * * *` | `prune_rate_limits()` (SQL) — counters older than a day |
| `drvn-transfer-worker` | `*/10 * * * *` | `mark_due_transfer_intents()` then `invoke_transfer_worker()` → `POST /api/jobs/transfers` (the whole money pass) |
| `drvn-dispute-sla` | `5 8 * * *` | `escalate_stale_disputes()` (SQL) |
| `drvn-search-worker` | `*/2 * * * *` | `invoke_remediation_worker('search')` → `/api/jobs/search` |
| `drvn-deletion-worker` | `*/5 * * * *` | `invoke_remediation_worker('account-deletions')` → `/api/jobs/account-deletions` (deletions and exports) |
| `drvn-media-gc` | `17 3 * * *` | `invoke_remediation_worker('media-gc')` → `/api/jobs/media-gc` |
| `drvn-saved-search-worker` | `*/30 * * * *` | `invoke_remediation_worker('saved-searches')` → `/api/jobs/saved-searches` |
| `drvn-listing-import-sweep` | `37 3 * * *` | `invoke_remediation_worker('listing-imports')` → `/api/jobs/listing-imports` (20261004150000) |

`select jobname, schedule from cron.job order by 1;` must return exactly
these. Without the `job_config` rows the SQL jobs still run, but every HTTP
worker returns immediately without calling the app.

## 5. Seed the first admin

```sql
insert into public.admin_users (user_id, note)
values ('<auth.users id>', 'founder')
on conflict do nothing;
```

Membership is SQL-only by design (0018). Turn on MFA for that account in
Supabase Auth. The console is at `/admin`; it 404s for everyone else.

## 5b. Money reconciliation & recovery (run these when things go wrong)

Every money queue is durable and visible in **Admin → Payments**:

- **Refund operations** (`refund_operations`, 0026): anything not `completed`
  appears here. The worker pass (`/api/jobs/transfers`) resumes abandoned
  operations automatically (`resumeIncompleteRefunds`) — reconciling against
  Stripe by `operation_id` metadata before ever re-calling, so retries cannot
  double-refund. `failed` = Stripe refused (terminal; a retry is a fresh
  refund from the order page). `recovery_required` / reversal failures open
  `payment_recoveries` cases and alert.
- **Transfer pipeline** (`transfer_intents`): leased claims expire (5 min), so
  a crashed worker's rows return to the pool on the next pass — no manual
  unsticking. Exhausted attempts (8) open a recovery case + `transfer_stuck`
  alert. `reconcileTransferRecords` repairs order↔intent reference gaps both
  directions every pass.
- **Failed transfer recovery**: fix the cause (usually seller onboarding —
  `account.updated` auto-unblocks), then "Run worker now". For an intent at
  8 attempts, clear `attempts`/`next_attempt_at` via SQL after diagnosing.
- **"Run worker now"** (Admin → Payments) runs the whole scheduled money
  pass — the same `runMoneyWorkerPass` behind `/api/jobs/transfers`:
  expired holds, capture checks, payouts, refunds, label voids, returns,
  disputes, alerts, analytics and receipts. It reports what it paid out and
  released, and names any family that failed (those retry next pass).
- **Is anything running?** Admin → Settings → Background jobs lists each job
  family's last success and failure (`worker_health_snapshot()`, the data
  `/api/health/workers` serves) and flags overdue ones. An overdue list
  usually means the scheduler can't reach the app — check `job_config` and
  `CRON_SECRET`.
- **Alert backlog** (`admin_alert_outbox`): `pending` retries with backoff on
  every worker pass; `failed` = 10 attempts exhausted; `disabled` = no
  destination configured when raised.
- **Evidence privacy verification**: `select public from storage.buckets
  where id = 'dispute-evidence';` must be `false`; fetching a stored evidence
  URL unauthenticated must 400/403. (0027 self-checks assert this at apply
  time.)

## 6. Backups, and the rehearsed restore

Use the backup and point-in-time recovery facilities actually enabled on the
hosted project. A paid plan name alone is not evidence that a recovery point
exists. Rehearse quarterly and after material schema or storage changes.

The repeatable **local** preparation commands are:

```sh
bash scripts/local-recovery-rehearsal.sh /tmp/drvn-recovery.json
node scripts/local-rollback-rehearsal.mjs PREVIOUS_COMPATIBLE_COMMIT /tmp/drvn-rollback.json
DRVN_COMMERCE_REPORT=/tmp/drvn-commerce.json npx vitest run --config vitest.operations.config.ts tests/operations/commerce-concurrency.test.ts
```

The first command creates and removes its own fresh source and restore
containers, applies the complete migration chain, seeds synthetic users,
commercial snapshots, operation identities, private records and queued work,
and compares every application/Auth/Storage table after restore. It separately
archives synthetic object bytes and verifies their checksum and restored row
reference. Outbound job configuration is cleared and active schedules are
forbidden. Existing containers with the same names are never replaced. Port
55441 must be free. No existing application database is backed up or reset.

The rollback command requires the isolated DRVN stack on 54321, an identical
dependency lockfile, and a free port 3001. It copies the previous Git artifact
into a temporary directory, runs six synthetic recovery suites against the
current schema, builds it, and checks public pages plus denied anonymous admin
access. It never rolls back schema or dispatches external money. Its temporary
application is stopped and removed afterward. Read its log if it fails; do not
weaken the lockfile or target checks to force compatibility.

The concurrency test measures local reservation/replay behavior with eight
simultaneous requests. It checks one order for exact retries and one winner
for competing buyers. It does not establish hosted end-to-end capacity.

Hosted acceptance still requires:

1. Restore a verified database recovery point and the corresponding separately
   archived object versions into an isolated target with outbound jobs disabled.
   Create the `agent_worker` role on the target first (`create role agent_worker
   nologin noinherit;`, as 20261021100100 does): roles are cluster-level, so a
   dump carries the grants to it but not the role, and the restore stops at the
   first `GRANT … TO agent_worker` without it. The local drill does this itself.
2. Run `supabase/tests/restore_integrity.sql`, all current `*_guard.sql` suites,
   and compare operation identities, immutable commercial snapshots, RLS,
   private object references and object checksums.
3. Reconcile provider activity since the recovery point before restarting money
   workers. Reapply deletion/retention tombstones. Hold ambiguous effects for
   operator review instead of creating replacement operations.
4. Rehearse the previous compatible application with queued work, Auth,
   provider callbacks and private downloads. Use a forward fix if the previous
   application is incompatible; do not erase committed financial state.
5. Record actual elapsed recovery time, unrecovered data and operator findings
   against approved targets. Obtain hosted acceptance before releasing invitations.

| Date | Rehearsal | Evidence and limits |
|---|---|---|
| 2026-09-06 | Local synthetic database + object archive | [Result](readiness-progress/evidence/2026-09-06-local-recovery.json); 104 migrations, 87 matching table fingerprints, object bytes/reference verified. Does not establish hosted RPO/RTO. |
| 2026-10-24 | Local synthetic database + object archive, current chain | [Result](readiness-progress/evidence/2026-10-24-local-recovery.json); 219 migrations, 123 matching table fingerprints, object bytes/reference verified, restore integrity passed in 16 s. First run failed until the drill created the `agent_worker` role on the target (fixed the same day). Does not establish hosted RPO/RTO. |
| Pending | Coordinated hosted restore and rollback | Requires isolated staging, provider reconciliation, approved targets and operator acceptance. |

## 7. Go-live checklist deltas

- [ ] Legal pages carry the real entity/jurisdiction/tax terms (being handled
      separately) and the test-mode clause is gone.
- [ ] `release-gate` is the required check on `main` (§8; public repo or GitHub Pro).
- [ ] `job_config` points at the production worker URL.
- [ ] A dispute, a refund, and a payout have each been exercised once in live
      mode with a real card and a Connect test seller before public launch.

## 8. Protect `main` (blocked on GitHub plan — do this once available)

The repository is private on the GitHub Free plan, where branch protection and
rulesets are unavailable (`403 Upgrade to GitHub Pro or make this repository
public`). As soon as the repo is public **or** the account has GitHub Pro,
apply this exact ruleset (Settings → Rules → Rulesets → New branch ruleset, or
the API call below):

- **Name:** `protect-main` · **Enforcement:** Active · **Target:** default branch
- **Rules:**
  - Require a pull request before merging — 0 required approvals (solo-maintained;
    the point is routing changes through CI, not review bureaucracy)
  - Require status checks to pass: `release-gate` (only — see below)
  - Block force pushes (on by default in rulesets)

```bash
gh api -X POST repos/n89b-dot/DRVN-2/rulesets --input - <<'JSON'
{"name":"protect-main","target":"branch","enforcement":"active",
 "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
 "rules":[
   {"type":"pull_request","parameters":{"required_approving_review_count":0,
     "dismiss_stale_reviews_on_push":false,"require_code_owner_review":false,
     "require_last_push_approval":false,"required_review_thread_resolution":false}},
   {"type":"required_status_checks","parameters":{
     "strict_required_status_checks_policy":false,
     "required_status_checks":[{"context":"release-gate"}]}}]}
JSON
```

`scripts/owner/branch-protection.sh` applies this ruleset with two more rules
the JSON above leaves out, `non_fast_forward` (block force pushes) and
`deletion`: rulesets created through the API don't add them by default. It
also verifies the result (`docs/owner/branch-protection.md`).

Require `release-gate` alone: it is the aggregate check, and it fails unless
`verify`, `secrets`, `secrets-full`, `sql-guard`, `e2e` and
`stripe-integration` all ran and passed (updated 1 October 2026 — e2e no
longer self-skips; it runs on a local stack in CI). `secrets` scans only the
commits a PR or push adds (first-parent, no merges); `secrets-full` is the
full-history lane — every reachable commit, merges included, plus the tracked
tree — and is what fails a key committed and later deleted (added 3 October
2026). `stripe-integration` needs the repository secret
`STRIPE_TEST_SECRET_KEY` (a Stripe **test-mode** secret key, `sk_test_…`);
without it that job fails on purpose, so `release-gate` cannot pass. Enforce the same check at the deployment boundary too: a
protected branch doesn't stop a deploy of an unchecked commit.

## 9. Saved-search alert worker

Scheduled by pg_cron (`drvn-saved-search-worker`, every 30 minutes — §4);
nothing to set up beyond `job_config`. One pass checks every alert-enabled
saved search for listings created since its last check and raises at most one
in-app notification per search per pass. A search's first pass after opt-in
only stamps the baseline — nobody is alerted about inventory that predates
their opt-in. `/api/jobs/media-gc` and `/api/jobs/listing-imports` are
scheduled the same way. To run any of them by hand:
`curl -X POST https://<domain>/api/jobs/<name> -H "Authorization: Bearer $CRON_SECRET"`.

## 9b. Independent worker monitor (GitHub Actions)

`.github/workflows/worker-monitor.yml` runs `node scripts/check-worker-health.mjs`
every 15 minutes (GitHub may delay or skip scheduled runs under load) and on
manual dispatch. It calls `GET <origin>/api/health/workers` and fails the run when any worker
family is stale, missing or failing, or a queue is overdue. GitHub sends
failure notifications for scheduled runs to the account that last changed the
workflow's `cron` line — make sure that is the operator. It is skipped entirely until
configured. In **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
|---|---|---|
| Repository **variable** | `DRVN_MONITOR_ENABLED` | `true` — anything else skips the job |
| Repository **variable** | `DRVN_MONITOR_ORIGIN` | the canonical `https://` origin, no path (e.g. `https://drvn.app`) |
| Repository **secret** | `DRVN_MONITOR_SECRET` | the deployment's `CRON_SECRET` — `/api/health/workers` accepts only that bearer |

This mode alerts only through GitHub's failed-workflow notifications. The
`--watch` mode (transition alerts to `DRVN_MONITOR_ALERT_URL`, dead-man
heartbeats to `DRVN_MONITOR_HEARTBEAT_URL`, state in
`DRVN_MONITOR_STATE_FILE`) runs on a separately administered host, not in
this workflow — see `docs/remediation-release-and-monitoring.md`. Before
relying on either, pause a worker in staging and confirm an alert and a
recovery actually arrive.

## 10. DRVN Shipping — EasyPost setup (migrations 0051-0056)

DRVN is a **platform buying postage on behalf of sellers**, not a retailer
shipping its own inventory. Before any production postage is enabled:

1. **Test mode first.** Set `FLAG_INTEGRATED_SHIPPING_V1=true` and a *test*
   `EASYPOST_API_KEY` (EZTK…). The full flow — verify seller ship-from,
   rates at checkout, buy/void label, tracker webhooks — runs against
   EasyPost test mode; nothing in the code branches on which key it is.
   With no key at all, dev runs the deterministic stub provider and
   production simply disables DRVN Shipping (seller-arranged shipping keeps
   working — §42's required fallback).
2. **Confirm the marketplace account structure with EasyPost** before the
   production key: whether standard per-seller **EndShipper** records
   suffice for USPS platform postage, or the account should be on **Forge**.
   The code stores `seller_fulfillment_profiles.easypost_end_shipper_id` as
   an opaque reference and passes it through the provider seam only — a move
   between models changes `src/lib/shipping/easypost.ts`, nothing else.
3. **Webhook**: create an EasyPost webhook pointing at
   `https://<domain>/api/shipping/easypost` (it acts on `tracker.created`
   and `tracker.updated`), generate a webhook secret, and
   set the same value as `EASYPOST_WEBHOOK_SECRET`. The endpoint refuses
   everything (500) while unset, rejects bad HMACs (400), dedupes by event
   id in `webhook_events` (prefixed `easypost:`), and 500s on real failures
   so EasyPost redelivers.
4. **Wallet float** (§16): buyer-paid shipping funds postage economically,
   but EasyPost charges DRVN's wallet before Stripe cash lands in the bank.
   Keep a small auto-reload balance on the EasyPost wallet for early volume.
   Every label is recorded against the seller/order in `seller_adjustments`
   and netted out of the payout by the transfer worker — the float is a
   timing difference, never a subsidy.
5. **Cron**: no new job. Return timers (§27) and the dispute-SLA pause (§28)
   run inside the existing `POST /api/jobs/transfers` pass.
6. **Interrupted label operations:** label purchases are frozen in
   `outbound_label_requests`; label refunds are frozen separately in
   `outbound_label_void_requests`. A seller retries a void with the **Void
   label** action on `/orders/<order id>`. The action always uses the saved
   provider Shipment. `provider_pending` first reads that Shipment's
   `refund_status`; `submitted` and unknown results stay pending without a
   seller credit, `rejected` leaves the purchased label and deduction intact,
   and `refunded` atomically cancels the shipment and appends the exact
   `label_refund` adjustment. A crashed pre-call claim can be reassigned only
   after its lease expires and a later provider read reports no refund request.
   Review `admin_alert_outbox.dedup_key =
   'outbound-label-void:<shipment uuid>'` with the journal row before any
   manual provider action. The existing `/api/jobs/transfers` heartbeat scans
   at most five due rows as the `labelVoids` worker family: new/unknown rows
   are revisited after a short delay and carrier-submitted refunds every six
   hours. The seller action remains the immediate retry path. Confirm EasyPost
   test and production-account behavior for each enabled carrier, including
   asynchronous acceptance and rejection, before enabling live postage.

## 11. Shops — verification and conversion

Any account can switch itself to a shop in Settings → Shop (controlled
server path; `profiles.profile_type` stays client-immutable per 0017). The
**verified** badge is a separate, admin-granted state and is never implied by
self-declaration. For MVP, grant it manually — same posture as admin_users:

```sql
update public.shop_profiles
   set verification_status = 'verified'
 where profile_id = '<profile uuid>';
```

Revoke by setting it back to `'unverified'`. Whatever return policy a shop
had at each sale is frozen in that order's commercial snapshot; changing the
policy never affects existing orders.

## 12. Local dev server — background jobs and Stripe events

Not for production. On the shared dev project the scheduler can't reach a
dev server on `localhost` (pg_net runs in the database's network), so without
these nothing scheduled ever runs there: holds never expire, payouts never
run, saved-search alerts, deletions and exports never finish — and Stripe
can't deliver webhooks, so a test purchase stays "pending" until the
10-minute capture check.

- **`scripts/dev-jobs.sh`** — calls `/api/jobs/*` with the `CRON_SECRET`
  from `.env.local` on the database's own intervals (search 2 min, account
  deletions 5 min, transfers 10 min, saved searches 30 min, media GC and
  listing imports daily). Each job runs once its interval has passed, so a
  missed tick catches up once rather than piling up; a dead server retries
  next tick. Run it by hand for one pass.
- **`scripts/dev-stripe-listen.sh`** — `stripe listen` forwarding to
  `/api/stripe/webhook`, using the test key in `.env.local`; its signing
  secret is the `STRIPE_WEBHOOK_SECRET` already configured. It refuses any
  key that isn't `sk_test_`.

Both are launchd agents beside the dev server's own (`cc.drvn2.jobs` every
two minutes; `cc.drvn2.stripe` kept alive). launchd can't open scripts inside
`~/Desktop`, so install a copy in `~/bin` — the header of each script has
the three commands. Logs: `~/Library/Logs/drvn2-jobs.log` and
`~/Library/Logs/drvn2-stripe.log`. Admin → Settings → Background jobs shows
whether the jobs are keeping up.

## 13. The agent worker, kill switches and reconciliation (A2)

Migrations `20261021100000`–`100200`. Nothing here is needed until A3a turns the
agent on; until then the seeded `all` kill switch keeps it paused for everyone.
Background: [`docs/decisions/agent-foundations.md`](decisions/agent-foundations.md),
[`docs/site/operations.md`](site/operations.md) "The agent".

### 13a. Give the worker a login (operator step, once per project)

The migrations create `agent_worker` as `NOLOGIN` with no table privileges; it
can execute only the eight worker functions (`agent_claim_jobs`,
`agent_renew_lease`, `agent_job_context`, `agent_offer_move`, `agent_offer_open`,
`agent_request_approval`, `agent_record_decision`, `agent_finish_job`).
No password is ever written into a migration or committed. When the A3a beta
is ready, an operator does this in the SQL editor of the project, as `postgres`:

```sql
alter role agent_worker with login password '<generated, 32+ random bytes>';
```

Then store the connection string as `AGENT_WORKER_DATABASE_URL` in the deploy
environment only, through the **transaction pooler** with the role as the user
(`postgresql://agent_worker.<project-ref>:<password>@<pooler-host>:6543/postgres`).
Check it: connect as the role and confirm `select count(*) from public.listings`
fails with 42501 and `select * from public.agent_claim_jobs(1, 60)` returns.
Rotate by running the `alter role` again and updating the environment. To cut
the worker off entirely: `alter role agent_worker nologin;` (in-flight leases
lapse and their jobs return to the queue).

### 13b. Kill switches

Admin console → **Agent** (`/admin/agent`), an admin with step-up. Each switch
is a row in `agent_controls` and an `agent.pause` / `agent.resume` entry in the
audit log, written in one transaction by `admin_set_agent_control`.

| Switch | Stops |
|---|---|
| All | Every agent write, both sides |
| Buyer side / Seller side | That side's agent everywhere |
| One member's agent (`member`) | Everything that member's agent does |
| One mandate | That one listing's limits |
| One listing | Every agent on that listing, either side |
| One account (`account`) | Every agent acting for *or against* that member |

What a switch does: `agent_claim_jobs` leaves the affected jobs queued (they
are not lost), and every worker write re-checks the switches inside its own
transaction, so a job claimed just before the switch was thrown still refuses
with `AG004`. **Existing offers, counters and orders are never touched**: a
counter the agent already sent stays live and binding until it is accepted,
countered or expires; an accepted offer's order runs its normal course.

### 13c. Reconciliation after a pause

1. Look before lifting: `select public.agent_health();` (service role). Note
   `stale_jobs`, `stuck_tasks`, `repeated_decisions` and `controls_on`.
2. Decide per offer: anything the agent sent before the pause is the member's
   offer. If it should not stand, the member (not an admin) declines or lets
   it expire; a seller may cancel an accepted order only before checkout
   begins, as for any sale.
3. Lift the switch in the console. Queued jobs run on the next pass. A job
   whose turn has since moved on fails harmlessly with `OF003` (stale round)
   or was already cancelled when the next round arrived.
4. Run `select public.agent_reconcile_outbox(500);` once. It re-queues any
   turn that has no job (counted as `outbox_reconciled` in `agent_telemetry`),
   returns expired leases to the queue and cancels jobs whose task ended.
5. Re-check `agent_health()`: `stale_jobs` and `stuck_tasks` should be 0
   within two passes. Any `dead` job is a worker that kept losing its lease;
   its task stays open for the next event.

### 13d. Scheduled sweeps

`/api/jobs/agent` (bearer `CRON_SECRET`) runs the outbox reconcile, the
retention sweep (`agent_retention_sweep`: jobs and monitoring after 30 days;
events, finished tasks, ended mandates and idle chats after 12 months) and the
health check, which reports to monitoring when a threshold trips. It also runs
one worker pass when `AGENT_WORKER_DATABASE_URL` is set. Schedule it every
5 minutes beside the transfer worker once A3a starts; until then it is not
scheduled.
It also applies the usage retention (`agent_usage_retention_sweep`, 12 months)
and recomputes today's and yesterday's measures (`agent_compute_metrics` →
`agent_metrics_daily`; definitions in `docs/site/agent-measures.md`).

### 13e. Opening a beta step, and the spend caps

Each A3 step (seller, buyer, chat, jobs) opens from `/admin/agent` → Beta
steps (admin with a fresh authenticator; a reason is required and audited as
`agent.beta_open` / `agent.beta_close`). An environment needs `AGENTS_BETA=on`
as well. Opening a step only shows its controls to members; lift the
`all` kill switch (§13b) for the agent to act. Close the step to hide the
controls again; mandates already set stay, and the kill switches still stop
them.

Model spend is capped per member and for everyone, per UTC day
(`agent_spend_limits`, $2 and $50 to start), set on the same page and audited
as `agent.spend_limits`. A turn past either cap is refused before the model
is called (`spend_cap`), and every turn's tokens and cost land in
`agent_usage`.

One member's agent is at `/admin/agent/members/<id>`: their limits with
versions, tasks, record and approvals. Their chat opens only for a report about
them or a dispute they're party to, with the case id and a reason, and is
audited (`agent.chat_opened`) before a line is shown.

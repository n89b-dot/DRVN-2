# Production runbook

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

On a **fresh** project the whole migration tree applies cleanly in order —
0001 is only destructive against an existing schema:

```bash
# from the repo root; DB_URL is the production connection string
for f in supabase/migrations/*.sql; do
  echo "== $f"
  node scripts/apply-migration.mjs "$f"   # or paste each into the SQL editor
done
```

(There is no `scripts/apply-migration.mjs` committed — use the node-postgres
runner documented in `supabase/MIGRATIONS.md`, or the SQL editor. CI proves
the tree applies cleanly to a blank Postgres on every push.)

Then verify, exactly as CI does:

- `supabase/tests/purchase_guard.sql` — all nine PASS notices
- `supabase/tests/admin_guard.sql` — "all admin-guard checks passed"
- `supabase/tests/security_guard.sql` — "all security-guard checks passed"
- `supabase/tests/money_guard.sql` — "all money-guard checks passed"

## 3. Baseline the migration history

So the Supabase CLI is usable against production from day one (unlike dev,
where 0001–0005 predate any recorded history and `supabase db push` would
re-run 0001):

```sql
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations (version, name)
select
  split_part(f, '_', 1),
  f
from unnest(array[
  '0001_v3_schema', '0002_engagement_visibility', '0003_activity_engagement',
  '0004_profile_headline', '0005_notification_prefs', '0006_security_hardening',
  '0007_commerce_lifecycle', '0008_indexes_and_search', '0009_notifications',
  '0010_listing_part_number', '0011_listing_views', '0012_commerce_hardening',
  '0013_scheduled_jobs', '0014_disputes', '0015_stripe_customers',
  '0016_connect_accounts', '0017_lock_payment_columns', '0018_admin',
  '0019_money_infra', '0020_transfer_scheduling', '0021_dispute_sla',
  '0022_sla_alert_stamp', '0023_admin_roles_webhook_payloads',
  '0024_grading_dispute_process', '0025_fitment', '0026_money_durability',
  '0027_evidence_privacy', '0028_shipping_address_region'
]) as f
on conflict do nothing;
```

Keep this list in lockstep with `supabase/migrations/` whenever a new file
lands.

## 4. Wire the app

Environment (deployment platform):

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | production project |
| `SUPABASE_SECRET_KEY` | service role — server only |
| `STRIPE_SECRET_KEY` | `sk_live_…` flips `paymentsAreLive()`; the terms' test-mode clause must be removed at the same moment |
| `STRIPE_WEBHOOK_SECRET` | from the production webhook endpoint below |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | live publishable key |
| `CRON_SECRET` | random 32+ chars; gates `/api/jobs/transfers` |
| `SENTRY_DSN` | **required in live-money production** — boot fails without it (`validatePaymentsEnv`) |
| `ADMIN_ALERT_WEBHOOK_URL` | operator alerts (Slack-compatible). Unset = alerts accumulate as `disabled` outbox rows, visible in Admin → Payments |
| `PAYMENTS_MODE` | optional; set `stripe` explicitly in production. Production **refuses** stub mode without `PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true` |
| `NEXT_PUBLIC_SITE_URL` | production origin |

Boot-time validation: `src/instrumentation.ts` runs `validatePaymentsEnv()` —
a production deploy missing Stripe keys, webhook secret, publishable key, or
`SENTRY_DSN` fails at startup, loudly, instead of running fake payments.

Stripe (live mode):

1. Webhook endpoint → `https://<domain>/api/stripe/webhook`, events:
   `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.requires_action`, `charge.refunded`,
   `charge.dispute.created`, `charge.dispute.closed`, `account.updated`.
2. Connect enabled, Express accounts, GB.

Scheduler → worker handoff (0020):

```sql
insert into public.job_config (key, value) values
  ('transfer_worker_url', 'https://<domain>/api/jobs/transfers'),
  ('transfer_worker_secret', '<CRON_SECRET value>')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Confirm the four cron jobs exist: `select jobname, schedule from cron.job;` →
`drvn-release-reservations`, `drvn-prune-rate-limits`,
`drvn-transfer-worker`, `drvn-dispute-sla`.

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
- **Alert backlog** (`admin_alert_outbox`): `pending` retries with backoff on
  every worker pass; `failed` = 10 attempts exhausted; `disabled` = no
  destination configured when raised.
- **Evidence privacy verification**: `select public from storage.buckets
  where id = 'dispute-evidence';` must be `false`; fetching a stored evidence
  URL unauthenticated must 400/403. (0027 self-checks assert this at apply
  time.)

## 6. Backups, and the rehearsed restore

Supabase Pro runs daily backups plus PITR. **A backup that has never been
restored is a hope, not a plan** — rehearse quarterly:

1. Create a scratch Supabase project.
2. Restore the latest production backup into it (dashboard → Backups →
   Restore, or `pg_restore` from a downloaded dump).
3. Run `supabase/tests/restore_integrity.sql` against the copy (read-only:
   auth references, money invariants, transfer references, evidence bucket
   privacy, RLS presence — raises on any failure), then the four guard
   suites.
4. Point a local app at the copy (`.env.local` overrides) and click through:
   sign-in, marketplace, an order detail, `/admin`.
5. Record the date and the wall-clock restore time below, then delete the
   scratch project.

| Date | Restored from | Time to usable | Notes |
|---|---|---|---|
| _none yet_ | | | first rehearsal pending |

## 7. Go-live checklist deltas

- [ ] Legal pages carry the real entity/jurisdiction/tax terms (being handled
      separately) and the test-mode clause is gone.
- [ ] CI is a required check (public repo or paid plan — branch protection).
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
  - Require status checks to pass: `verify`, `sql-guard`
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
     "required_status_checks":[{"context":"verify"},{"context":"sql-guard"}]}}]}
JSON
```

The `e2e` job stays unrequired — it self-skips without secrets and must not
block merges. Revisit once E2E secrets are permanent.

## 9. Saved-search alert worker

Schedule `POST /api/jobs/saved-searches` with `Authorization: Bearer
$CRON_SECRET` every ~30 minutes (same pattern as `/api/jobs/transfers` —
pg_cron + pg_net, or any external cron). One pass checks every alert-enabled
saved search for listings created since its last check and raises at most one
in-app notification per search per pass. A search's first pass after opt-in
only stamps the baseline — nobody is alerted about inventory that predates
their opt-in. `/api/jobs/media-gc` shares the same scheduling posture.

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
   `https://<domain>/api/shipping/easypost`, generate a webhook secret, and
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

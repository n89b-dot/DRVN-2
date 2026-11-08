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
4. Auth security settings (readiness N20, N41, N42). The app enforces its own
   checks; these stop the same things being done by calling Supabase Auth
   directly with the public key:
   - Authentication → Providers → Email → **Secure password change: on**
     (`secure_password_change = true` in `supabase/config.toml`). A password
     change then needs a session under 24 hours old or one opened from an
     emailed link. The app is stricter: Settings verifies the current
     password, and `/login/reset` only accepts a session opened from a reset
     link within the hour.
   - **Require the current password to change it: on.** "Secure password
     change" exempts any session under 24 hours old, so on its own a stolen
     fresh session can call Auth's `updateUser({ password })` directly and
     skip both app checks. Supabase Auth's
     `security_update_password_require_current_password` closes that: Auth
     refuses a password change without the correct `current_password` unless
     the session was opened from an emailed link (Auth's own recovery rule:
     `otp`, `magiclink` or `recovery` sign-ins). Settings already sends
     `current_password`, and the reset page uses a reset-link session, so
     nothing in the app changes when it goes on. The CLI pinned in CI
     (2.116.0) has no `config.toml` key for it, so set it on the hosted
     project through the Management API (the dashboard may also show it
     under Authentication → Providers → Email):

     ```sh
     curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
       -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
       -d '{"security_update_password_require_current_password": true, "security_update_password_require_reauthentication": true}'
     # check: GET the same URL; both fields read true
     ```

     What stays open with it on: a stolen session that was itself opened from
     an emailed link (confirming sign-up through `/confirm`, a guest's order
     link, a reset link) still counts as a recovery session for its whole
     life, and Auth lets it set a password without the current one. Shorter
     sessions narrow that: Authentication → Sessions → time-box or
     inactivity timeout (owner's choice; a paid-plan feature).
   - **Secure email change: on** (`double_confirm_changes`): both addresses
     must confirm. The app also asks for the password, or a Google sign-in
     within ten minutes, before it requests the change or an account deletion.
   - **Minimum password length: 8**, to match the app (config.toml still says 6
     locally).
   - Authentication → Rate Limits. Every sign-in and sign-up reaches Auth from
     the app server's few addresses, so the per-IP defaults (30 sign-ins and
     sign-ups per 5 minutes, `sign_in_sign_ups`) can lock everyone out on a busy
     day. Raise "sign-ups and sign-ins" well above expected peak (the app
     throttles per visitor and per email itself: `RATE_LIMITS.signIn*` and
     `signUp*` in `src/lib/rate-limit.ts`), keep "token verifications" in step,
     and set "emails sent per hour" to what the SMTP provider allows.
   - Bot protection is the owner's call: Supabase Auth supports hCaptcha or
     Cloudflare Turnstile (Authentication → Attack Protection). Turning it on
     also blocks direct sign-up calls that bypass the app's throttle, but needs
     a widget on the sign-up, sign-in and reset forms, so it is not on today.

## 2. Apply the schema

On a **fresh, empty** project the whole migration tree applies cleanly in
filename order. 0001 drops every table in `public` — it is only safe on an
empty database, and the runner refuses it on a database that has any table in
`public`. For an existing project apply only the reviewed, unapplied files, as
recorded in `supabase/MIGRATIONS.md`.

`scripts/apply-migration.mjs` is the committed runner (details in
`supabase/MIGRATIONS.md`, "Applying without Docker or psql"). It reads
`SUPABASE_DB_PASSWORD` and `NEXT_PUBLIC_SUPABASE_URL` from `.env.local` (or
`--env-file`), connects directly to `db.<ref>.supabase.co:5432` (IPv6 unless
the project has the IPv4 add-on) over TLS verified against Supabase's root CA,
and only to a `--target` that is listed in `supabase/migration-targets.json`
and matches the env file. **Add the production project to that file in a
reviewed PR before its first migration.** Then, from the repo root:

```bash
# 1. dry run: checks the target, prints each file's plan and a confirmation code
node scripts/apply-migration.mjs --target production supabase/migrations/*.sql
# 2. read the plan, then apply exactly those files
node scripts/apply-migration.mjs --target production --apply --confirm <code> supabase/migrations/*.sql
```

Each file runs in one transaction with its row in
`supabase_migrations.schema_migrations`; a failing self-check raises, rolls
back that file (and its row) and stops the run. Rerunning the same command
skips what is recorded. The dashboard SQL editor is the alternative, but
records no history. `supabase db push` is not used.

Then verify:

- The guard suites are **not** run against a hosted project — they insert
  fixture rows (rolled back) and `scripts/test-sql-guards.sh` refuses any
  non-local host. CI's `sql-guard` job builds a blank Postgres from the same
  chain on every push and runs every `supabase/tests/*_guard.sql` (55+
  suites; each must print `all … checks passed`). Confirm that job is green
  for the exact commit you applied.
- On the hosted project: every file's self-check NOTICEs appeared with no
  error; `select jobname, schedule from cron.job order by 1;` lists the twenty-one
  jobs in §4; `select id, public from storage.buckets order by 1;` lists the
  buckets the migrations create (avatars, car-images, activity-images,
  listing-images public; dispute-evidence, message-photos, account-exports
  private).

## 3. Seed the migration history

The runner records every file it applies in
`supabase_migrations.schema_migrations` (version = the filename up to the
first underscore, `0001`, …, `20261004150000`; name = the rest), so a project
built with it needs no seeding. Only a project whose files were applied some
other way (the SQL editor, or the runner before OS-W10) has gaps: shared dev
records 16 files (0001–0011 and five from 13 September) and staging was seeded
with 229 by hand. To fill gaps there, generate the statement from the files
actually applied rather than maintaining a list by hand:

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

Edit it down to the files that really are applied (probe the objects; never
infer from the file list), review it, then run it in the SQL editor. The
runner only runs files from `supabase/migrations/`, so it won't run this one.
`on conflict do nothing` makes it safe to repeat. Keep `supabase/MIGRATIONS.md`
as the human record of what was applied where and when.

## 4. Wire the app

Environment (deployment platform). Boot-time validation:
`src/instrumentation.ts` runs `validatePaymentsEnv()` (`src/lib/env.ts`). In
**live-money mode** — `NODE_ENV=production` with Stripe selected — every row
marked *required (live)* is checked together and the server refuses to start
if any is missing or invalid.

| Variable | Live-money production | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | required | production project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | required | browser-safe key |
| `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) | required | server only; bypasses RLS |
| `PAYMENTS_MODE` | recommended `stripe` | unset = `stripe` when `STRIPE_SECRET_KEY` is set. Production refuses stub mode (or a missing key) unless `PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true`, which is for non-public sandboxes only |
| `STRIPE_SECRET_KEY` | required | `sk_live_…` flips `paymentsAreLive()`; the terms' and fees page's test-mode notices disappear at the same moment |
| `STRIPE_WEBHOOK_SECRET` | required (live) | signing secret of the platform endpoint below |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | required (live) | signing secret of the Connect endpoint (`account.updated` on sellers' accounts) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | required (live) | live publishable key |
| `SENTRY_DSN` | required (live) | must be an `https:` DSN with a key and a numeric project path (`https://<key>@<host>/<project id>`) |
| `ADMIN_ALERT_WEBHOOK_URL` | required (live), `https:` | operator alerts (Slack-compatible body). Outside live-money mode it may be unset; alerts then accumulate as `disabled` outbox rows in Admin → Payments |
| `NEXT_PUBLIC_SITE_URL` | required (live), `https:` | the canonical origin only — no path, query, fragment or credentials. Unset, links fall back to `https://` + Vercel's `VERCEL_PROJECT_PRODUCTION_URL` (set by the platform), then `http://localhost:3000` |
| `CRON_SECRET` | required (live), ≥ 32 chars | bearer for every `/api/jobs/*` route and `/api/health/workers`; the same value goes in `job_config.transfer_worker_secret` and the monitor's `DRVN_MONITOR_SECRET` |
| `GUEST_RECEIPT_SECRET` | required (live), ≥ 32 chars | signs guest receipt and checkout-identity cookies and keys the hashed network identity used for guest abuse limits. Any production build without it throws on the first guest checkout or anonymous rate-limit check. Rotating it invalidates outstanding guest receipts |
| `ACCOUNT_EMAIL_DIGEST_KEY` | optional (recommended before launch), ≥ 32 chars | keys the HMAC kept in place of a deleted account's email (N16, `account_deletion_requests.email_digest`). Unset, a key derived from `GUEST_RECEIPT_SECRET` is used and recorded as `derived-v1`, so rotating that secret changes later digests; each digest records which key made it. Never rotate it once set |
| `TRUST_PROXY_HEADERS` | unset on Vercel; `true` only behind another verified proxy; `false` to disable | identifies signed-out visitors (hashed, never stored raw) for checkout, sign-in, password-reset and error-report rate limits. **On Vercel** (`VERCEL=1`, set by the platform) the app trusts `X-Vercel-Forwarded-For`, then `X-Forwarded-For`, with no setting: Vercel documents that it overwrites `X-Forwarded-For` and does not forward client-supplied addresses ([request headers](https://vercel.com/docs/headers/request-headers)). **Elsewhere** set `true` only once you have confirmed (host docs plus a test request with a forged header) that the ingress replaces client `X-Forwarded-For`. With no trusted source every signed-out visitor shares one `unattributed` bucket — safe, but one busy visitor can rate-limit all guests, so live-money production logs a `[startup]` warning. Sign-in and reset limits per address are skipped in that state (a shared bucket would let one attacker lock everyone out); the per-email limits still apply |
| `FLAG_INTEGRATED_SHIPPING_V1`, `EASYPOST_API_KEY`, `EASYPOST_WEBHOOK_SECRET` | optional | DRVN Shipping; see §10. `SHIPPING_MODE` / `SHIPPING_ALLOW_STUB_IN_PRODUCTION` override |
| `ANTHROPIC_API_KEY` | optional; needed for the agent and the importer to call the model | one key serves both `src/lib/ai` (the agent) and the listing importer. Unset in production = both report `disabled` (the agent's chat says it isn't switched on; importing shows "temporarily unavailable"). Zero data retention is arranged on the Anthropic account, not in code (`docs/legal-review-checklist.md`) |
| `LISTING_IMPORT_MODEL`, `LISTING_IMPORT_AI_MODE` | optional | importer model (default `claude-sonnet-5`) and mode override `anthropic` \| `stub` \| `disabled`. `LISTING_IMPORT_ALLOW_STUB_IN_PRODUCTION=true` lets a non-public sandbox run the stub extractor in production; never set it on a public deployment |
| `LISTING_IMPORT_ALLOW_PRIVATE_HOSTS`, `LISTING_IMPORT_PUBLIC_BROWSER_ENABLED` | never in production | test-only: relax the importer's SSRF guard for local fixture servers, and enable the Playwright page-render fallback. Both are ignored when `NODE_ENV=production`, whatever their value |
| `AGENT_MODEL` | optional (default `claude-opus-5-5`) | the agent's model. Must be one of the priced models in `src/lib/ai/config.ts` `MODEL_PRICES` (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-sonnet-5`, `claude-haiku-5-5`), because spend caps sum each call's priced cost. An unpriced model turns the agent `disabled`, and with `AGENTS_BETA=on` in production the server refuses to start (`validatePaymentsEnv`, "Agent configuration is invalid") |
| `AGENT_AI_MODE` | optional | `anthropic` \| `stub` \| `disabled`. Unset = `anthropic` with a key, `stub` without one outside production, `disabled` without one in production. `stub` in production is read as `disabled` |
| `AGENT_MAX_ITERATIONS` | optional (default 8) | hard stop on one agent run's tool loop; integers 1–20, anything else = 8 |
| `AGENTS_BETA` | required (`on`) for the agent to show to members | the environment's master switch for the agent beta. With it off no member sees agent controls, whatever `/admin/agent` says (§13e). With it on in production, boot checks `AGENT_MODEL` and the shape of `AGENT_WORKER_DATABASE_URL`, and logs a `[startup]` warning if `ANTHROPIC_API_KEY` is missing (chat and sentence-to-filters then say they're switched off; negotiation runs without the model) |
| `AGENT_WORKER_DATABASE_URL` | required for the agent to act | the `agent_worker` login through the transaction pooler, `postgresql://agent_worker.<ref>:<password>@<pooler-host>:6543/postgres` (§13a). Without it `/api/jobs/agent` still runs reconcile, retention and the health check, but no worker pass: queued jobs wait. A malformed URL fails boot when `AGENTS_BETA=on` in production, and the worker refuses a connection whose user isn't `agent_worker` |
| `E2E_TEST_PROJECT_REF` | never in production | `local-drvn-remediation` marks the isolated e2e stack: only together with an `http://localhost` site and a Supabase URL on `localhost:54321` does it relax secure cookies and the https-only media check |
| `DRVN_PUBLIC_CACHE` | optional | `off` disables the public-read cache (`src/lib/supabase/public-cache.ts`) for a host that needs every read fresh, as the isolated e2e stack does. Leave unset in production |
| `DRVN_SITE_ORIGIN` | optional (operator shell) | read only by `scripts/owner/stripe-webhooks.mjs` as the default for `--origin` (then `NEXT_PUBLIC_SITE_URL`); not read by the app |
| `DRVN_MONITOR_ALERT_URL`, `DRVN_MONITOR_HEARTBEAT_URL`, `DRVN_MONITOR_STATE_FILE`, `DRVN_MONITOR_INTERVAL_MS` | monitor host only | `scripts/check-worker-health.mjs --watch` (§9b): transition alerts, dead-man heartbeats, where it keeps state, and the poll interval (default 60000 ms). Together with `DRVN_MONITOR_ORIGIN` and `DRVN_MONITOR_SECRET` these are set where the monitor runs, never on the app's deployment |
| `TYPESENSE_URL`, `TYPESENSE_API_KEY` | optional | both set = Typesense search; unset = Postgres search, and the `search` health family reports disabled |
| `POSTHOG_KEY`, `POSTHOG_HOST` | optional | consented analytics only; unset = the `analytics` health family reports disabled |
| `SENTRY_RELEASE` | optional | release tag; falls back to `VERCEL_GIT_COMMIT_SHA` (set by Vercel), then `GIT_COMMIT_SHA`. Error reports are tagged with the deployment from `VERCEL_DEPLOYMENT_ID`, then `DEPLOY_ID`; set `GIT_COMMIT_SHA` and `DEPLOY_ID` on a host that isn't Vercel |
| `NEXT_BUILD_ID`, `DRVN_NEXT_DIST_DIR` | optional | read by the public `GET /api/version` (`{sha, buildId, newestMigrationOnDisk, startedAt}`, no-store): `buildId` is `NEXT_BUILD_ID` if the host sets it, else the build's own `BUILD_ID` file in `DRVN_NEXT_DIST_DIR` (default `.next`); `sha` is `VERCEL_GIT_COMMIT_SHA`, then `GIT_COMMIT_SHA`. Leave both unset on Vercel |

Stripe (live mode). `scripts/owner/stripe-webhooks.mjs --live` creates or
updates both endpoints below (dry run by default; `docs/owner/README.md`).
Both endpoints must use the API version the app pins, **2026-07-29.dahlia**
(`src/lib/payments/stripe-api-version.ts`): an endpoint's version decides the
shape of the events it sends. The script creates endpoints on that version and
reports any existing endpoint on another one (Stripe can't change an
endpoint's version; delete it and re-run). Moving the pin is a deliberate
change: read Stripe's changelog in between, update the fixtures in
`stripe-api-version.test.ts`, then re-create the endpoints.

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

Storage origin for member photos (20261107203000). The database refuses a
member's new photo reference (car, gallery, listing, post, avatar) unless it
is a public URL on this origin, and refuses **all** of them while the row is
missing: a migration can't know the origin, and failing open would accept
URLs on any host that are never revalidated. Set it **in the same step as
applying that migration**, to the project's `NEXT_PUBLIC_SUPABASE_URL` origin
(scheme and host, no path or trailing slash):

```sql
insert into public.job_config (key, value)
values ('media_storage_origin', 'https://<project-ref>.supabase.co')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

The upload route and the media-gc job also record it from the server's own
`NEXT_PUBLIC_SUPABASE_URL` if it's missing (never overwriting a set value),
so a missed step heals on the first photo upload, but photo saves fail until
then. CI's bootstrap (`scripts/prepare-ci-supabase.mjs`) sets the local one.

Payments mode (20261107210000). The database refuses to put a listing live,
or to reserve one at checkout, for a seller whose Stripe payouts aren't
enabled, the same rule as `sellerCanPublish`. It has no way to see the app's
`PAYMENTS_MODE`, so a stub-payments database says so with one row, and
**production records nothing**: no row means the rule is enforced.

```sql
-- Only on a database whose app runs PAYMENTS_MODE=stub (CI, a sandbox):
insert into public.job_config (key, value) values ('payments_mode', 'stub')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

CI's stub jobs and the SQL guard runner record it; the Stripe test lane
doesn't. Never set it on a database that takes real payments.

Confirm the twenty-one pg_cron jobs (times are the database's UTC). This is
`private.scheduled_job_inventory()` (latest `20261107210100`), mirrored in
`src/lib/job-inventory.ts`; `job-inventory.test.ts` holds both copies and
every migration's `cron.schedule` call to the same set, and worker health
judges each job against its budget:

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
| `drvn-saved-search-digests` | `41 * * * *` | `invoke_remediation_worker('saved-search-digests')` → `/api/jobs/saved-search-digests` (20261107200300) |
| `drvn-listing-import-sweep` | `37 3 * * *` | `invoke_remediation_worker('listing-imports')` → `/api/jobs/listing-imports` (20261004150000) |
| `drvn-delivery-auto-confirm` | `23 * * * *` | `auto_confirm_untracked_deliveries()` (SQL) — the 21-day untracked auto-confirm (20261006100100) |
| `drvn-marketplace-counts` | `30 seconds` | `refresh_marketplace_facet_counts()` (SQL) — the Marketplace's precomputed facet counts (20261011120000) |
| `drvn-explore-trending` | `*/2 * * * *` | `refresh_explore_trending()` (SQL) — Explore's trending rows (20261011120000) |
| `drvn-explore-builders` | `*/10 * * * *` | `refresh_explore_builders()` (SQL) — Explore's builders rows (20261011120000) |
| `drvn-search-words` | `23 * * * *` | `refresh_search_words()` (SQL) — the search vocabulary (20261011130000) |
| `drvn-grow-products` | `17 * * * *` | `grow_products()` (SQL) — incremental products growth from new part keys (20261020120000) |
| `drvn-grow-products-full` | `47 4 * * *` | `grow_products(true)` (SQL) — the daily full pass (20261020120000) |
| `drvn-agent-worker` | `*/5 * * * *` | `invoke_remediation_worker('agent')` → `/api/jobs/agent` (reconcile, retention, one worker pass, health; §13d) (20261026100000) |
| `drvn-listing-edit-sweep` | `45 3 * * *` | `prune_listing_edit_requests()` (SQL) — `private.listing_edit_requests` rows older than 7 days (20261026100000) |
| `drvn-cron-history-prune` | `27 4 * * *` | `private.prune_cron_history()` (SQL) — `cron.job_run_details` older than 14 days (20261107191000) |
| `drvn-ledger-reconciliation` | `50 5 * * *` | `invoke_remediation_worker('ledger-reconciliation')` → `/api/jobs/ledger-reconciliation` (20261107210100): read-only Stripe ↔ ledger comparison; discrepancies open `ledger_discrepancy` cases in Admin → Payments |

`select jobname, schedule from cron.job order by 1;` must return exactly
these twenty-one. Without the `job_config` rows the SQL jobs still run, but every
HTTP worker returns immediately without calling the app.

## 5. Seed the first admin (and every later one)

Membership is SQL-only by design (0018), and it counts only once the
operator has confirmed the member's authenticator (20261107200500, N136).
Without that step, whoever held the new member's password first could set up
their own authenticator and take the console.

1. Promote the account. It is now **pending**: no console, no admin rights.
   ```sql
   insert into public.admin_users (user_id, role, note)
   values ('<auth.users id>', 'admin', 'founder')   -- or 'viewer'
   on conflict do nothing;
   ```
2. The member signs in, opens `/admin`, is sent to `/admin-verify`, sets up
   their authenticator app and enters a code. The page then shows the
   factor's **reference** (its id) and when it was set up.
3. Check it with the person **out of band** (phone or in person, never by
   replying to an email or chat from that account). They read you the
   reference; compare it with what Supabase Auth holds:
   ```sql
   select id, friendly_name, status, created_at
   from auth.mfa_factors where user_id = '<auth.users id>' and factor_type = 'totp';
   ```
   One verified factor, the same id, set up when they say. If there is a
   factor they didn't set up, someone else has their password: remove the
   membership (`delete from public.admin_users where user_id = …`), delete
   that factor in Supabase Auth, and have them change their password.
4. Confirm it (service role, e.g. the SQL editor):
   ```sql
   select public.confirm_admin_mfa('<auth.users id>', '<factor id>',
     '<your name>: phoned <member>, reference matched');
   ```
   The console opens for them on their next code. `admin_users` keeps who
   confirmed it and when. Only a sign-in stepped up with **that** factor is
   an admin session (20261107200550): another authenticator on the same
   account, even a verified one, opens nothing.

If the confirmed factor is ever removed (a lost phone: the recovery steps in
`docs/remediation-operations.md`), the membership is pending again until the
operator repeats steps 2–4 for the new factor. Members confirmed by the
migration itself were those with exactly one verified authenticator on file
when it ran (`mfa_confirmed_by` says so); anyone else is pending until
confirmed. The console is at `/admin`; it 404s for everyone else.

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
  disputes, the payout setup deadline, alerts, analytics and receipts. It reports what it paid out and
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

## 5c. Old photos that still carry metadata (one-off, N627)

Message photos sent before 20261005100000 went into `message-photos` straight
from the browser and may still hold EXIF with GPS. New uploads are
re-encoded by the server. Run once per project, dry run first:

```sh
DRVN_MEDIA_PROJECT_URL=$NEXT_PUBLIC_SUPABASE_URL node scripts/owner/scrub-photo-metadata.mjs            # dry run: counts only
DRVN_MEDIA_PROJECT_URL=$NEXT_PUBLIC_SUPABASE_URL node scripts/owner/scrub-photo-metadata.mjs --apply    # re-encode in place
```

It checks `message-photos` and `agent-chat-photos`, re-encodes any photo with
EXIF/XMP/IPTC in place (same path and format, orientation applied) under the
media cleanup's per-object lock (20261108120010), and records each outcome,
so a rerun continues where the last stopped. Storage's write always upserts,
so a write that lands after a deletion (clearing a chat, account deletion,
which never wait for this job) would bring the photo back: the write is fenced
on the object's identity, and a photo it recreated is deleted again at once,
or by the next run if this one died. Every run starts by checking what the
scan can't see: unfinished leases past their 10 minutes, and paths the media
cleanup tombstoned that have an object again (a late write landed after the
cleanup). Those photos are deleted again ("strays: … deleted again" in the
summary). Repeat `--apply` until it
reports nothing left, then once more to confirm. `skipped` objects (a format
it won't re-encode) are listed for a person to look at. Dispute evidence is
never touched (kept as uploaded); public buckets use
`scripts/public-media-backfill.mjs`. Not scheduled: new uploads can't carry
metadata, so there is nothing for a repeat run to find.

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
   workers (§6b). Reconcile storage references against objects and reapply
   deletion/retention tombstones (§6a). Hold ambiguous effects for operator
   review instead of creating replacement operations.
4. Rehearse the previous compatible application with queued work, Auth,
   provider callbacks and private downloads. Use a forward fix if the previous
   application is incompatible; do not erase committed financial state.
5. Record actual elapsed recovery time, unrecovered data and operator findings
   against approved targets. Obtain hosted acceptance before opening to members.

### 6a. Storage objects: back up, restore, reconcile (N232)

A database backup or point-in-time recovery does **not** contain photo bytes.
Supabase keeps them in object storage outside Postgres; the database holds
only the rows that name them (`car_images`, `listing_images`, `messages.attachments`,
`dispute_evidence`, `agent_messages.images`, post bodies, order snapshots…)
and Storage's own object rows (`storage.objects`). A database restore rolls
both kinds of row back to the recovery point and leaves the bytes as they are
now, so afterwards:

| Since the recovery point… | After a database-only restore | What to do |
|---|---|---|
| a photo was uploaded | bytes in the bucket, no `storage.objects` row: invisible to the app | nothing for the app; it is an orphan. Delete it from the bucket only after step 5 below, never before |
| a photo was deleted (cleanup, a member's deletion, a takedown) | row and reference back, bytes gone | restore that object's version from the object backup, **unless** the deletion was a member's or a takedown: then reapply the deletion (step 5) |
| a photo was re-encoded (N627 job) | row back, bytes are the re-encoded ones | nothing: same path, metadata already gone |

**Backup.** Keep a separate, versioned copy of every bucket in step with the
database recovery points: at least `avatars`, `car-images`, `activity-images`,
`listing-images`, `dispute-evidence`, `message-photos` and `agent-chat-photos`
(and `account-exports` if exports must survive). Use Supabase's S3-compatible
access (Storage → Settings → S3 access keys) with a sync tool into a bucket
with object versioning on, on a schedule no longer than the database's backup
interval, retained at least as long as the database backups. The private
buckets hold personal data: the copy is private, encrypted, and deleted on the
same schedule as the database backups (privacy page, deletion requests).
Record the sync's last completion time; it is the object recovery point.

**Restore, in order** (on the isolated target first, as in §6 step 1):

1. Restore the database recovery point, outbound jobs disabled.
2. Restore object versions as of the same moment (or the closest *later*
   object snapshot: a later copy has extra bytes, which are harmless orphans;
   an earlier one is missing photos) into the target's buckets, keeping paths.
3. Run the reference check. It is read-only:

   ```sh
   DRVN_MEDIA_PROJECT_URL=$NEXT_PUBLIC_SUPABASE_URL node scripts/owner/storage-reference-check.mjs --verify-bytes
   ```

   It prints references whose object has no row (`storage_reference_report`,
   20261108120020), member-media objects nothing names, and, with
   `--verify-bytes`, every object row whose bytes Storage can't find (a
   one-byte ranged GET per object: a HEAD answers from the row alone and
   would call a restored row with deleted bytes present). It exits 1 when a
   reference or bytes are missing or a check went unanswered. `--json` keeps
   the full result for the restore record.

   References whose object is gone **on purpose** are listed apart as "gone
   on purpose, not to restore" and don't fail the check: chat photos the
   sweep has deleted (at least the 48 hours the privacy page promises, from
   `private.agent_chat_photo_retention()`, the same value the sweep uses, and a
   sweep pass since; a missing chat photo younger than that is a real loss),
   and anything the media cleanup deleted and tombstoned. `--verify-bytes`
   applies the same rule to restored object rows whose bytes are gone. Never
   restore those.
4. For each missing object: restore it from an older object version if one
   exists; otherwise record it as lost in the restore record. Don't edit the
   referencing rows to hide it: a missing listing photo shows as missing,
   which is the truth, and order snapshots and dispute evidence are records.
5. Reapply every deletion made since the recovery point before reopening:
   account deletions (`account_deletion_requests`, the deletion worker),
   copyright takedowns (`copyright_notices`), chat clears, and the media
   cleanup's own work (`media_cleanup_queue` reruns by itself). A restored
   photo a member had deleted must not come back. The operator's list comes
   from the support/takedown log and the audit log export taken before the
   incident, since the restored database no longer has those rows.
6. Run the check again until it is clean, then delete orphans from step 2's
   table only if they are not in step 5's list of photos to keep deleted.

`scripts/local-recovery-rehearsal.sh` runs the report on the synthetic source
and on the restored target and requires the two to be identical.

### 6b. Stripe after a database restore (N232)

A restore can roll the ledger back but not Stripe: payments captured, refunds
made and payouts (transfers) sent after the recovery point still happened.
The restored database doesn't know about them, so restarting the money
workers on it can pay a seller twice or pay out an order that was refunded.
**Money workers stay off until this section is done.** None of these steps
moves money; corrections are the console's existing audited commands. The
money rules (who is paid, when, refunds, holds, fees) don't change.

1. **Keep the schedule off.** On the restored project leave every scheduled
   job in §4 inactive and the `job_config` worker URLs empty, as the drill
   does; above all `drvn-transfer-worker` (the whole money pass: captures,
   payouts, refunds, returns, disputes) and `drvn-delivery-auto-confirm`.
   Don't press "Run worker now". Note the recovery point T.
2. **Replay Stripe's events since T.** Events Stripe delivered between T and
   the restore were applied to the lost database and won't be sent again on
   their own. List them (`stripe events list --created[gte]=<T − 1 hour as a
   Unix time> --limit 100`, paging with `--starting-after`; Stripe keeps
   events for 30 days) and resend each to the platform and Connect endpoints
   (`stripe events resend <evt_id> --webhook-endpoint <we_id>`), or use
   Admin → Payments → Replay for one retained here. Every handler is guarded
   so a replay applies at most once (`dispatchStripeEvent`,
   `src/lib/payments/settlement.ts`); one that can't apply stays unprocessed
   or opens a recovery case, and step 3 lists it either way.
3. **Run the ledger reconciliation from the recovery point** (#91, N115). The
   daily run starts at the last complete run in its own history, which was
   restored too, so give it the start explicitly (up to 35 days back):

   ```sh
   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
     "https://<domain>/api/jobs/ledger-reconciliation?since=<T − 48 hours, ISO 8601>"
   ```

   It is read-only and compares payments, refunds and transfers (order
   payouts and credit payouts) both ways; each discrepancy becomes a
   `ledger_discrepancy` case in Admin → Payments. A `503`/`complete: false`
   means it couldn't read everything: run it again. Run it once more two
   hours after the restore, because each pass stops two hours before now.
4. **Resolve every case before restarting.** What the common restore cases
   mean:
   - `payment:…:missing` — Stripe captured a payment for an order the
     restored database doesn't have (created after T). The case opens with
     no order link (the order isn't there to link to) and names the order id
     from Stripe's metadata in its detail. The buyer was charged:
     refund it in the Stripe Dashboard, or rebuild the order from the
     buyer's receipt; record which in the case.
   - `transfer:…:missing` on an order — the seller was already paid. Before
     the transfer worker runs, that order's `transfer_intents` row must
     describe the transfer Stripe made, so the worker's own lookup finds and
     records it instead of paying again: set `operation_key`
     (the transfer's `transfer_operation` metadata), `dispatch_amount_cents`,
     `dispatch_currency`, `dispatch_destination`, `dispatch_source_transaction`,
     `dispatch_transfer_group` from the Stripe transfer, and
     `provider_call_may_have_occurred = true`. Anything that doesn't match
     exactly becomes an operator recovery case instead of a payout.
   - `refund:…:missing` — Stripe refunded a payment the restored ledger
     doesn't show refunded. Hold that order's payout (leave its intent's
     `next_attempt_at` in the future) until the refund is recorded.
   - `carry:…:missing` — a credit payout Stripe sent: same as a transfer.
   - Stripe payouts to sellers' banks are Stripe's (Express accounts) and
     follow the transfers; nothing in DRVN's ledger to restore.
5. **Restart** the money jobs only when a fresh reconciliation pass (step 3)
   opens no new case and every restore case is closed. Then watch Admin →
   Settings → Background jobs for one full cycle.

Record T, the restore time, every replayed event count, every case and how it
closed in the restore record (the table below).

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
- [ ] `job_config.media_storage_origin` is the production storage origin (§4).
- [ ] `job_config` has **no** `payments_mode` row (a `stub` row would switch off the payouts check on publishing and checkout, §4).
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
their opt-in.

Email digests (N78, `drvn-saved-search-digests`, hourly): at most one email
per saved search per day. Each alerting search has its own email window
(`saved_search_email_cursors`), started when its alert is turned on and
separate from the in-app cursor, so a digest carries every part published
since the last one. From 08:00 London the first run of the day admits each
search's window into `saved_search_email_digests` (unique per search per
day). Each run admits and sends in batches until nothing is left or its
four minutes are up; the later runs retry sends, hourly at most, all day. A
window is cut on publishing transaction ids (`listings.published_xact`, the
snapshot xmin when it closes; 20261107200350), so a part whose publication
was still committing goes in the next digest. A long-open transaction holds
xmin back: matches wait, they are never dropped. A member with
"Saved-search matches" or "Saved-search emails" off is not mailed, and
neither is an unconfirmed address, a suspended or closing account, or a
search whose alert went off (turning it off skips its unsent digests). A
digest still unsent at the end of its day is carried: its window goes back
into the next day's digest, but never further back than midnight (London)
seven days before the current day. So the first email after a long outage,
or after a provider is first configured, covers at most the last 7 days of
still-active matches; older matches drop silently. Nothing published before
the alert was (last) turned on is mailed either, even when a long-open
transaction pins the window's start id below it (`activated_at`). Records
are kept 90 days. Sending goes
through `src/lib/email/send.ts`, selected by `EMAIL_PROVIDER` and sent from
`EMAIL_FROM`. No provider is chosen yet (R-email): until one is, digests are
recorded and nothing is sent, and the route logs and returns `provider: null`.

`/api/jobs/media-gc` and `/api/jobs/listing-imports` are scheduled the same
way. To run any of them by hand:
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

This mode alerts only through GitHub's failed-workflow notifications; each
problem is written to the run as an annotation (`job drvn-media-gc: overdue
since …`), so the failure says what to fix. The `--watch` mode (transition
alerts to `DRVN_MONITOR_ALERT_URL`, dead-man heartbeats to
`DRVN_MONITOR_HEARTBEAT_URL`, state in `DRVN_MONITOR_STATE_FILE`) runs on a
separately administered host, not in this workflow — see
`docs/remediation-release-and-monitoring.md`. Before relying on either, stop a
job in staging (below) and confirm an alert and a recovery actually arrive.

**What health judges (20261107191000).** `private.scheduled_job_inventory()`
is the one list of what pg_cron must run: every `drvn-*` job, its schedule,
its command, the worker families it drives and how long it may go without a
success. Check the scheduler against it by name and by running, never by
counting rows:

```sql
select x->>'job' job, x->>'reason' reason, x->>'last_success' last_success
from jsonb_array_elements(public.worker_health_snapshot()->'jobs') x order by 1;
```

`reason` is null when the job is fine; otherwise `not_scheduled`, `inactive`,
`schedule_changed`, `command_changed`, `failing`, `stuck_running`,
`never_succeeded` or `overdue` (`history_disabled` if `cron.log_run` is off).
A job that has never run is not reported until the scheduler's own history is
older than that job's budget, so a fresh project is not red overnight; a
worker family that has never run is (run its route once by hand). The `config`
block checks pg_cron, pg_net, run history, the `job_config` worker URL and
that the scheduler's secret equals the deployment's `CRON_SECRET` (compared as
a SHA-256; neither is returned). Queues count only work DRVN owes: an
undelivered payout hold, a payout frozen by an unresolved chargeback and a
seller who can't be paid yet are not overdue (blocked payouts show with
`overdue: false`); refunds Stripe is still settling are
`refunds/awaiting_provider`, late after 72 hours, while an outcome Stripe
hasn't confirmed either way (a timeout, a failed lookup) is
`refunds/provider_unknown`, aged from creation and late after two hours (and
it fails the `refunds` family on every pass); provider events not yet
applied are `webhooks/retrying` (with the highest attempt count; Admin →
Payments lists them first, with the last failure, beside Replay), overdue
after an hour; a chargeback loss whose lease ran out is
`provider_disputes/loss_pending`. `drvn-cron-history-prune` keeps
`cron.job_run_details` to 14 days.

**Paging without noise (`--watch`).** An incident pages after
`DRVN_MONITOR_CONFIRM_CHECKS` consecutive failing checks (default 2), again
only when a problem not already paged appears (`worsened`) or every 30 minutes
while it lasts (`still_unhealthy`), and once on `recovered`. Each alert carries
`summary`, `problems` (area, name, reason, since, count; never a secret, URL
or member data) and `runbook`. Set `DRVN_MONITOR_SILENCE_UNTIL` to an ISO
time for planned work: nothing is sent until then, and an incident still open
when it ends pages at once.

**Stop a job deliberately (staging).** `select cron.alter_job((select jobid
from cron.job where jobname = 'drvn-explore-trending'), active := false);`
— within one check the endpoint returns 503 naming
`job drvn-explore-trending: inactive`, and after the confirmation checks the
destination receives `unhealthy`. Re-activate it (`active := true`); once it
runs again the destination receives `recovered`.

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
   **Tracking is separate from labels** (N110): with `EASYPOST_API_KEY`
   set, every seller-entered tracking number is registered with the EasyPost
   tracker after dispatch, even while `FLAG_INTEGRATED_SHIPPING_V1` is off;
   the money worker's `labelVoids` family retries what fails
   (`tracker_registration` jobs). There is no amount limit on dispatch, and
   nothing to switch for $1,000+ orders. With no key, dispatch is unchanged
   and untracked.
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
  deletions 5 min, transfers 10 min, saved searches 30 min, saved-search
  digests hourly, media GC and listing imports daily). Each job runs once its interval has passed, so a
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
one worker pass when `AGENT_WORKER_DATABASE_URL` is set.
`20261026100000_agent_hosted_schedule.sql` schedules it as `drvn-agent-worker`
every 5 minutes (`invoke_remediation_worker('agent')`, in §4's table) and
adds the `agent` family to worker health on a 30-minute budget; the same
migration adds the daily `drvn-listing-edit-sweep`.
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

# Hosted staging — setup checklist

An ordered checklist for standing up DRVN's hosted staging environment: the
environment the release-candidate gates (`scripts/release-candidate.mjs`) are
observed against. Staging runs the production build (`NODE_ENV=production`)
with **Stripe and EasyPost in test mode** — so every live-money check in
`src/lib/env.ts` applies to it, but no real money or postage moves.

Who does each step:

- **[OWNER]** needs the owner's accounts, a payment method, or a decision only
  the owner can make.
- **[ENGINEER]** can be done by an engineer once the owner has created the
  accounts and shared credentials through a password manager — never chat,
  email or the repo.

Details live in `docs/production-runbook.md` (the same steps for
production); this file is the order to do them in for staging. The owner's
whole pre-beta list, in order, is `docs/owner/README.md`. Record every
value you create in the password manager entry "DRVN staging".

## Status (7 November 2026)

| Step | State |
|---|---|
| 1. Supabase project | **Done.** The organisation is on Pro. Project `drvn-staging`, ref `zubstjuviwourzgrziqc`, region `us-east-1`, Postgres 17. |
| 2. Schema | **Done** for steps 2.1–2.4: all 229 migrations at `main` 836d636 applied in order with no errors, and the CLI history seeded with 229 rows. Step 2.5 waits for step 12. |
| 3–13 | Not started. Most wait on a hosting account and domain (step 4). |

The owner's rulings that day:

- **Region `us-east-1`**, the same as the shared dev project, not a UK region. Production should match.
- **No point-in-time recovery for now** (about $100 a month for 7 days). The `restore-rollback` gate uses Pro's daily backups on staging. Revisit before production.

Parity with shared dev was checked at 765c7cd, before the last two migrations: the same 115 public tables, 137 policies and 19 cron jobs, and 383 public functions whose `pg_get_functiondef` bodies match byte for byte. Row-level security is on for every public table, all seven buckets are present, and `job_config` is empty, so outbound jobs are off.

**Keeping staging current:** every migration merged to `main` must also be applied to staging, the same as dev. Apply it from the staging-only checkout (step 2.1), then rerun the history seed. Migrations can merge with timestamps earlier than ones already applied, so find new files with `git diff --name-only --diff-filter=A <last applied commit> origin/main -- supabase/migrations`, not by filename order.

---

## 0. Before you start [OWNER]

1. **Domain.** Pick the staging origin, e.g. `https://staging.<your-domain>`.
   It must be HTTPS and is used verbatim as `NEXT_PUBLIC_SITE_URL` (origin
   only, no path or trailing slash).
2. **Accounts the owner must hold** (each with 2FA on): Supabase, the hosting
   provider (Vercel assumed below — the code only reads Vercel's
   `VERCEL_*` variables as fallbacks), Stripe, EasyPost, Sentry, an email
   delivery (SMTP) provider, GitHub (Pro, step 11), and an alert destination
   (e.g. a Slack workspace for an incoming webhook).
3. **Decide whether staging uses the real importer and search.** Optional
   services can stay off: no `ANTHROPIC_API_KEY` (importer shows
   "temporarily unavailable" in production builds), no Typesense (Postgres
   search), no PostHog (analytics off). Write the decision down — it becomes
   `analyticsEnabled` / `searchEnabled` in the release-candidate config.

## 1. Supabase project [OWNER]

1. **Capacity.** Done 7 Nov 2026: the organisation is on Pro. The
   `restore-rollback` gate needs a real hosted recovery point, and Pro's
   daily backups provide one; point-in-time recovery is a separate add-on,
   deferred. Projects on a paid plan cannot be paused, and each active
   project bills compute, so unrelated projects belong in a separate free
   organisation (the YT Digest project was moved to "Personal (free)").
   Do **not** pause or reuse the shared dev project `grunnjojhdevhuckujmc`.
2. Create the project `drvn-staging` in `us-east-1`, the same region as dev
   (owner's ruling, 7 Nov 2026). Generate a strong database password.
3. From **Project Settings → API keys**, record: project ref, project URL,
   the publishable key (`sb_publishable_…`) and a secret key (`sb_secret_…`).
   Record the database password.
4. **Two routes to the database, and which one each job uses (#114).**
   `db.<ref>.supabase.co:5432` (the direct host) has only an IPv6 address
   unless the project buys Supabase's IPv4 add-on. GitHub's hosted runners
   have no IPv6, so the deploy workflow's read-only migration check cannot
   reach the direct host. Pick one:
   - **Session pooler (the default for staging, no cost).** Copy the host from
     **Connect → Session pooler** (for `drvn-staging` it is
     `aws-0-us-east-1.pooler.supabase.com`) into the target's `"pooler"` in
     `supabase/migration-targets.json` and set `"statusRoute": "pooler"`, in
     a reviewed PR. `--status` then connects there over IPv4 as
     `postgres.<ref>`, with the same password, and verifies the certificate
     (`*.pooler.supabase.com`, issued under the same pinned Supabase root) and
     the host name exactly as it does for the direct host. Staging is set up
     this way: on 9 Nov 2026 a TLS handshake (no password sent) confirmed the
     certificate chain and that the pooler knows the project.
   - **IPv4 add-on** (Project Settings → Add-ons; billed monthly). The direct
     host then answers over IPv4, and `statusRoute` can be dropped.
   Applies, record-only runs and dry runs always use the direct host, so the
   engineer applying migrations needs IPv6 (most home and office networks
   have it) or the add-on. Check with
   `node scripts/apply-migration.mjs --target staging --status` (pooler) and
   `... --status --route direct` (direct).

## 2. Apply the schema [ENGINEER]

This is a **fresh, empty** project, so the whole chain applies in filename
order. Never do this to a project that already has a schema — 0001 drops
every table in `public`.

1. Use a separate checkout (or `git worktree`) at the release-candidate
   commit, with its own `.env.local` containing only:
   `NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co` and
   `SUPABASE_DB_PASSWORD=<staging password>`. The runner reads `.env.local`
   from the current directory — doing this in your normal checkout would
   target the dev project.
2. Dry-run, then apply every migration in order (the run stops on the first
   failure; `staging` is in `supabase/migration-targets.json`):
   ```bash
   node scripts/apply-migration.mjs --target staging supabase/migrations/*.sql
   node scripts/apply-migration.mjs --target staging --apply --confirm <code from the dry run> supabase/migrations/*.sql
   ```
   Do **not** apply `supabase/tests/ci_shim.sql` — it is CI-only and rewrites
   auth helpers (the runner only takes files from `supabase/migrations/`).
3. The runner records each file in the CLI migration history as it applies
   it. Staging's first 229 files went in before it did, and their history was
   seeded by hand (`docs/production-runbook.md` §3); later files are recorded
   by the runner.
4. Verify in the SQL editor:
   - `select extname from pg_extension where extname in ('pg_cron','pg_net');`
     → both. (0020 swallows a pg_net install failure with a NOTICE; if it is
     missing, enable it under Database → Extensions and re-apply
     `0020_transfer_scheduling.sql`.)
   - `select jobname, schedule from cron.job order by 1;` → the twenty-one
     `drvn-*` jobs in runbook §4 (`private.scheduled_job_inventory()`).
     Staging listed 19 on 7 Nov 2026, before `20261107200300` and
     `20261107210100` added `drvn-saved-search-digests` and
     `drvn-ledger-reconciliation`; apply them and the count is twenty-one.
   - `select id, public from storage.buckets order by 1;` → `account-exports`
     f, `activity-images` t, `avatars` t, `car-images` t, `dispute-evidence`
     f, `listing-images` t, `message-photos` f. **Buckets and their policies
     are created by the migrations** — create nothing by hand.
   - The CI `sql-guard` job is green for this exact commit (guards are never
     run against a hosted project).
5. **No beta gate.** The invite-only beta was removed by #126
   (`20261107220800_open_beta_and_guest_holds.sql` dropped
   `public.beta_access_config`), so there is nothing to turn on. Sign-up is
   open and guest checkout is open with its holds capped: 2 live guest holds
   per device and per network, and 1 per listing. The release-candidate
   config declares this as `"guestCheckout": "capped"` (§13), and the
   `guest-hold-caps` gate proves it on staging.

## 3. Supabase Auth [OWNER clicks, ENGINEER can drive]

Authentication → URL configuration:

1. **Site URL:** the staging origin.
2. **Redirect URLs** (allowlist): `https://<staging-origin>/callback` and
   `https://<staging-origin>/callback?**` (signup confirmation, password
   reset `?next=/login/reset`, Google return), and
   `https://<staging-origin>/confirm?**` (guest order-access link, and the
   return address of the email-change link). Nothing
   else — a wildcard host would let a link land anywhere.

Authentication → Providers / settings:

3. Email provider on, **Confirm email on** (dev has it off for e2e). Leave
   "secure email change" on.
4. Google (optional): only if staging should offer it. Needs a Google Cloud
   OAuth client [OWNER] whose authorised redirect URI is Supabase's
   `https://<ref>.supabase.co/auth/v1/callback`. The signup page hides the
   button automatically when the provider is off.
5. MFA: TOTP enabled — every admin must enrol at `/admin-verify`.

Emails:

6. **Custom SMTP is required** [OWNER: choose and pay for a provider; verify
   the sending domain with SPF/DKIM]. Supabase's built-in sender is
   rate-limited and not for real recipients. Enter host, port, user,
   password and sender under Authentication → SMTP. Record the provider's
   name — the privacy policy must name it (`docs/legal-review-checklist.md`).
7. Templates. Paste the four files in `supabase/templates/` (Confirm signup,
   Magic Link, Change Email Address, Reset Password) with their subjects;
   `supabase/config.toml` wires the same files locally. The table, provider
   setup, and a known gap in guest order links with Confirm email on are in
   `docs/owner/email-provider.md`.

## 4. Hosting project [OWNER creates, ENGINEER configures]

1. Create the Vercel project from the GitHub repo [OWNER — needs the paid
   tier the owner chooses]; production branch = the release-candidate
   branch or `main`. Node 22 (CI uses 22.22.0). Build command `npm run
   build`, install `npm ci`. Turn the project's automatic Git deploys off:
   `.github/workflows/deploy.yml` deploys instead, only after `release-gate`
   passes (§11.4).
2. Attach the staging domain; confirm HTTPS.
3. Set the environment variables below for the deployment environment that
   serves the staging domain.

| Variable | Value / where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | step 1.3 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | step 1.3 |
| `SUPABASE_SECRET_KEY` | step 1.3 — server only |
| `NEXT_PUBLIC_SITE_URL` | the staging origin, `https://…`, no path |
| `PAYMENTS_MODE` | `stripe` |
| `STRIPE_SECRET_KEY` | Stripe **test mode** → Developers → API keys (`sk_test_…`). A test key keeps the site's test-mode notices on |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | same page (`pk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | step 5.1 (`whsec_…`) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | step 5.2 (`whsec_…`, the Connect endpoint) |
| `CRON_SECRET` | generate: `openssl rand -hex 32`. Also goes into `job_config` (step 7) and GitHub (step 10) |
| `GUEST_RECEIPT_SECRET` | generate: `openssl rand -hex 32` (different from `CRON_SECRET`) |
| `SENTRY_DSN` | step 8 — `https://<key>@<host>/<project id>` |
| `ADMIN_ALERT_WEBHOOK_URL` | step 9 — must be `https:` |
| `TRUST_PROXY_HEADERS` | **Leave unset on Vercel** — the app trusts Vercel's own `X-Vercel-Forwarded-For` / `X-Forwarded-For` automatically (Vercel overwrites both at its edge; see the production runbook). On any other host, `true` only after confirming it overwrites client `X-Forwarded-For` (check its docs, then send a request with a forged header and confirm rate limits key on the real address). `false` disables both |
| `FLAG_INTEGRATED_SHIPPING_V1` | `true` if staging exercises DRVN Shipping (`shippingMode: "easypost-test"`); unset for `"stub"` |
| `EASYPOST_API_KEY` | EasyPost **test** key (`EZTK…`), step 6 |
| `EASYPOST_WEBHOOK_SECRET` | step 6 |
| `SHIPPING_MODE` + `SHIPPING_ALLOW_STUB_IN_PRODUCTION=true` | only if the candidate declares `shippingMode: "stub"` |
| `ANTHROPIC_API_KEY` | optional (step 0.3), from the Anthropic console. One key serves the listing importer and the agent; unset, both report disabled |
| `AGENT_MODEL`, `AGENT_AI_MODE`, `AGENT_MAX_ITERATIONS` | optional. Model (default `claude-opus-5-5`; one of the priced models in `src/lib/ai/config.ts`), mode `anthropic` \| `stub` \| `disabled`, tool-loop cap 1–20 (default 8). Runbook §4 has each row |
| `AGENTS_BETA` | `on` only if staging exercises the agent; the steps still open from `/admin/agent` (runbook §13e) |
| `AGENT_WORKER_DATABASE_URL` | only if staging exercises the agent: the `agent_worker` login through the transaction pooler, after runbook §13a. Without it `/api/jobs/agent` runs no worker pass |
| `LISTING_IMPORT_MODEL`, `LISTING_IMPORT_AI_MODE` | optional importer model and mode override. Never set `LISTING_IMPORT_ALLOW_STUB_IN_PRODUCTION`, `LISTING_IMPORT_ALLOW_PRIVATE_HOSTS` or `LISTING_IMPORT_PUBLIC_BROWSER_ENABLED` on staging — the last two are ignored in production anyway |
| `DRVN_PUBLIC_CACHE` | leave unset (`off` is for the isolated e2e stack) |
| `TYPESENSE_URL`, `TYPESENSE_API_KEY` | optional (step 0.3) |
| `POSTHOG_KEY`, `POSTHOG_HOST` | optional (step 0.3) |

Never set `PAYMENTS_ALLOW_STUB_IN_PRODUCTION` on staging — the candidate
declares `paymentMode: "stripe-test"`, and the app refuses to boot with it
on a hosted deployment (N540). Deploy; the build must start without a
`PaymentsConfigError` in the logs. A boot failure lists every missing or
invalid variable at once.

## 5. Stripe, test mode [OWNER account, ENGINEER configures]

`scripts/owner/stripe-webhooks.mjs` creates or updates both endpoints below
(dry run by default; usage in `docs/owner/README.md`). By hand:

1. Developers → Webhooks → add endpoint, **events on your account**:
   `https://<staging-origin>/api/stripe/webhook`, events exactly:
   `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.requires_action`, `charge.refunded`, `refund.created`,
   `refund.updated`, `refund.failed`, `charge.dispute.created`,
   `charge.dispute.closed`, `account.updated`. Copy the signing secret into
   `STRIPE_WEBHOOK_SECRET` and redeploy.
2. Connect → enable Connect in test mode, **Express** accounts, platform
   profile and branding filled in [OWNER: platform business details]. Sellers
   onboard from `/payouts`; they return to `/settings/payouts/return`, which
   syncs `payouts_enabled`.
   Then add a **second** webhook endpoint, "events on connected accounts",
   at the same URL `https://<staging-origin>/api/stripe/webhook`, with the
   single event `account.updated`. Copy its signing secret into
   `STRIPE_CONNECT_WEBHOOK_SECRET` and redeploy. This is how a seller's
   payout status reaches DRVN after onboarding.
3. Send a test event from the dashboard and confirm a `200` in the endpoint's
   log.

## 6. EasyPost, test mode [OWNER account, ENGINEER configures]

Only if staging declares `shippingMode: "easypost-test"`.

1. Copy the **test** API key (`EZTK…`) into `EASYPOST_API_KEY`.
2. Settings → Webhooks → add `https://<staging-origin>/api/shipping/easypost`
   (test mode), set a webhook secret, and put the same value in
   `EASYPOST_WEBHOOK_SECRET`. The route acts on `tracker.created` and
   `tracker.updated`, refuses everything while the secret is unset, and
   rejects bad HMACs.
3. Runbook §10 covers the marketplace-account question to settle with
   EasyPost before any production key.

## 7. Scheduler → app [ENGINEER]

The migrations already created the pg_cron jobs (19 as of 7 Nov 2026); the HTTP ones do
nothing until the database knows where the app is. In the SQL editor:

```sql
insert into public.job_config (key, value) values
  ('transfer_worker_url', 'https://<staging-origin>/api/jobs/transfers'),
  ('transfer_worker_secret', '<CRON_SECRET value>')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

There are no other database-side secrets: nothing in the migrations reads
Vault or custom `current_setting` keys for workers. The URL must end in
`/api/jobs/transfers` — the other workers derive their routes from it.
Within ~10 minutes Admin → Settings → Background jobs shows each family
running; daily families (`media`, `listingImports`) show "never ran" until
their first 03:17 / 03:37 UTC run. Trigger one by hand to confirm:
`curl -X POST https://<staging-origin>/api/jobs/listing-imports -H "Authorization: Bearer $CRON_SECRET"`.

## 8. Sentry [OWNER account, ENGINEER configures]

Create a project (platform: Node/Next.js). Copy its DSN into `SENTRY_DSN`.
Reporting is server-side only (`src/lib/monitoring.ts`); there is no browser
SDK or replay to configure. Optionally set `SENTRY_RELEASE` (defaults to the
commit SHA). Trigger a test error and confirm it arrives.

## 9. Operator alerts [OWNER]

Create a Slack incoming webhook (or any HTTPS endpoint accepting a JSON body
with a Slack-compatible `text`) in a channel the operator watches. Put it in
`ADMIN_ALERT_WEBHOOK_URL`. Confirm a delivery: Admin → Payments shows the
alert outbox; a `disabled` row means the variable was not set when raised.

## 10. Independent monitor [OWNER sets repo settings]

The **primary** monitor is an outside uptime service calling
`/api/health/workers` every 3–5 minutes with the `CRON_SECRET` bearer and
paging a phone (runbook §9b, #104). GitHub runs the scheduled workflow below
only every few hours on a quiet repository, so it is the second line.


GitHub → repository → Settings → Secrets and variables → Actions:

- variable `DRVN_MONITOR_ENABLED` = `true`
- variable `DRVN_MONITOR_ORIGIN` = the staging origin
- secret `DRVN_MONITOR_SECRET` = the staging `CRON_SECRET`

The `--watch` mode's variables (`DRVN_MONITOR_ALERT_URL`,
`DRVN_MONITOR_HEARTBEAT_URL`, `DRVN_MONITOR_STATE_FILE`,
`DRVN_MONITOR_INTERVAL_MS`) belong to a separately run monitor host, not to
this workflow or the hosting project (runbook §9b).

Run "Independent worker monitor" once by hand (Actions → workflow_dispatch).
It fails while any daily family has never run — expected until after the
first 03:37 UTC. Then pause the worker (clear `job_config`), confirm the
failure notification reaches the operator, restore it, and confirm recovery.
For minute-level alerting with a dead-man heartbeat, run the `--watch` mode
on a separate host (`docs/remediation-release-and-monitoring.md`).

## 11. GitHub plan and branch protection [OWNER]

1. Upgrade the account to **GitHub Pro** (or make the repository public) —
   rulesets are unavailable on Free for private repositories.
2. Add the repository secret `STRIPE_TEST_SECRET_KEY` = a Stripe test-mode
   secret key. Without it the `stripe-integration` job fails on purpose and
   `release-gate` can never pass.
3. Apply the `protect-main` ruleset from runbook §8: pull requests required,
   **`release-gate` the only required status check**, force pushes blocked.
   `scripts/owner/branch-protection.sh` does it and verifies it
   (`docs/owner/branch-protection.md`).
4. Deploys go through `.github/workflows/deploy.yml` (N634, N528), not the
   host's own Git integration: turn the host's automatic deploys **off**, so
   nothing reaches staging without a passed `release-gate`. The workflow
   deploys each `main` commit to staging once its `release-gate` has passed
   and staging has every migration, then waits for `/api/version` to report
   that commit. Production deploys only by hand, for an annotated
   `rc-YYYYMMDD` tag on `main`, through the `production` environment.
   - Repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
     `VERCEL_STAGING_PROJECT_ID`, `VERCEL_PRODUCTION_PROJECT_ID`,
     `STAGING_SUPABASE_DB_PASSWORD`, `PRODUCTION_SUPABASE_DB_PASSWORD`,
     `ADMIN_ALERT_WEBHOOK_URL`.
   - Repository variables: `DRVN_STAGING_ORIGIN`, `DRVN_PRODUCTION_ORIGIN`,
     `DRVN_STAGING_SUPABASE_URL`, `DRVN_PRODUCTION_SUPABASE_URL`, and
     `DRVN_DEPLOY_STAGING = true` to switch the staging job on.
   - Environments (Settings → Environments): `staging`, and `production`
     with **required reviewers** (the owner), so a production deploy waits for
     a person's approval as well as the tag.
   - The pipeline never applies a migration. If staging or production lacks
     one, the deploy stops and names it; apply it with the runner (§2).

## 12. First admin [ENGINEER]

Sign up on staging with the operator's email and confirm it, then:

```sql
insert into public.admin_users (user_id, note)
values ('<auth.users id>', 'staging operator') on conflict do nothing;
```

Enrol TOTP at `/admin-verify`, then confirm that factor as the operator
(`docs/production-runbook.md` §5, steps 3–4: check the reference shown on
the page against `auth.mfa_factors`, then `select public.confirm_admin_mfa(…)`).
Until then the membership is pending and the console stays closed. Testers
sign up themselves; there are no invitations (the invite-only beta was removed
by #126).

## 13. Release-candidate evidence — the 15 gates [ENGINEER, OWNER reviews]

1. Write the candidate config **outside the checkout** (no secrets in it):
   ```json
   {
     "environmentId": "drvn-staging",
     "canonicalOrigin": "https://<staging-origin>",
     "supabaseProjectRef": "<ref>",
     "paymentMode": "stripe-test",
     "shippingMode": "easypost-test",
     "analyticsEnabled": false,
     "searchEnabled": false,
     "guestCheckout": "capped",
     "operator": "<responsible person>"
   }
   ```
2. From a **clean committed checkout** of the deployed commit:
   `node scripts/release-candidate.mjs build /path/config.json /path/outside/candidate.json`.
   It runs `npm run build` and binds source SHA, build digest, migrations
   digest, lockfile and runtime.
3. Produce one report per gate in `REQUIRED_GATES`, each with `gate`,
   `sourceSha`, `buildDigest`, `migrationsDigest`, `environmentId`,
   `passed: true`, `observedAt` (within the last seven days),
   `evidencePath` (a file beneath the reports JSON's directory) and that
   file's SHA-256 as `evidenceDigest`:

   | Gate | Evidence |
   |---|---|
   | `unit` | `npm test` output for the commit |
   | `typecheck` | `npx tsc --noEmit -p .` |
   | `lint` | `npm run lint` |
   | `sql` | CI `sql-guard` log: every guard's "all … checks passed" |
   | `schema-parity` | CI "Generated database contract matches migrations" step |
   | `build` | the build log from step 2 |
   | `browser-first-attempt` | Playwright run with zero retries; report must carry `counts.expected > 0`, `counts.flaky = 0`, `counts.unexpected = 0` |
   | `stripe-api` | CI `stripe-integration` job against the test key |
   | `hosted-provider` | a purchase, refund, dispute and payout on staging in Stripe test mode, plus a test label and tracker if EasyPost is on |
   | `guest-hold-caps` | on staging, as a guest: a third live hold from one device refused, a third from one network refused, a second live guest hold on one listing refused, and a hold released when its checkout ends (`20261107220800`; CI's `open_beta_guest_holds_guard.sql` passing for the commit) |
   | `privacy` | an export downloaded and checked, a deletion completed, private buckets refusing anonymous reads |
   | `accessibility` | the axe/e2e accessibility run against staging |
   | `operations` | worker health green, a monitor failure + recovery delivered (step 10), an alert delivered (step 9), and the sandbox overrides absent: save `vercel env ls production` and `vercel env ls preview` to one file and run `node scripts/release-candidate.mjs hosted-env <file>` (N540; the app also refuses to boot with `PAYMENTS_ALLOW_STUB_IN_PRODUCTION` on a hosted deployment) |
   | `restore-rollback` | a hosted restore of a recovery point into an isolated target and a previous-build rollback (runbook §6) |
   | `staging-soak` | the agreed soak period with workers green and no unexpected Sentry errors |

4. `node scripts/release-candidate.mjs verify /path/candidate.json /path/reports.json`.
   Missing, duplicated, stale, future or mismatched evidence blocks
   promotion. The script checks the package, not its contents — the owner
   (or a reviewer they name) still reads each evidence file.

## What only the owner can do — summary

Supabase plan/organisation (1.1), SMTP provider and sending domain (3.6),
Google OAuth client if used (3.4), hosting project and domain (4.1–4.2),
Stripe and Connect platform details (5), EasyPost account (6), Sentry
project (8), alert channel (9), GitHub Pro, repo secrets/variables and the
ruleset (10–11), the staging soak's duration, and sign-off on the evidence
(13.4).

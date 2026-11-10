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

## The order to do the steps in (#115)

The sections keep their numbers, because other documents cite them, but **the
first deploy comes last**. A hosted deployment refuses the payment stub
(N540), so staging runs in Stripe mode, and in that mode the app refuses to
start without the Stripe, Sentry and alert values. A deploy made before they
exist builds fine, then answers every request with an error.

1. §0, §1, §2, §3: domain, Supabase project, schema, Auth.
2. §2a: fill the vehicle catalogue (after the schema, before testers).
3. §4.1–4.2: create the hosting project **from the terminal, not by
   importing the repository** (the import deploys at once; §4.1 has the
   commands), and attach the domain. **Do not deploy**, and do not connect
   the repository to the project.
4. §5 (Stripe test mode and **both** webhooks), §6 (EasyPost, if used),
   §8 (Sentry), §9 (alert webhook). Stripe creates webhook endpoints for a URL
   that isn't live yet, and the signing secrets exist from that moment.
5. §4.3: set every variable in the table, including the values from step 4.
   Check them against "What the app refuses to boot without", below.
6. §11: GitHub environments, secrets and variables; then
   `DRVN_DEPLOY_STAGING = true`. The first deploy runs on the next green push
   to `main`.
7. **Come back once staging answers `/api/version` with the commit**, and do
   the "after the first deploy" half of §5.3 (a test event to each webhook),
   §8 (a test error reaches Sentry) and §9 (a test alert reaches the channel;
   it needs the §12 admin to see the outbox).
8. §7 (scheduler), §10 (monitor), §12 (first admin), §13 (evidence).

### What the app refuses to boot without

Checked at server start (`src/instrumentation.ts`), in stages. Each stage
stops the boot with its own message in the host's function logs, so fix what
it names, redeploy, and read the next one:

1. `DRVN_DEPLOY_ENV` (a plain `Error`: "DRVN_DEPLOY_ENV …"). The build checks
   it too.
2. The payment mode (`PaymentsConfigError`): `PAYMENTS_MODE` must be `stripe`
   or `stub` when set, Stripe mode needs `STRIPE_SECRET_KEY`, and
   `PAYMENTS_ALLOW_STUB_IN_PRODUCTION` must be absent on a hosted deployment.
3. The database keys, on any hosted production deployment
   (`PaymentsConfigError`: "missing its database configuration: …").
4. Live-money configuration (`PaymentsConfigError`): first every **missing**
   variable together ("missing required configuration: …"), then every
   **invalid** one together ("configuration is invalid: …").
5. The agent, only if `AGENTS_BETA=on`.

On staging (production build, Stripe mode) that means:

| Variable | Rule |
|---|---|
| `PAYMENTS_MODE` | `stripe` (if set, `stripe` or `stub`; nothing else) |
| `STRIPE_SECRET_KEY` | set (`sk_test_…` on staging) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `…_ANON_KEY`), `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | all set |
| `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` | both set (§5.1, §5.2) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | set |
| `SENTRY_DSN` | an `https://<key>@<host>/<number>` DSN (§8) |
| `ADMIN_ALERT_WEBHOOK_URL` | an `https:` URL (§9) |
| `NEXT_PUBLIC_SITE_URL` | an `https:` origin with no path, query or credentials |
| `CRON_SECRET`, `GUEST_RECEIPT_SECRET` | each at least 32 characters, and different from each other |
| `ACCOUNT_EMAIL_DIGEST_KEY` | at least 32 characters, if set |
| `DRVN_DEPLOY_ENV` | `staging` or `production` |
| `PAYMENTS_ALLOW_STUB_IN_PRODUCTION` | **absent** |
| `AGENT_MODEL`, `AGENT_WORKER_DATABASE_URL` | valid, if `AGENTS_BETA=on` |

If the deploy workflow's "Staging reports this commit" step prints
`HTTP 500` on every poll, the app is refusing to boot: open the host's
function logs and look for `PaymentsConfigError`. The step prints each new
answer it gets (status and the start of the body) and gives up after fifteen
minutes.

**`NEXT_PUBLIC_*` values are fixed when the deploy workflow builds** (on the
GitHub runner, from `vercel pull`), not when the host serves. After changing
one in the host's settings, re-run the Deploy workflow for that commit
(Actions → Deploy → Re-run). Redeploying from the host's dashboard reuses the
old build, and it skips the release gate.

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

## 2a. Fill the vehicle catalogue [ENGINEER]

A new project's catalogue is empty. `0041_vehicle_catalog.sql` seeds makes
and models from cache tables that are empty on a new project, and
`20261020100000_vehicle_generations.sql` joins its curated generations to that
catalogue, so it inserts nothing. Until this step runs, the Add Car dialog,
the sell form's fitment fields and the Marketplace's make filters have
nothing to offer (#119).

From the same staging-only checkout as step 2, after the schema and before
any tester signs up:

```bash
node scripts/import-vehiclesdb.mjs --target staging            # dry run: fetches, verifies, counts
node scripts/import-vehiclesdb.mjs --target staging --apply --confirm <code from the dry run>   # imports, then re-runs the generations seed
```

The script reads the env file the way the migration runner does
(`--env-file`, default `.env.local`). It fetches VehiclesDB's car catalogue
**at the pinned release** (`scripts/lib/vehicle-catalog.mjs`: a commit, and a
sha256 per file; other bytes are refused). It upserts makes and models, then
runs the generations migration's own curated seed and backfill again, all in
one transaction. Expect about 300 makes, about 5,500 models and a non-zero
generation count. Re-running the same release is idempotent. A VehiclesDB
upgrade (a PR that changes the pin) is safe to try, but a release that
renames a make or model to a name another row already has fails on the
`lower(name)` or `vdb_id` unique index, and the whole run rolls back. Read the
error, fix the clash in a reviewed PR, then run again. Attribution ("Vehicle
data by VehiclesDB") is already in the Add Car dialog. **Licence:** CC BY 4.0,
read on 9 Nov 2026 from `LICENSE` at the pinned commit `d0e40c9`, which covers
`catalog/**`. GitHub's own licence detector reports none, because the file's
wording isn't one it matches.

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

1. Create the Vercel project **without a deploy** [OWNER — needs the paid
   tier the owner chooses]. **Do not use the dashboard's "Add New… →
   Project → Import Git Repository"**: it builds and deploys the repository
   the moment you finish the form, before a single variable exists, and
   that deployment is public. Create an empty project from a terminal
   instead, with no Git connection at all:

   ```bash
   npx vercel@65.2.0 login                              # once, as the owner
   npx vercel@65.2.0 project create drvn-staging --scope <team-slug>
   npx vercel@65.2.0 project update drvn-staging --scope <team-slug> \
     --framework nextjs --node-version 22.x --build-command "npm run build" --install-command "npm ci"
   npx vercel@65.2.0 project inspect drvn-staging --scope <team-slug>   # shows the project id (prj_…)
   ```

   `project create` makes the project and nothing else: no build, no
   deployment, no repository. Leave it that way. **Do not connect the GitHub
   repository** under the project's Settings → Git: with no connection the
   host cannot deploy on a push, so there is no automatic deploy to turn
   off. `.github/workflows/deploy.yml` builds on its own runner and uploads
   the result, only after `release-gate` passes (§11.4); it needs the
   project's id and the team's id, not a Git link. Note the two ids for
   §11.4: the project id from `project inspect` (or Settings → General →
   Project ID) is `VERCEL_STAGING_PROJECT_ID`; the team id (Team Settings →
   General → Team ID) is `VERCEL_ORG_ID`. The same four settings can be made
   in the dashboard instead (Settings → Build and Deployment: framework
   Next.js, Node 22.x, build `npm run build`, install `npm ci`); CI builds
   on Node 22.22.0. The subcommands and flags above were confirmed in
   `vercel@65.2.0`'s own `--help` on 10 November 2026 and have not been run
   against an account: the first time through, read what each prints.
2. Attach the staging domain; confirm HTTPS.
3. Set the environment variables below for the deployment environment that
   serves the staging domain.

| Variable | Value / where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | step 1.3 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | step 1.3 |
| `SUPABASE_SECRET_KEY` | step 1.3 — server only |
| `NEXT_PUBLIC_SITE_URL` | the staging origin, `https://…`, no path |
| `DRVN_DEPLOY_ENV` | `staging` (the production project gets `production`). Required: a hosted deploy without it refuses to boot. Anything but `production` answers robots.txt with `Disallow: /` and sends `X-Robots-Tag: noindex`, so staging stays out of search engines, and error reports carry it as their environment (`src/lib/deployment.ts`). **Fixed at build, like `NEXT_PUBLIC_*`:** the deploy workflow's build reads it through `vercel pull`, so set it before the first deploy, don't mark it Sensitive (a Sensitive value isn't pulled), and re-run the Deploy workflow after changing it. A hosted production-mode build without it, or with a misspelt value, fails. **Checked after every deploy:** once the site reports its commit, the Deploy workflow asks the served site itself and fails the deploy unless staging disallows every crawler in `/robots.txt`, sends `X-Robots-Tag: noindex` and answers 404 for `/sitemap.xml` and the catalogue sitemaps (production must be the reverse). So a staging project set to `production` by mistake fails its first deploy, loudly, with the reasons |
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
on a hosted deployment (N540). **Don't deploy yet.** The Stripe, Sentry and
alert rows above need §5, §8 and §9 first ("The order to do the steps in",
above). The first deploy is §11.4's, and it must start without a
`PaymentsConfigError` in the logs. A boot failure lists every missing or
invalid variable at once.

## 5. Stripe, test mode [OWNER account, ENGINEER configures]

**Do this in a Stripe sandbox of staging's own** (in the Stripe dashboard:
the account picker → Sandboxes → create one named for staging, for example
"DRVN staging"), and use that sandbox's keys for everything in this section
and in §4.3. Not the account's shared test mode, which local development
uses, and not the sandbox kept for CI. The rule is one Stripe sandbox per
deployment, because Stripe delivers every test event in a sandbox to every
webhook endpoint registered in it: on 10 November 2026 each CI run was
sending its 53 test events to the local site, which stored each one and
opened a recovery case for every payment it had no order for (1,618 false
cases in a day). Staging on a shared sandbox would receive the same.
Production is live mode, which only production uses.

`scripts/owner/stripe-webhooks.mjs` creates or updates both endpoints below
(dry run by default; usage in `docs/owner/README.md`). By hand:

1. Developers → Webhooks → add endpoint, **events on your account**:
   `https://<staging-origin>/api/stripe/webhook`, events exactly:
   `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.requires_action`, `charge.refunded`, `refund.created`,
   `refund.updated`, `refund.failed`, `charge.dispute.created`,
   `charge.dispute.closed`, `account.updated`. Copy the signing secret into
   `STRIPE_WEBHOOK_SECRET` (§4.3). Before the first deploy that is all; if
   staging is already deployed, re-run the Deploy workflow after changing it.
2. Connect → enable Connect in test mode, **Express** accounts, platform
   profile and branding filled in [OWNER: platform business details]. Sellers
   onboard from `/payouts`; they return to `/settings/payouts/return`, which
   syncs `payouts_enabled`.
   Then add a **second** webhook endpoint, "events on connected accounts",
   at the same URL `https://<staging-origin>/api/stripe/webhook`, with the
   single event `account.updated`. Copy its signing secret into
   `STRIPE_CONNECT_WEBHOOK_SECRET` (§4.3), as for the first. This is how a
   seller's payout status reaches DRVN after onboarding.
3. **After the first deploy** (step 7 of the order above): send a test event
   to each endpoint from the dashboard and confirm a `200` in its log.

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

The migrations already created the pg_cron jobs (twenty-one, listed in runbook §4); the HTTP ones do
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
commit SHA). **After the first deploy** (step 7 of the order): trigger a
test error and confirm it arrives, tagged `staging`.

## 9. Operator alerts [OWNER]

Create a Slack incoming webhook (or any HTTPS endpoint accepting a JSON body
with a Slack-compatible `text`) in a channel the operator watches. Put it in
`ADMIN_ALERT_WEBHOOK_URL`. **After the first deploy and the §12 admin**
(step 7 of the order): confirm a delivery. Admin → Payments shows the alert
outbox; a `disabled` row means the variable was not set when the alert was
raised.

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
2. Add the repository secret `STRIPE_TEST_SECRET_KEY` = the test secret key
   of the Stripe sandbox kept for CI (its own sandbox, not staging's and not
   the one local development uses: §5 says why). Without it the
   `stripe-integration` job fails on purpose and `release-gate` can never
   pass. The variable `STRIPE_TEST_PUBLISHABLE_KEY` is the same sandbox's
   publishable key.
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
   - Repository secret: `ADMIN_ALERT_WEBHOOK_URL` (both jobs post to it).
   - **Environment secrets, not repository secrets (#123):** put each of the
     following on the environment that uses it (Settings → Environments →
     the environment → Add secret). A repository secret can be read by any
     workflow on any branch. An environment secret reaches only a job that
     names that environment, and production's waits for its required
     reviewer. The workflow reads them under the same names, so nothing else
     changes.
     - `staging`: `STAGING_SUPABASE_READER_PASSWORD`, `VERCEL_TOKEN`,
       `VERCEL_ORG_ID`, `VERCEL_STAGING_PROJECT_ID`.
     - `production`: `PRODUCTION_SUPABASE_READER_PASSWORD`, `VERCEL_TOKEN`,
       `VERCEL_ORG_ID`, `VERCEL_PRODUCTION_PROJECT_ID`.

     The two database secrets are the password of `deploy_reader`, a
     read-only login made as below. The workflow holds no database owner's
     password (work review #138).
   - Repository variables: `DRVN_STAGING_ORIGIN`, `DRVN_PRODUCTION_ORIGIN`,
     `DRVN_STAGING_SUPABASE_URL`, `DRVN_PRODUCTION_SUPABASE_URL`, and
     `DRVN_DEPLOY_STAGING = true` to switch the staging job on.
   - Environments (Settings → Environments): `staging`, and `production`
     with **required reviewers** (the owner), so a production deploy waits for
     a person's approval as well as the tag. **Create both before the first
     run** (work review #139): a job that names an environment which does not
     exist makes GitHub create it, empty and unprotected, and run.
   - **Restrict what may deploy to each** (work review #156): in each
     environment, "Deployment branches and tags" → "Selected branches and
     tags". `staging`: add the branch `main` and nothing else. `production`:
     add the branch `main` (a production deploy is started by hand from
     `main`, with the release tag typed in) and the tag pattern `rc-*`. With
     the default, "No restriction", a workflow run from any branch can name
     the environment and read its secrets; with this, a run from another
     branch stops before it starts.
   - The pipeline never applies a migration. If staging or production lacks
     one, the deploy stops and names it; apply it with the runner (§2).
   - **The read-only login `deploy_reader`.** The deploy's migration check
     reads one table, `supabase_migrations.schema_migrations`, so it signs in
     with a login that can do nothing else. Make it once on each database
     (staging, then production when it exists), as the owner, in the
     dashboard's SQL editor, with a new password of 32 or more characters
     for each database:

     ```sql
     create role deploy_reader login password '<new password>' connection limit 3;
     alter role deploy_reader set default_transaction_read_only = on;
     alter role deploy_reader set statement_timeout = '10s';
     grant usage on schema supabase_migrations to deploy_reader;
     grant select on supabase_migrations.schema_migrations to deploy_reader;
     ```

     Put each password in its secret above and nowhere else. To rotate one,
     run `alter role deploy_reader password '<new password>';` and update the
     secret. Grant it nothing else, and never make it a member of another
     role (a member inherits that role's rights). The runner checks the
     login on every use and refuses it if it is a superuser, can create
     roles, bypasses row-level security, is a member of any role, is not
     read-only by default, or can write the history table, so a wrong
     password pasted here cannot quietly be an owner's. What keeps it from
     writing is what it holds, not the read-only default, which a session
     can switch off. These five statements were run on a new Supabase
     Postgres 17 on 10 November 2026 and are enough for `--status`. To try it by hand,
     put `SUPABASE_DB_READER_USER=deploy_reader` and
     `SUPABASE_DB_READER_PASSWORD=…` in an env file beside
     `NEXT_PUBLIC_SUPABASE_URL` and run
     `node scripts/apply-migration.mjs --target staging --env-file <file> --status`.

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

**Staging proofs that need two server instances (before the gates).** One
signed link per photo across instances (#117, N954): with staging serving
from at least two instances, open one public car page twice in different
browsers. Every photo's `/object/sign/…?token=` must be the same in both,
and `select count(*) from private.photo_signatures` must grow once per
photo per hour, not once per instance.

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

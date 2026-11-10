# Infrastructure evidence

The dated record that each piece of production and staging infrastructure was set up (remediation plan C8, N224). The release packet's `operations` gate reads it (`docs/staging-setup.md` §13). One row per setting in `docs/production-runbook.md` §1 and per variable in §4. Fill a row as each owner step in workstream D lands: the date (YYYY-MM-DD), who did it, and where the proof is (a screenshot or output file under `docs/release-evidence/`, or a CI run link). Never paste a secret's value here: a variable's row records that it is set and where, not what it is.

**Done when** every row that applies to an environment has a date for that environment, and rows that do not apply say `n/a` with the reason (an optional provider left off, for example).

## Accounts and projects (D1, D4, D5, E1, D-mail)

| Item | Staging: date, who | Production: date, who | Evidence |
|---|---|---|---|
| Hosting account with 2FA, engineer added (D1) | | | |
| Domain registered or confirmed; DNS for `staging.<domain>` and the apex (D1) | | | |
| Hosting project per environment, automatic deploys off until `deploy.yml` (D1, D2) | | | |
| GitHub `staging` and `production` environments; `production` has required reviewers (D2) | | | |
| Deploy secrets and variables set (`.github/workflows/deploy.yml` header) (D2) | | | |
| Supabase project (`drvn-staging` exists; production per runbook §1) (D4) | 2026-11-07, Neil (`zubstjuviwourzgrziqc`) | | `docs/staging-setup.md` |
| Point-in-time recovery (D4; recommended on for production) | n/a: daily backups on staging | | |
| Production added to `supabase/migration-targets.json` by a PR (B4) | n/a | | |
| Deploy runner reaches the database for `--status`: session pooler pinned with `statusRoute` in `supabase/migration-targets.json`, or the IPv4 add-on bought (#114, `docs/staging-setup.md` §1.4) | 2026-11-09, engineer: pooler `aws-0-us-east-1.pooler.supabase.com` pinned; certificate chain and tenant checked by a TLS handshake, no login | | first green `Staging has every migration` step in `deploy.yml` |
| Vehicle catalogue filled and generations seeded (`scripts/import-vehiclesdb.mjs --apply`, runbook §3a, #119) | | | the script's closing counts |
| Email provider, sending domain verified (DKIM, return-path, DMARC) (D-mail) | | | |
| Stripe Connect (Express), platform profile, restricted keys (E1) | | | |
| Stripe webhooks (`scripts/owner/stripe-webhooks.mjs`), platform and Connect (E1) | | | |
| Apple Pay and Google Pay domains (E1, E3) | | | |
| Radar 3-D Secure rule; negative-balances script run (E2) | | | |
| Sentry project with 2FA (D5) | | | |
| Alert webhook (Slack or equivalent) (D5) | | | |
| Uptime check on `/api/version`, paging the owner (D5) | | | |
| Worker monitor variables `DRVN_MONITOR_ENABLED`, `DRVN_MONITOR_ORIGIN`, secret `DRVN_MONITOR_SECRET` (D5) | | | |
| First admin enrolled with MFA and confirmed (runbook §5, N666) | | | |

## Runbook §1: Supabase Auth settings (C6, D7)

| Setting | Staging: date, who | Production: date, who | Evidence |
|---|---|---|---|
| Email confirmation on; site URL and redirect allowlist set | | | |
| Secure password change on | | | |
| Require the current password to change it (Management API, both fields true) | | | |
| Secure email change on | | | |
| Minimum password length 8 | | | |
| Rate limits: sign-ups and sign-ins above expected peak; token verifications in step; emails per hour matched to the SMTP provider | | | |
| Bot protection decision recorded (default: off at launch) | | | |
| SMTP configured in Auth, four templates pasted | | | |

## Runbook §4: environment variables

Set in the host's environment for each project (never in the repository). `job_config` rows are in the database, not the host.

| Variable | Runbook says | Staging: date, who | Production: date, who | Evidence | Notes |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | required | | | | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | required | | | | |
| `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) | required | | | | |
| `PAYMENTS_MODE` | recommended `stripe` | | | | |
| `STRIPE_SECRET_KEY` | required | | | | |
| `STRIPE_WEBHOOK_SECRET` | required (live) | | | | |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | required (live) | | | | |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | required (live) | | | | |
| `SENTRY_DSN` | required (live) | | | | |
| `ADMIN_ALERT_WEBHOOK_URL` | required (live), `https:` | | | | |
| `NEXT_PUBLIC_SITE_URL` | required (live), `https:` | | | | |
| `CRON_SECRET` | required (live), ≥ 32 chars | | | | |
| `GUEST_RECEIPT_SECRET` | required (live), ≥ 32 chars | | | | |
| `ACCOUNT_EMAIL_DIGEST_KEY` | optional (recommended before launch), ≥ 32 chars | | | | |
| `TRUST_PROXY_HEADERS` | unset on Vercel; `true` only behind another verified proxy; `false` to disable | | | | |
| `FLAG_INTEGRATED_SHIPPING_V1`, `EASYPOST_API_KEY`, `EASYPOST_WEBHOOK_SECRET` | optional | | | | |
| `ANTHROPIC_API_KEY` | optional; needed for the agent and the importer to call the model | | | | |
| `LISTING_IMPORT_MODEL`, `LISTING_IMPORT_AI_MODE` | optional | | | | |
| `LISTING_IMPORT_ALLOW_PRIVATE_HOSTS`, `LISTING_IMPORT_PUBLIC_BROWSER_ENABLED` | never in production | | | | |
| `AGENT_MODEL` | optional (default `claude-opus-5-5`) | | | | |
| `AGENT_AI_MODE` | optional | | | | |
| `AGENT_MAX_ITERATIONS` | optional (default 8) | | | | |
| `AGENTS_BETA` | required (`on`) for the agent to show to members | | | | |
| `AGENT_WORKER_DATABASE_URL` | required for the agent to act | | | | |
| `E2E_TEST_PROJECT_REF` | never in production | | | | |
| `DRVN_PUBLIC_CACHE` | optional | | | | |
| `DRVN_SITE_ORIGIN` | optional (operator shell) | | | | |
| `DRVN_MONITOR_ALERT_URL`, `DRVN_MONITOR_HEARTBEAT_URL`, `DRVN_MONITOR_STATE_FILE`, `DRVN_MONITOR_INTERVAL_MS` | monitor host only | | | | |
| `TYPESENSE_URL`, `TYPESENSE_API_KEY` | optional | | | | |
| `POSTHOG_KEY`, `POSTHOG_HOST` | optional | | | | |
| `SENTRY_RELEASE` | optional | | | | |
| `NEXT_BUILD_ID`, `DRVN_NEXT_DIST_DIR` | optional | | | | |

## Runbook §4: database configuration (`job_config`) and jobs

| Item | Staging: date, who | Production: date, who | Evidence |
|---|---|---|---|
| `job_config.media_storage_origin` = the project's `https://<ref>.supabase.co` | 2026-11-07 (`https://zubstjuviwourzgrziqc.supabase.co`) | | `docs/staging-setup.md` |
| `job_config.transfer_worker_url` and `transfer_worker_secret` | | | |
| `select count(*) from cron.job where jobname like 'drvn-%'` returns 21 | | | |
| Vehicle catalogue imported; row count matches staging (D4) | | | |
| No seeded members on production (D4) | n/a | | |
| `PAYMENTS_ALLOW_STUB_IN_PRODUCTION` and `SHIPPING_ALLOW_STUB_IN_PRODUCTION` absent: `node scripts/release-candidate.mjs hosted-env` passes (N540) | | | |

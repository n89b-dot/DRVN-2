# Remediation rollout and recovery

This change is implemented in the working tree. Its migrations reached the shared dev Supabase project (`grunnjojhdevhuckujmc`) on 2026-09-24 — backed up and reconciled, recorded in `supabase/MIGRATIONS.md` — and admin MFA is in force there. On that project the Site URL/redirects, SMTP, the `job_config` worker URL and CRON_SECRET, and the worker-health monitor below are still to do. Its pg_net can't reach a dev server on localhost, so for local development the scheduled jobs run from `scripts/dev-jobs.sh` and Stripe test events arrive through `scripts/dev-stripe-listen.sh`, both under launchd (production runbook §12). Nothing has been deployed to production, published, or verified against live money. Use the implementation status report alongside this runbook; passing local tests is not a production sign-off.

## Isolated verification environment

The local Supabase project `DRVN_2` uses API `http://127.0.0.1:54321`, PostgreSQL port 54322 and captured email at `http://127.0.0.1:54324`. Colima supplies Docker. It contains disposable fixtures only. Email stays in Mailpit. No hosted test project or paid SMTP service was created.

Start the existing environment:

```sh
colima start
npx --yes supabase@2.116.0 start -x logflare,vector,studio,realtime,edge-runtime,imgproxy
```

The ignored, permission-restricted `.env.test.local` selects this database and stub payments. `.env.stripe-test.local` selects the same database and a Stripe **test** key. Never copy a live key into either file. The browser suite explicitly enables the deterministic importer stub; local URL fixtures remain unavailable in a production build because SSRF restrictions stay enforced. The browser suite refuses implicit `.env.local` fallback, missing isolation identity, or live payments. Test fixtures must only be run on a disposable project.

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run test:e2e
npm run test:stripe
npm run db:types:check
npm run storybook:build
npm audit
```

The SQL guard runner requires PostgreSQL client binaries on PATH and explicit connection variables. Against this local stack, set PGHOST=127.0.0.1, PGPORT=54322, PGUSER=postgres and PGDATABASE=postgres; supply the local password through PGPASSWORD or a protected pgpass file. Run `bash scripts/test-sql-guards.sh`. Never run the fixture suite on a shared database.

## Deploy ordering

1. Back up the destination database and Storage. Record the deployed application revision, migration history, backup reference and restore location. Rehearse restoration in a separate project before live rollout.
2. Reconcile the actual applied migrations against `supabase/MIGRATIONS.md`. **Do not replay 0001 or blindly run db push on the existing project.** The new migration is `20260905011618_remediation_integrity.sql`; older files were not rewritten.
3. Inspect existing duplicate payment rows before adding the new one-payment-per-order index: `select order_id, count(*) from public.payments group by order_id having count(*) > 1`. If rows exist, reconcile their financial meaning before migration; do not delete ledger rows to force the index to build.
4. Enable Auth TOTP enrollment and verification. Configure the canonical HTTPS Site URL and redirect allowlist. Configure production SMTP and the magic-link template described below. Prepare an administrator's verified authenticator and documented recovery contact before enforcing MFA.
5. Pause checkout and money workers during the coordinated schema/application change. Apply only the reviewed new migration using the existing migration procedure. Deploy the matching application immediately: old public photo upload clients will be rejected by the new restrictive storage policies.
6. Configure and verify the settings below. Resume workers and run staging smoke tests for purchase, compensation, receipts, MFA, derivative uploads and deletion. Check financial balances and queues before enabling live checkout.
7. A rollback must preserve captured-payment/refund obligations. Pause checkout, retain the schema and queues, and use a compatible application or forward fix. Do not drop remediation tables or undo financial effects with a blanket down migration.

## Required settings

Stripe production startup validates PAYMENTS_MODE, Stripe secret/publishable/webhook keys, an HTTPS SENTRY_DSN, HTTPS NEXT_PUBLIC_SITE_URL, HTTPS ADMIN_ALERT_WEBHOOK_URL, CRON_SECRET and GUEST_RECEIPT_SECRET. Both application secrets must have at least 32 characters and be generated independently. Store them in the deployment secret store. Remove all E2E settings and the production stub override from public deployments.

Set TRUST_PROXY_HEADERS=true only after verifying that the ingress removes client-supplied X-Forwarded-For and supplies a trusted address. Otherwise anonymous requests intentionally share a conservative abuse bucket. Rotating GUEST_RECEIPT_SECRET invalidates outstanding guest receipts and changes hashed network identities; existing members can use normal sign-in/email access.

HTML pages now use fresh script nonces and dynamic rendering. Do not cache nonce-bearing HTML in a shared CDN; static assets remain cacheable. Inline styles remain allowed for the existing UI. Verify Stripe Payment Element/3DS under this policy in staging.

The browser importer is deliberately unavailable in production. Public uploads go through `/api/media/public-photo`, which decodes and writes a normalized WebP derivative. Existing previously uploaded originals require a separate inventory/backfill before claiming historical EXIF removal.

## Email and MFA

Use `supabase/templates/magic-link.html` as the template starting point. The production template must link to the canonical origin's `/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=%2Forders`, never a browser-controlled host. Configure SMTP and test a delivered message in a fresh browser. Local Mailpit success does not establish external deliverability. Expired or consumed links require a new link.

Admin pages and commands require current membership, AAL2 and a TOTP verification within 15 minutes. `/admin-verify` supports enrollment and challenge; when the 15-minute check lapses, the admin is sent there with the console page they were on and returned to it. For lost authenticators: verify the person's identity through the organization's established recovery process, have a separate authorized operator remove the lost factor in Supabase Auth administration, revoke sessions, record the recovery outside the affected account, and require new enrollment. Never add a public bypass or lower the RLS assurance requirement to recover an account. Test this procedure with a disposable administrator before rollout.

## Scheduling and incident response

The existing job_config transfer worker URL must be the canonical HTTPS `/api/jobs/transfers` URL with the same CRON_SECRET used by the application. New cron invocations derive search, account-deletion, media-GC and saved-search URLs from it. Verify actual cron run history and HTTP responses; a cron row alone is insufficient.

The money endpoint runs reservation expiries, capture reconciliation, transfers, transfer reconciliation, refunds, label voids, returns, disputes, alerts, purchase analytics and receipts (`runMoneyWorkerPass`), recording worker_runs. The console's "Run worker now" runs the same pass. Search and account deletion have separate endpoints. Admin → Settings → Background jobs shows each family's last success and failure. Failed queue items retry with backoff and stop after ten attempts. Investigate last_error and the underlying provider outcome before resetting a failed item to pending. Never change an idempotency key to bypass a failure.

Configure an independent monitor to call `/api/health/workers` with the bearer CRON_SECRET. A 503 reports stale money-worker success (30 minutes) or failed remediation jobs. Pause a staging worker, observe an actual external alert, restart it, and verify backlog drain. This monitor has not been provisioned by this change.

For ambiguous captures, compare payment_requests, Stripe PaymentIntent metadata, payments, refund_operations and transfer_intents. Reconciliation replays known captured references; unknown/mismatched references require investigation. For an admin result saying an operation ran but its completion record failed, reconcile the displayed operation ID and provider operation before retrying.

Deletion responses mean **queued**, not completed. Failed storage/auth cleanup remains a retryable job. Retained order/evidence references can require supervised retention review. Keep the request ID when assisting the user. Export returns an error if a section cannot be read completely rather than returning a silently incomplete archive.

## Provider-aware expiry follow-up

Apply `20260905101425_provider_aware_expiry.sql` before the compatible worker build. The existing expiry cron now enqueues `reservation_expiry` work instead of releasing inventory. The money worker's new `expiries` family checks Stripe, settles captures, and releases only confirmed cancellations or orders with no persisted provider creation. During the schema/app transition, reservations can remain held longer; do not restore the old SQL sweep to clear them.

A persisted request with no provider reference is unresolved. Its stock remains held and its job retries, eventually appearing as failed work after the existing retry limit. Reconcile that request against the provider before retrying or releasing anything. Automated reference-less recovery and further reconciliation fairness are still phase-two B04 work.

## Phase-two additions

Apply all additive phase-two migrations through the normal upgrade procedure, then deploy compatible application code. New claim/checkpoint/recovery RPCs are required by these workers; do not deploy the code ahead of the schema. Reference-less recovery, fair capture scanning, durable deletion checkpoints and scanner-safe email redemption now have implementation and local evidence. Follow [the updated operations runbook](remediation-operations.md) and [release gates](remediation-release-gates.md), which supersede the earlier pending-work notes in this document.

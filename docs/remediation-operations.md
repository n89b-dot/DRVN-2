# Phase-two operations and verification

## Isolated environments

Local verification uses Supabase/Auth/Storage/Mailpit on loopback ports 54321–54324 and synthetic users. GitHub Actions starts its own disposable stack and uses the existing Stripe **test** key from `STRIPE_TEST_SECRET_KEY`. No production database, live payment key, hosted SMTP configuration or live deployment is selected by fallback.

Run `npm run test:operations` only with `E2E_TEST_PROJECT_REF=local-drvn-remediation` and the loopback API. The search drill also requires the local `typesense/typesense:30.2` container on port 8108 with the documented disposable test key. CI provisions it automatically. The suite covers 1,100-listing pagination, actual Typesense outage/privacy removal, metadata normalization and nested deletion continuation. Run-owned immutable audit/financial fixtures retain a banned, non-admin identity so cleanup does not weaken append-only protections.

## Capture and admin recovery

The captures worker claims reference-less requests, looks up their persisted provider correlation and maps only one exact buyer/basket/amount/currency match. Lookup absence is never authority to create another charge. Conflicts and unresolvable captures deduplicate into `payment_recoveries` using `request:<operation key>` or `capture:<PaymentIntent ID>`. Database failure before recording a recovery remains retryable.

Reconciliation uses a persisted next-attempt schedule, so poison references cannot occupy every batch. Provider calls have three-second timeouts and bounded concurrency. Settlement checks the original seller obligation, currency, seller and charge source; refunds are accounted for by the payout worker. Existing obligations with mismatched amounts or sources require recovery.

External administrator operations journal an operation ID before the provider call. A requested operation with no completed/reconciled phase blocks another call for the same action and subject. Inspect the provider and the existing durable refund/transfer operation, reconcile the local ledger, and append an attributable audit row with the **same** operation ID and phase `reconciled`. Do not clear the fence merely because a request timed out. The fence is conservative: it does not guess whether an external call succeeded.

## Shipping label recovery

Outbound purchase intent lives in `outbound_label_requests`; outbound void
intent lives in `outbound_label_void_requests`. The supported seller retry is
the order sheet's **Void label** action, which calls `voidShippingLabel` and
reconciles the frozen provider Shipment before another refund request. Pending
or unrecognised carrier states surface as a pending/needs-reconciliation
message and retain the `outbound-label-void:<shipment uuid>` alert. A carrier
rejection surfaces as refused and does not cancel the shipment or create a
refund adjustment. Only an exact `refunded` observation can atomically cancel
the shipment and append the opposing adjustment; local write failure rolls
both effects back.

The `labelVoids` family in `/api/jobs/transfers` scans at most five due rows per
pass. It waits six hours between reads of carrier-submitted refunds and uses a
shorter delay for unknown outcomes or a crash before the first call. Each read
is bound to the database claim attempt and database observation-start time, so
a late result cannot settle or authorize a newer attempt. For an aged pending
row, inspect the exact provider shipment reference, amount, currency, original
`outbound_label` adjustment and EasyPost `refund_status`. Resume through the
same seller action where possible. Do not create a manual seller credit or
submit a provider refund against a different shipment. Carrier-specific live
refund acceptance and settlement timing remain an operational launch check.

For lost TOTP, a separately authorized operator must first verify identity and record that evidence reference. Call service-only `begin_admin_mfa_recovery(actor, target, reason)` before removing the lost factor through Supabase Auth administration. This invalidates previously issued administrator JWTs at both the application and RLS boundaries. Require a new sign-in and fresh authenticator enrollment; removing the confirmed factor leaves the membership pending, so the operator confirms the new factor with the person out of band (`confirm_admin_mfa`, `docs/production-runbook.md` §5) before the console reopens. Append completion to the audit using the returned operation ID. The automated drill proves this mechanism with synthetic identities; it does not replace the organization's human identity-verification procedure.

## Search rebuilds

Set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and a matching `DRVN_SEARCH_PROJECT_URL` explicitly, then run `node scripts/reindex-search.mjs` or `node scripts/reindex-explore.mjs`. These commands start/resume durable rebuilds. They do not read `.env.local`, delete collections or load the entire catalog in memory. The search worker creates missing collections, advances a 500-ID checkpoint and serializes queued work per document identity.

A completed rebuild row means enumeration finished; queued delivery and health must also be checked. Canonical database search remains available during engine outages. For historical orphan documents, set matching `DRVN_SEARCH_ENGINE_URL=TYPESENSE_URL`, run `node scripts/reconcile-search.mjs inventory /secure/new-directory`, then repeat `apply` on that directory. The ID-only snapshot remains stable while workers delete documents; each invocation checkpoints at most 100 canonical checks. Wait for delivery and verify a fresh inventory before enabling the engine on a populated deployment. No collection schema changed in this batch; a future schema change requires a separately verified generation/cutover. Search collection creation behavior follows the [Typesense API contract](https://github.com/typesense/typesense-api-spec/blob/master/openapi.yml).

## Historical images

Use explicit `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and matching `DRVN_MEDIA_PROJECT_URL`.

1. `node scripts/public-media-backfill.mjs inventory /secure/path/manifest.json` performs a read-only inventory.
2. Review the target and inventory. `node scripts/public-media-backfill.mjs apply /secure/path/manifest.json` processes at most 25 objects per run, checkpoints after each object and returns failure when any object needs retry.
3. Review remapped, retained-for-review and failed entries. Derivatives are decoded, oriented, resized and re-encoded without EXIF/ICC/XMP. References update transactionally only after upload.
4. Originals remain retained. Approve the retention/reference review and storage/CDN invalidation procedure before removing them. A successful remap does not erase historical exposure or external copies.

## Independent monitoring

`node scripts/check-worker-health.mjs` requires `DRVN_MONITOR_ORIGIN` and `DRVN_MONITOR_SECRET`. It uses HTTPS remotely, rejects redirects and fails on HTTP errors, incomplete/stale families or failed queues without printing response payloads or secrets. Inside the product, Admin → Settings → Background jobs reads the same `worker_health_snapshot()` and marks each family running, retrying, overdue or never ran; it is a view for operators, not an alert.

The independent GitHub workflow is deliberately inactive until repository variable `DRVN_MONITOR_ENABLED=true`, the canonical monitor origin and its separate secret are configured. Before enabling it, identify the operator and notification destination, verify an actual failed notification and recovery, and account for GitHub schedule delays. A configured workflow file is not evidence that an alert was delivered.

## Local restore drill

A database-only backup is insufficient: archive object bytes separately. The local schema-scoped dump includes public/Auth/Storage schemas and excludes `public.job_config` data. Required extension prerequisites are restored explicitly.

`local-restore-drill.sh` refuses targets other than the dedicated container on loopback port 55441 and requires `DRVN_RESTORE_DISPOSABLE=local-container-55441` plus a restricted local `DRVN_RESTORE_DUMP`. It recreates only that disposable target, restores schema/data/constraints and disables worker endpoint configuration. Run SQL guards there afterward, restore the object archive into a new volume and compare bytes.

After any database restore, storage and Stripe need their own reconciliation, because neither is rolled back with the database (N232; `docs/production-runbook.md` §6a and §6b). Storage: restore object versions as of the recovery point, run `scripts/owner/storage-reference-check.mjs --verify-bytes` (read-only; references with no object, objects nothing names, rows whose bytes are gone by a ranged GET; chat photos past retention and tombstoned deletions are listed apart and never restored), and reapply deletions made since the recovery point. Stripe: keep every money job off, replay Stripe's events since the recovery point, run the ledger reconciliation with `?since=` set to the recovery point less 48 hours, and resolve every `ledger_discrepancy` case before restarting; a transfer Stripe made that the restored ledger lacks is recorded on its intent so the transfer worker's own lookup finds it instead of paying again. The local rehearsal compares the storage reference report before and after its restore.

The local drill demonstrated restoration of 28 synthetic users, 47 order snapshots, 9 storage records, 3,686 queue records and 66 RLS-enabled tables. Its recorded database restore took 48 seconds on this workstation; this is a baseline, not an agreed production RTO. Database and object captures in this development run were separate and not an atomic hosted backup. Hosted coordinated restore, Stripe reconciliation before restarting money workers, production load budgets and a release operator remain required.

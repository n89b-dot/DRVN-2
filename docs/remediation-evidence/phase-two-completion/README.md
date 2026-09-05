# Phase-two local evidence — 2026-09-05

These are sanitized local verification results; browser traces, TOTP material, credentials, storage manifests and backups are excluded.

- `unit.log`: 341 tests, 55 files passed.
- `sql.log`: all 15 SQL guard suites passed on a fresh Supabase PostgreSQL 15.14.1.158 image.
- `schema.log`: generated database contract matched the migrated fresh database.
- `stripe.log`: 10 real Stripe test-mode API tests passed. This is not HTTPS Payment Element/3DS/Connect browser coverage.
- `operations.log`: 4 real local-stack drills passed: 1,100-listing paging, Typesense outage/privacy plus 101 orphan IDs across two batches, historical metadata remapping/resume, and nested deletion continuation.
- `modal-mfa.log`: production sheet/dialog primitives and synthetic MFA recovery passed in Chromium, Firefox and WebKit.
- `monitor.log`: three independent monitor contract tests passed.
- `returns.log`: four pickup/shipping/refund/return journeys passed after immutable-fixture cleanup was corrected.

Additional local verification: typecheck passed; lint has no errors and five pre-existing warnings. Linux visual baselines were generated and reviewed in Playwright 1.62.0's Noble container. The final Linux release-suite and hosted CI outcomes are recorded separately after those runs complete.

The database restore baseline restored 28 synthetic users, 47 immutable order snapshots, 9 storage records, 3,686 queue records and 66 RLS-enabled tables in 48 seconds. All SQL guards available in that backup passed afterward. An object archive was restored into a separate volume and compared byte-for-byte. The development DB and object captures were separate, so this does not prove coordinated hosted recovery or an agreed RPO/RTO.

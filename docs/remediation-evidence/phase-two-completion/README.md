# Phase-two local evidence — 2026-09-05

These are sanitized local verification results; browser traces, TOTP material, credentials, storage manifests and backups are excluded.

- `unit.log`: 352 tests, 58 files passed.
- `sql.log`: all 15 SQL guard suites passed on a fresh Supabase PostgreSQL 15.14.1.158 image.
- `schema.log`: generated database contract matched the migrated fresh database.
- `stripe.log`: 10 real Stripe test-mode API tests passed. This is not HTTPS Payment Element/3DS/Connect browser coverage.
- `operations.log`: 4 real local-stack drills passed: 1,100-listing paging, Typesense outage/privacy plus 101 orphan IDs across two batches, historical metadata remapping/resume, and nested deletion continuation.
- `modal-mfa.log`: production sheet/dialog primitives and synthetic MFA recovery passed in Chromium, Firefox and WebKit.
- `monitor.log`: three independent monitor contract tests passed.
- `returns.log`: four pickup/shipping/refund/return journeys passed after immutable-fixture cleanup was corrected.

Additional local verification: typecheck passed; lint has no errors and five pre-existing warnings. Linux visual baselines were generated and reviewed in Playwright 1.62.0's Noble container. The final Linux release-suite and hosted CI outcomes are recorded separately after those runs complete.

The database restore baseline restored 28 synthetic users, 47 immutable order snapshots, 9 storage records, 3,686 queue records and 66 RLS-enabled tables in 48 seconds. All SQL guards available in that backup passed afterward. An object archive was restored into a separate volume and compared byte-for-byte. The development DB and object captures were separate, so this does not prove coordinated hosted recovery or an agreed RPO/RTO.

Final-candidate verification follow-up: the first hosted run exposed build-time sitemap database access, gallery mutation transition handling, CSP-blocked screenshot fixture styling, and a pending dispute transition. Commits `fa5d3dc` and `4a6e025` address those findings. The placeholder-credential production build passed locally; three new sitemap contract tests verify existing URLs, XML escaping, invalid-page rejection and uncached service failures. A follow-up isolates dispute submission from the observed Server Action transition stall: a bounded same-origin JSON endpoint executes the shared authenticated command, then the client performs a full navigation. Eight additional tests cover authentication, ownership, rate limits, CSRF, body limits and ordinary JSON results. The earlier redirect-only attempt did not reliably resolve the stall. Hosted outcomes are reported by the required checks and validation section on [PR #1](https://github.com/n89b-dot/DRVN-2/pull/1); consult those live results rather than treating this static local evidence as a green CI result.

The first hosted operational baseline (Ubuntu GitHub runner, isolated Supabase, 1,100 synthetic listings, 20 requests at concurrency 4) measured search p50 336 ms, p95 421 ms and maximum 424 ms. This measures the database search RPC, not end-to-end page latency or an approved production SLO. Source: run 33974016925, e2e job, operational-drill output.

Browser regression follow-up also makes gallery uploads display the persisted image returned by the command, preserves the surrounding unsaved form, and targets the real marketplace results section for the CSP-compatible visual mask. The public-origin check uses the configured site origin rather than the reverse proxy’s internal request URL. No temporary diagnostic logging is included.

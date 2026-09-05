# DRVN remediation implementation status

Working-tree implementation against reviewed baseline `f6cf0a90b027424c7f1564e9fba499a21543fd7b`. Unrelated password-field and component documentation edits have been preserved. This is not a deployed revision or a production-readiness certification.

## Implemented

| Plan | Implemented behavior | Verification or remaining boundary |
|---|---|---|
| A01 | Corrected fallback JWT handling in CI; independently executes all SQL guards; release gate requires actual E2E and Stripe execution; isolated local Supabase/Mailpit setup | Original admin failure reproduced on CI's exact PostgreSQL image, then corrected. Hosted CI secrets still need provisioning. |
| A02 | Persisted immutable payment requests and correlation IDs; atomic payment-reference mapping; stable Stripe idempotency; buyer/basket retry ownership; unknown status remains unresolved | Real Stripe test API exercises retries and multi-seller capture. Captured retries do not request buyer confirmation again; partial captures cannot release fulfillment. Requests older than the safe retry window require reconciliation. |
| A03 | Atomic late-capture recording and deduplicated per-order compensation; cancelled fulfillment stays cancelled; card-only checkout | Real Stripe capture after cancellation and durable refund tested. Provider-aware reservation expiry and every mixed-basket/crash permutation remain open. |
| A04 | Capture, payment ledger and seller obligations commit in one RPC; duplicate replay preserves already transferred orders; known-reference reconciliation | SQL and real Stripe multi-seller tests, injected payout failure rollback and replacement-buyer stock preservation. Unknown/mismatched mappings and reconciliation backlog fairness need further recovery coverage. |
| A05 | Durable receipt jobs, actual Auth email links, fresh-browser token exchange, signed expiring guest capability | Queued receipt delivery through the money worker and Mailpit link redemption/reuse tested in all three browsers. Existing registered-email guest attachment also passes browser coverage. External SMTP delivery and scanner-prefetch behavior need release rehearsal. |
| A06 | TOTP enrollment/challenge, recent AAL2 requirement, live membership checks, transactional admin commands/audit; external-action intent/completion journal | SQL audit failure rolls mutation back; browser MFA and membership revocation tested. Human recovery and provider-success/audit-failure rehearsal remain. |
| A07 | Checkout limiter fails closed, network identifiers are keyed hashes, forwarded addresses require explicit trusted-proxy configuration; buyer reservation cap and baskets bounded to 50 items/13 sellers (Stripe metadata limit) | Unit/SQL guards. Production ingress configuration and distributed guest-abuse load tests remain. |
| A08 | Bounded telemetry queue, timeout/flush, input-size enforcement, redaction and response-status checks | Unit coverage; configured external transport outage rehearsal remains. |
| A09 | Per-family worker records, capture/receipt drain, separate deletion/search endpoints, cron wiring and authenticated health check | Database guards and browser-triggered deletion/receipt work. Expired-lease reclaim, stale-worker rejection and exhausted-job health visibility pass SQL guards. Independent monitoring, real alerts and sustained backlog/long-job lease tests remain. |
| A10 | Unsafe browser renderer disabled in production at configuration and execution boundaries | Existing importer regression tests. |
| A11 | Transactional search queue triggers and retryable delivery; explicit analytics consent with bounded post-response transport | Consent unit tests; full Typesense outage/rebuild/privacy matrix remains. |
| A12 | Durable deletion request, stale-JWT write denial, paginated nested storage cleanup, identity deletion last; export pagination and explicit failure | Browser deletion with 105 nested assets and stale-token write rejection. Retention/legal policy, external customer cleanup and large/retrying deletion rehearsal remain. |
| A13 | Authenticated public-photo endpoint decodes/normalizes every image, strips metadata, stages derivative lifecycle; direct original upload denied | Route tests cover small metadata-bearing images, invalid bytes and authorization. Historical originals require inventory/backfill. |
| A14 | Server-only boundary, per-request script nonces, no production unsafe-inline/unsafe-eval scripts, Storybook upgrade removes reported dependency advisories | Audit has zero findings; Storybook build passes. History scan covers 120 commits with no leaks; current source scan also has no findings. Chromium, Firefox and WebKit probes confirm fresh nonces and rejection of injected inline scripts. Real Stripe Payment Element/3DS under this policy still needs staging verification. |
| A15 | Commerce actions split by responsibility; generated DB contract and literal RPC drift test; segmented sitemap; search cap disclosure; native modal semantics | TypeScript and transaction/browser tests. Full replacement of handwritten schema types, uncapped search pagination and screen-reader/nested-dialog matrix remain. |
| A16 | Reproducible local test environment and rollout/recovery instructions | Production restore, independent alert, provider-connected payout/dispute journey, load rehearsal and deployed CI evidence remain launch gates. |

## Release decision

**Do not enable live money on the strength of this working-tree change alone.** The implementation closes substantial defects, including a newly verified constraint that rejected multi-seller shared payment references. It does not satisfy every acceptance criterion in A01–A16 yet. In particular, untested money recovery paths and the restore/alert rehearsal are release blockers, not optional feature additions.

Follow [the rollout and recovery instructions](remediation-rollout.md). Keep optional GitHub-derived features out of this remediation. Verification results below describe actual executions; a skipped test is not passing coverage.

## Verification record

Executed September 5, 2026 UTC against isolated local Supabase and the existing Stripe **test** account. [Evidence logs](remediation-evidence/2026-09-05/) accompany these results.

- Unit tests: **324 passed across 48 files**.
- Stripe test API integration: **9 passed**, including shared multi-seller capture, late-capture compensation and captured-payment retry.
- Production-build browser suite: **156 passed, 11 skipped**; Chromium runs the full suite, Firefox/WebKit run the golden journey and remediation security tests. All 25 Chromium visual snapshots pass on macOS; five marketplace baselines were visually reviewed and updated.
- SQL: **all 10 guard files passed** against CI's exact `supabase/postgres:15.14.1.158` image. Tests include forced transactional failure, duplicate/late captures, replacement-buyer inventory preservation, MFA/audit authorization, deletion fencing and lease recovery.
- TypeScript: passed. ESLint: zero errors, five warnings (unused directives/parameters).
- Generated database contract: matches both local Supabase and the CI database image.
- Storybook production build: passed. Dependency audit: zero reported vulnerabilities.
- Secret scans: no findings in 120 commits or the inspected current source. This is scan evidence, not proof no secret has ever been exposed.
- Independent CSP probes: fresh nonces and injected inline scripts blocked in Chromium, Firefox and WebKit.

The 11 browser skips are one unseeded vehicle-catalog picker, one opt-in evidence recorder, two private-loopback importer scenarios disallowed by the production SSRF configuration, and seven mobile inventory/seed-dependent scenarios. Those seven remain a test-fixture coverage gap; other checkout/mobile tests passing does not close them. Linux screenshot baselines and hosted CI execution still require verification.

The final capture validation and retry changes are covered by the unit and real Stripe runs above; the full browser suite preceded those final changes. A subsequent production rebuild and Chromium security smoke passed all **4 tests** on the final code. Worker logs during that smoke include expected receipt failures from earlier disposable Stripe fixtures whose accounts were deleted; the test explicitly verifies its own queued receipt reaches completed. Browser traces and local environment files remain ignored because they can contain test session tokens and authenticator details.

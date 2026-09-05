# DRVN remediation implementation plan

Prepared September 4, 2026. Based on the [production readiness report](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/production-readiness-2026-09-04.md>), findings R1–R14.

**Objective:** make DRVN's existing functionality correct, recoverable, secure and verifiably deployable. This is a work plan, not a record of completed fixes. This preserves the original plan; implementation and verification are tracked separately in [the implementation status](remediation-implementation-status.md).

The plan preserves Next.js, Supabase, Stripe, the existing workers and Livesheet. It excludes new dashboards, richer galleries, new search products, notification platforms and other optional GitHub additions. Existing integrations will be repaired in place. Email delivery and admin MFA are included because they close defects in existing order access and privileged operations.

## Execution order

| Stage | Packages | Result required before moving on |
|---|---|---|
| 1. Establish trustworthy verification | A01 | Reproducible isolated database tests; CI reports actual execution |
| 2. Correct the transaction lifecycle | A02, A03, A04 | Stable checkout attempts; captured funds always have a fulfillment or compensation outcome |
| 3. Restore guest access and secure administration | A05, A06, A07 | Delivered/redeemable order links, durable admin audit, abuse limits and MFA |
| 4. Make failures survivable | A08, A09, A10 | Bounded monitoring, working workers/alerts, unsafe browser import unavailable |
| 5. Close privacy and reliability gaps | A11, A12, A13 | Reliable enabled search/telemetry; expiring guest access; complete deletion and safe public media |
| 6. Finish hardening and release proof | A14, A15, A16 | Security/dependency cleanup, accurate types/docs, browser/scale checks and restore rehearsal |

Implement A08 and the production-disable portion of A10 early when convenient; neither needs to wait for the money changes. Complete each package in a reviewable change. A03 and A04 must share one settlement contract, although their tests and code can be divided into consecutive changes. Do broad module extraction only after transaction fixes are stable.

The report assessed GitHub revision `f6cf0a9`. Unrelated password-field/authentication UI changes are present in the shared workspace. Preserve those changes, establish the implementation baseline explicitly, and coordinate overlapping auth/UI edits before making them. Never discard them to obtain a clean test result.

## Non-negotiable implementation rules

1. Database transactions own local invariants. A Stripe/API call cannot participate in a Postgres transaction; bridge the gap with a persisted operation, idempotency and reconciliation.
2. Acknowledging a webhook means every affected order has a committed outcome or a durable, retryable recovery obligation. Logging an error does not satisfy that requirement.
3. Unknown payment status is not failed payment. Never release inventory or create another intent merely because a request timed out.
4. Retries preserve operation identity, amounts, currency and provider parameters. A new HTTP request does not imply a new business operation.
5. Every migration is additive or explicitly compatibility-managed. Read the actual latest function definition before replacing it; newer shipping/fee/snapshot behavior must survive. Do not edit historical migrations to fix an already-deployed database.
6. Use the repository's documented migration procedure. Never run destructive migration 0001 against an existing database or blindly establish Supabase CLI history with `db push`. Generate new migration filenames through the supported tool after confirming the repository naming/history strategy. Update the migration ledger with actual application evidence.
7. Read installed Next documentation before implementing relevant framework changes. Use `server-only`, session verification and RLS deliberately; a comment is not enforcement.
8. A package is complete only when its acceptance tests pass and its deployment requirements are recorded. “Implemented, awaiting external verification” remains an open status.

## A01 — Repair the database and release test harness

**Covers:** R5. **Dependencies:** none. **Primary files:** `.github/workflows/ci.yml`, `supabase/tests/ci_shim.sql`, all `supabase/tests/*_guard.sql`, `playwright.config.ts`, `e2e/README.md`, `tests/stripe/`.

**Implementation**

1. Reproduce the admin failure using the same Supabase Postgres image as CI. Inspect the installed `auth.uid()` definition and print only non-sensitive test claim values. Compare its behavior with `pg_temp.impersonate` and reset helpers. The claim-format discrepancy is a hypothesis; do not weaken `is_admin()` or change production authorization to satisfy a faulty fixture.
2. Standardize fixture helpers around the actual PostgREST claim contract. If fallback auth functions are needed, model that contract accurately. Assert anonymous, ordinary member, viewer and admin identities before asserting permissions. Reset all relevant claims between identities.
3. Execute purchase, admin, security, money, import, snapshot and return guards. Keep each test transactional and rolled back. Run suites independently after successful schema setup so one failure does not hide later failures. Capture psql output before returning its original exit code; assert expected completion markers too.
4. Establish explicit isolated E2E settings. Require a declared test-project identifier and test mode, refusing accidental `.env.local` production fallback. Cleanup must target only records created by that run, not every matching account from another run.
5. Keep secretless pull-request checks useful, but create a mandatory release gate that fails if required E2E/Stripe suites did not run. Publish separate `ran`, `passed` and `skipped_reason` results. Configure branch/release protections against the failing aggregate gate, not the informational summary job.
6. Run release journeys against `next build` + `next start`. Separate deterministic stub journeys from real Stripe test-mode integration; never describe stub coverage as provider coverage. Add Chromium, WebKit and Firefox smoke projects for critical flows, with a broader Chromium regression suite.

**Acceptance:** a genuine admin fixture is recognized, viewer/non-admin writes fail, all seven guard families run, deliberate SQL failures turn the gate red, and omitted integration secrets cannot produce a release-ready result. Store the tested commit and executed suite counts.

## A02 — Persist checkout identity and make retries safe

**Covers:** R4, part of R10. **Dependencies:** A01. **Primary files:** `src/features/commerce/actions.ts`, `src/lib/payments/{provider,stripe,customers}.ts`, migrations defining `purchase_attempts`, `purchase_begin` and offer checkout.

**Implementation**

1. Extend the existing attempt record, rather than creating an unrelated checkout system. Persist an attempt ID, authenticated principal or guest capability identity, immutable request fingerprint, correlation ID, currency/total, provider reference, operation state and timestamps. Make concurrent creation unique and row-locked.
2. Build the fingerprint from canonical, server-validated intent: sorted listing IDs, accepted-offer identity if present, delivery choice and shipping quote/destination binding. Persist the authoritative price and commercial snapshot on first reservation. A changed basket/quote needs a new attempt; do not recompute old provider parameters on retry.
3. A guest email is a destination, not proof of identity. Issue a high-entropy, signed/expiring browser capability and bind the attempt to it. A different browser using the same email must not retrieve the first browser's intent. Enforce ownership before returning prior results or secrets.
4. Generate correlation identity once, before contacting Stripe. Persist the exact create parameters; reuse them with the same Stripe idempotency key. Reuse a known PaymentIntent rather than recreating it. Apply the same rule to accepted-offer/order checkout, which currently generates a new correlation ID with a stable `order:${orderId}` key.
5. Expand provider outcomes to distinguish actionable confirmation, processing, definitive rejection/cancellation, and unknown/reconciliation-needed outcomes. Update every caller; stop mapping all non-success states to `requires_action` or ordinary failure.
6. On an uncertain creation response, retain the attempt and reconcile via the persisted key/reference and metadata. Beyond Stripe's idempotency retention window, do not blindly create again; escalate if provider lookup cannot establish the result. Validate PaymentIntent ownership, order mapping, amount and currency on return/settlement, not merely its success status.

**Acceptance:** concurrent double submit creates one attempt and one intent; retry after a lost response reuses identical metadata; changed parameters are rejected; another principal/capability cannot reuse the attempt; an ambiguous provider response leaves inventory in a tracked unresolved state. Test multi-seller and accepted-offer flows, not only a single listing.

Stripe's [idempotency documentation](https://docs.stripe.com/api/idempotent_requests) explains parameter comparison and the retention limit. The persisted DRVN operation must outlive that provider retry window.

## A03 — Handle late capture and reservation expiry explicitly

**Covers:** R1. **Dependencies:** A02. **Primary files:** `src/lib/payments/{settlement,refunds}.ts`, `src/app/api/stripe/webhook/route.ts`, reservation/finalization/refund SQL, `src/lib/domain/states.ts`, order status presentation.

**Implementation**

1. Replace the settlement boolean with typed outcomes such as `settled`, `already_settled`, `compensation_queued`, `recovery_queued` and `retryable_failure`. These are proposed result names, not existing database states. Inspect RPC JSON results as well as transport errors.
2. Validate that a successful provider payment belongs to the recorded attempt and matches its currency/total and order set. Unknown or mismatched mappings go to a durable recovery obligation, never a success analytics event.
3. Add an explicit compensation path for a captured payment whose order cannot be fulfilled. **Do not simply call `refundOrder` unchanged:** it currently rejects cancelled/payment-failed orders. Record the actual capture/reference, verify the refundable balance, and create a deduplicated compensation operation through the durable refund machinery.
4. Preserve the cancelled fulfillment state and listing ownership. Model financial compensation separately: add an operation purpose for late capture and adjust refund-effect handling so it can record the refund without pretending the order was fulfilled. Update SQL guards, state documentation, ledger displays and the order UI consistently. Normal refund rules must remain restrictive.
5. Limit a compensation amount to the affected order's allocation. A basket can contain both valid and expired orders; a full-intent refund would incorrectly refund the valid orders. Reserve refund amounts transactionally and reconcile an existing provider refund before retrying it.
6. Change expiry from unconditional cancellation to a persisted expiry/reconciliation workflow. Coordinate inventory and order changes with locks and rechecks. Cancel cancellable provider intents before final release where practical; retain/flag processing or unknown results for reconciliation. Continue supporting late-success compensation because cancellation can race provider capture.
7. Until delayed methods have complete coverage, configure checkout to offer only the payment methods whose lifecycle has been verified. Treat that as a temporary capability restriction with a test, not a claim that card payments cannot arrive late.

**Acceptance:** expire A, reserve/sell the listing to B, then deliver A's success. B remains untouched; A gets one tracked compensation and eventually the correct refund. Repeat/reorder the events, crash after provider refund but before DB effects, and retry. Assert actual provider totals, payment ledger, inventory, order display and recovery status. Include a mixed-outcome multi-seller basket and a prior partial refund.

## A04 — Commit settlement obligations atomically and reconcile omissions

**Covers:** R2, parts of R11. **Dependencies:** A02–A03. **Primary files:** `src/lib/payments/{settlement,transfer-worker}.ts`, webhook route, payment/transfer SQL.

**Implementation**

1. Introduce a narrow service-only settlement RPC that locks the order, validates the applicable transition, records payment capture, and creates its transfer obligation in the same DB transaction. Use frozen order amounts and existing hold/dispute/refund rules; retain shipping adjustments and source-transaction references.
2. A duplicate obligation is only harmless if its immutable identity/currency/amount agree. Do not turn arbitrary unique conflicts into success. Roll back local settlement on an obligation insert failure; return a retryable outcome.
3. Make replay repair missing obligations for eligible paid, shipped, delivered and completed orders. Exclude compensation-only, fully refunded and otherwise ineligible orders; account for partial refunds and existing transfers. If the correct amount cannot be proven, create a recovery rather than guessing.
4. Persist guest receipt work and authoritative completion-event identity alongside settlement, so a crash cannot lose them. This requires the small outbox described in A05. Actual email/analytics sends remain outside the transaction.
5. Check webhook persistence and processed-marker write results. Return success only after each mapped order has durable resolution. A durable queued compensation may be acknowledged because its worker owns retries; a log message or failed queue insert may not. Concurrency protection must be database uniqueness/locking, not event IDs alone.
6. Add a bounded reconciliation sweep for captured payments missing expected obligations, unresolved attempts and orphan provider references. Use keyset batches, durable progress and recovery deduplication. Historical repair starts with a read-only discrepancy report; only repair entries whose provider state and amounts are verified.

**Acceptance:** inject failure at each DB write and crash boundary. No paid order is silently stranded; retry restores one obligation and never pays twice. Test concurrent webhook deliveries and replay after shipment, partial refund and full refund. The saved review probes become normal regression tests expecting corrected behavior.

## A05 — Deliver guest access and enforce receipt expiry

**Covers:** R3 and guest-access portion of R12. **Dependencies:** A02–A04. **Primary files:** `src/features/commerce/guest-buyer.ts`, `src/lib/guest-checkout.ts`, auth confirmation/callback routes, `cart/complete`, `order-placed`, notification delivery, worker jobs.

**Implementation**

1. Add a small transactional delivery outbox: unique business key, purpose, attempt/order reference, recipient reference, state, attempts, next-attempt time, lease and delivery reference. Restrict access to service workers/admins. Reuse the established leasing/backoff style, without installing a new orchestration platform.
2. Enqueue after authoritative successful settlement; enqueue the appropriate compensation notice for a late capture instead of a normal fulfillment receipt. Cover guest/member and stub/Stripe paths. Do not make the buyer's return visit responsible for sending.
3. For the initial fix, use Supabase's actual email-sending flow with configured production SMTP and a simple template. If the current mail setup cannot meet delivery requirements, keep the outbox interface and supply a minimal sending adapter. Do not add a template framework merely to close this bug.
4. Support a token-hash confirmation route that verifies the email token and establishes the session in the browser that opens it. The current callback handles a PKCE code exchange only; don't assume that a worker-generated link will work through it. Validate allowed token types and same-origin destinations; preserve the destination through onboarding. Test inbox-scanner/link-consumption behavior and provide a safe resend flow.
5. Never log token hashes, session tokens or generated links. Generate expiring access material close to delivery. Validate canonical HTTPS origin and Supabase redirect allowlists. Rate-limit resend, use generic responses and avoid account enumeration.
6. Distinguish `queued`, `provider_accepted`, `delivered` and `failed` where the provider supports delivery feedback. Do not claim inbox delivery solely from API acceptance. Deduplicate enqueue and use provider idempotency when available; if the sending API cannot prove an ambiguous send, acknowledge the residual possibility of a duplicate email rather than promise exactly-once delivery.
7. Change guest receipt payload to a versioned object containing validated order IDs, issued-at, expiry and purpose. Enforce expiry server-side, cap size/count and use a dedicated signing secret with a documented rotation policy. Reject old non-expiring payloads at cutover; users recover through order email. Bind return-route intent checks to those orders.

**Acceptance:** a test-mode guest pays, closes the checkout browser, receives email and opens the exact order in a fresh browser through onboarding if required. Expired/tampered cookies and links fail safely. SMTP timeout, retry, duplicate webhook and resend have tracked outcomes. Add tests for an existing registered email, not just a newly created guest.

The [Supabase passwordless guide](https://supabase.com/docs/guides/auth/auth-email-passwordless) documents email sending and token-hash verification. Verify the concrete template and token type against the installed client/server configuration during implementation.

## A06 — Make privileged operations auditable and session-protected

**Covers:** R6 and admin portion of R10. **Dependencies:** A01; A03–A04 for money actions. **Primary files:** `src/lib/admin/{actions,audit,guard,capabilities}.ts`, admin pages/actions, relevant SQL, auth/settings MFA UI.

**Implementation**

1. Inventory every admin mutation, including settings/shop/case actions outside the central action file. Classify database-only versus external-provider work. Identify any write bypassing the common authorization/audit path.
2. Replace mutation callbacks plus separate audit insert with typed transactional RPCs for database-only actions. Assert role, validate reason/input, mutate and append audit in the same transaction. Prefer caller-session RPCs that derive actor identity from `auth.uid()`; grant only narrow execution privileges and fix search paths.
3. For refunds, transfers and replay, first create a durable authorized operation/intent and audit its request. Execute external work idempotently, then append completion/failure/recovery records. Keep append-only audit semantics. Never report “aborted” after a provider effect has happened.
4. Require verified `aal2` for admin actions and sensitive admin data access; add TOTP enrollment/challenge and a documented recovery procedure before enforcing the gate. Recheck membership and assurance on every entry point, including direct server-action requests. Require recent step-up for high-impact money/settings actions; validate the authentication timestamp rather than a browser boolean.
5. Where service-role workers execute an already-authorized operation, distinguish system execution from a new user request. A request-supplied actor UUID or assurance flag is not proof. Persist authorization at request time; revalidate policy before delayed execution where revocation should cancel it.

**Acceptance:** audit insertion failure rolls back a DB action; provider success followed by audit failure produces a recoverable operation with truthful UI. A viewer, low-assurance admin, revoked admin and forged direct request all fail. Bulk actions report each durable outcome. TOTP challenge and account recovery work without introducing an admin lockout.

Supabase documents MFA assurance and enforcement across backend/database boundaries in its [MFA guide](https://supabase.com/docs/guides/auth/auth-mfa).

## A07 — Bound checkout abuse at the actual write boundary

**Covers:** remaining R10. **Dependencies:** A02. **Primary files:** `src/lib/rate-limit.ts`, guest/cart/checkout actions, purchase RPCs, relevant public write policies.

**Implementation**

1. Apply limits before account creation, quote/provider calls or stock reservation. Combine trusted-proxy-derived network identity, guest capability/account identity and per-listing reservation pressure. Do not trust arbitrary forwarded headers or use an email address as the sole abuse key.
2. Add database-enforced caps on unresolved attempts/reservations per principal. A retry of the same attempt resumes it without consuming another reservation; expiry must not indefinitely extend a hold.
3. Give expensive/state-changing rules a fail-closed policy with a clear retry message. Keep read-only discovery available during limiter outages. Start with conservative configurable limits, document them, and test shared-network users before rollout.
4. Inventory direct authenticated Data API writes for abuse-sensitive entities. Revoke unnecessary writes or move limits into the authoritative transaction/trigger so direct REST cannot bypass them. Preserve RLS ownership constraints.
5. Avoid logging raw email/IP identifiers unnecessarily; use keyed hashes with retention where suitable. Add bounded cleanup for rate-limit state and alerts for sustained refusal/outages.

**Acceptance:** repeated guest attempts cannot monopolize stock or create unbounded users; direct REST fails the same restrictions; legitimate retries and two buyers behind one network still work. Limiter failure occurs before a provider charge/account creation.

## A08 — Bound monitoring without replacing the monitoring stack

**Covers:** R7. **Dependencies:** none. **Primary files:** `src/lib/monitoring.ts`, `src/app/api/monitoring/route.ts`, instrumentation, webhook/worker handlers.

**Implementation**

1. Keep the current transport initially. Add an explicit abort timeout (starting target: 2 seconds), inspect HTTP status, and count failures without recursively reporting monitoring failures to the same service.
2. Add a bounded flush budget (starting target: 1 second at response completion), cancel overdue work and cap concurrent/in-flight sends. These are initial engineering limits to verify against hosting budgets, not measured current performance.
3. Validate DSN syntax/origin at startup; missing and malformed configurations must be distinguishable. Add structured correlation tags and scrub addresses, tokens, request bodies and provider client secrets from error context.
4. Stream-cap intake before JSON parsing (starting cap: 16 KiB), enforce shape/content type, and rate-limit at the endpoint/edge. `Content-Length` alone is insufficient. Unsupported bodies must not produce another monitoring event.
5. Run a synthetic server and client exception in staging and verify their receipt/usable context. Preserve a local structured log fallback if reporting fails.

**Acceptance:** a hanging endpoint, 429 and 500 remain within budgets; money endpoint responses complete independently; an oversized/chunked payload is rejected before full buffering; telemetry contains no test secrets.

## A09 — Prove scheduler and operational readiness

**Covers:** R8. **Dependencies:** A03–A05, A08. **Primary files:** `src/lib/env.ts`, `src/instrumentation.ts`, `/api/jobs/*`, worker modules, job configuration SQL, `docs/production-runbook.md`.

**Implementation**

1. Validate required live-money settings, including worker secret, canonical origin and a functioning operational alert destination. Separate actual live-money deployment from deliberately configured non-public test mode. Do not add fake DSNs just to make startup pass.
2. Record each job family's last start/success/failure, lease, processed count and oldest outstanding item. A route returning 200 is not proof every subjob succeeded. Bound batches/time and prevent one failing family from starving the rest.
3. Verify cron/job configuration points to the current deployment and that secrets match. Add an external scheduler heartbeat check independent of the worker it monitors. Initial alert threshold: three missed expected runs; validate against the actual schedule and financial deadlines.
4. Include compensation, receipt outbox and search/deletion work in an explicit scheduling map. Reuse workers where execution budgets permit; use separate endpoints/budgets when a non-money job could starve money work.
5. Document ownership and response for stuck capture, payout, refund, receipt and return cases in the existing admin/runbook surfaces. Verify alerts and recovery IDs link to the same operation.

**Acceptance:** boot the release in correctly configured staging, pause a worker and observe an independent alert, restore it and drain work safely. Crash a leased task and prove another run reclaims it. Confirm no starvation under a representative backlog.

## A10 — Close the unsafe browser-import capability

**Covers:** R9. **Dependencies:** none for containment.

**Primary files:** `src/lib/listing-import/{config,engine}.ts`, `fetch/{render,safe-fetch,guard}.ts`, importer tests/docs.

**Implementation:** for this remediation release, enforce browser fallback **off in production in code**, not just by an unset deployment flag. Reject or ignore an attempted enable with explicit diagnostic output. Keep safe HTTP fetch and paste fallback operational, and make user-facing fallback text accurate. Test config resolution with the flag both absent and forcibly enabled.

Full browser rendering remains disabled until there is enforced public-only network egress, connect-time destination control, subresource/port restrictions, blocked service workers and resource limits. This is a documented capability restriction, not a declaration that the renderer was repaired. Restoring it is a separate security implementation, with rebinding/redirect/network-boundary tests; it is not required to launch the remaining importer.

**Acceptance:** production can never execute the unsafe renderer through configuration or a direct engine path, and supported HTTP/paste imports still pass regression tests.

## A11 — Make existing search and telemetry behavior reliable

**Covers:** R11 and analytics portion of R12. **Dependencies:** A04–A05 outbox foundation, A09.

**Primary files:** `src/lib/analytics.ts`, marketplace/explore indexing, sell/garage mutations, privacy/settings presentation.

**Implementation**

1. Enqueue search synchronization transactionally with object changes, preferably through database triggers so direct permitted writes are covered. Store object identity/version, not a stale document snapshot. The worker reads current canonical state, upserts or deletes, and records completion with retries.
2. Cover creation, editing, deletion, sold/removed state, account suspension and private/public changes across listings, cars, posts and profiles. Coalesce repeated edits safely; an old task must not resurrect a deleted/private document. Limit access to index contents and continue rechecking visibility at read time.
3. Add scheduled reconciliation/reindex with a cursor and bounded batches. Use Postgres fallback on known index unavailability; surface stale-index health instead of pretending a successful-but-incomplete index is current.
4. Move best-effort analytics to supported post-response work, with bounded sends and non-2xx handling. Use an outbox event ID for authoritative purchase completion and provider deduplication where supported. `after()` improves response-lifetime handling but is not a durable queue.
5. Honor the existing promise to ask before product analytics: introduce a server-enforced opt-in gate and update disclosure/preferences. Default off until implemented. Do not add anonymous tracking identities in this fix; treat anonymous events as aggregates, never unique users. Operational security logs remain separately classified.

**Acceptance:** kill a request after commit; index work survives. Exercise outage/rebuild and private/deleted objects. Refusing consent produces no product analytics request; purchase redelivery does not inflate completed-order metrics. Existing search remains usable without Typesense.

## A12 — Make account deletion complete, resumable and honest

**Covers:** account/privacy portion of R12. **Dependencies:** A06 authorization patterns, A09 job execution.

**Primary files:** account deletion in `src/app/(product)/garage/actions.ts`, media lifecycle/storage policies, privacy text, account export.

**Implementation**

1. Create a service-owned deletion request before destructive work. Check active orders, disputes, returns, unresolved payments and seller obligations; fail closed on query errors. Prevent new activity during deletion and recheck for races inside the authoritative transaction.
2. Inventory every user-data/storage family, including staged media and copied order images. Define retained financial/dispute evidence separately from public profile media. Do not delete evidence needed by a counterparty simply because the originating account is deleted.
3. Revoke sessions, enforce a pending-deletion/tombstone check on sensitive access and account creation paths where needed, and handle existing access tokens until expiry. Revoke-before-delete is necessary but not sufficient if old JWTs still authorize operations.
4. Paginate all storage listings and descend arbitrary supported folder depth. Deleting while using offset pagination can skip entries: enumerate into a durable manifest first or repeatedly drain a stable first page. Retry removals and record remaining failures. Block new uploads by the deleting account.
5. Remove/anonymize the intended rows and retained personal fields, including addresses according to the documented retention policy. Delete auth identity only after required cleanup has completed or is durably schedulable without that identity. Do not report deletion complete on a partial failure.
6. Check the data export against this same inventory: paginate beyond API row caps, report incomplete sections explicitly and add missing personal-data families within the stated export scope. Keep private counterparty data protected.

**Acceptance:** an account with more than one storage page and nested uploads can be deleted; injected storage/auth errors resume correctly; stale sessions cannot mutate; retained order/evidence access works for the counterparty; export is complete or explicitly fails rather than silently truncating.

## A13 — Enforce public-photo metadata normalization

**Covers:** media portion of R12. **Dependencies:** A12 retention decisions.

**Primary files:** `src/lib/media-upload.ts`, media staging/lifecycle, upload call sites and storage policies.

**Implementation:** retain browser resizing for convenience, but move the trust boundary server-side. Upload originals to private staging; validate actual image bytes, dimensions, decoded-pixel/memory limits and allowed formats; re-encode with the existing Sharp dependency without EXIF/GPS; publish only the validated derivative. Never return the original on normalization failure. Restrict direct client writes to public-final buckets so bypassing the UI cannot expose originals. Keep originals private with bounded cleanup. Preserve private evidence through its separate workflow.

Inventory existing public originals for a paced backfill. Remap references safely, retain order snapshot provenance as required, then delete obsolete public originals and account for CDN/cache invalidation. Do not imply past public exposure can be undone.

**Acceptance:** tiny GPS-bearing JPEGs, rotated images, spoofed MIME types and oversized decoded images cannot publish an unprocessed original; normal photos display correctly; failure provides a retryable user state; evidence remains intact and private.

## A14 — Fix dependency, CSP and server-boundary hygiene

**Covers:** R13. **Dependencies:** A01; browser verification in A16.

**Primary files:** `package.json`, lockfile, `next.config.ts`, `src/lib/supabase/admin.ts`.

**Implementation:** refresh the advisory results and trace the affected dependency chain. Upgrade compatible patched versions or migrate the Storybook development chain deliberately if required; do not force-upgrade unrelated packages. Verify story rendering, accessibility stories and app build. Add `server-only` to privileged clients and prove client imports fail the build. Remove production `unsafe-eval`; use Next's installed nonce/hash guidance for a tighter script policy after evaluating rendering/cache implications. Roll out stricter CSP in report-only mode where useful, then enforce after Stripe, embeds and auth flows pass. Scan repository history and generated artifacts for secrets with redacted output; rotate any verified exposed credential.

**Acceptance:** no unaddressed reachable high/critical advisory remains, any temporary exception has a documented expiry and exposure assessment, Storybook/app build pass, client code cannot import admin credentials, and enforced CSP permits legitimate checkout without permitting arbitrary inline scripts. A documented temporary CSP exception is not equivalent to complete tightening.

## A15 — Reduce drift and repair bounded-result/UI defects

**Covers:** R14. **Dependencies:** transaction packages stable.

**Primary files:** commerce actions, `database.types.ts`, `src/lib/domain/states.ts`, search/query providers, sitemap, dialog primitive, generated docs/README.

**Implementation**

1. Generate database types from the verified migrated schema. Keep application-specific aliases separately so regeneration is repeatable. Add a drift check and ensure domain-state tests exercise actual allowed/refused database transitions, not just enum completeness.
2. Extract checkout, offers, messages and disputes into focused modules while preserving action exports/callers. Do not mix extraction with changing payment behavior. Remove obsolete comments claiming already-implemented features are future work.
3. Test search beyond the existing candidate caps. Push filters into canonical search where possible and paginate ranked candidates until the requested page is filled or exhausted. Preserve identifier ranking and deterministic ties. Never silently label a capped subset as an exhaustive total. Chunk sitemaps with stable traversal so older eligible entities remain discoverable.
4. Repair the existing dialog internals without a visual redesign: enforce background inertness, correct focus on open/close, topmost-only Escape, nested-modal stack behavior, scroll-lock reference counting and empty-dialog focus containment. Use browser-native modal behavior where it fits; a new UI library is not a prerequisite.
5. Correct migration ledger, README and testing/runbook claims to match actual executed checks and disabled capabilities. Preserve historical reports as dated records.

**Acceptance:** regeneration produces no unexplained diff; extraction preserves transaction tests; fixtures larger than caps remain discoverable; all sitemap chunks are valid; nested dialogs work by keyboard and screen reader; documentation describes current behavior.

## A16 — Release rehearsal and final closure

**Covers:** remaining verification in R5, R8, R14. **Dependencies:** A01–A15, with A10's capability restriction documented.

**Implementation**

1. Build an isolated release candidate from a recorded commit. Apply migrations to both a fresh test database and a copy representing the pre-upgrade schema. Check grants, RLS, function signatures, invariant counts and type generation after upgrading.
2. Run member/guest checkout, multi-seller settlement, offer payment, dispatch, pickup, return, partial/full refund, dispute and transfer tests with actual Stripe test-mode events. Do not use broad cleanup against a shared/live database.
3. Exercise mobile/desktop critical routes in Chromium/WebKit/Firefox, keyboard/reduced-motion flows and screen-reader order/admin dialogs. Record real failures and fix them before calling accessibility complete.
4. Measure a representative catalog and concurrent checkout load, including image-heavy pages and worker backlog. Record latency distributions, query plans, resource limits and queue-drain times. Set release budgets from observed hosting capacity; do not invent a performance pass from compilation.
5. Restore DB and required object storage into an isolated environment. Validate accounts/permissions, immutable order snapshots, private evidence, operations and schedules. Disable outbound workers during restoration; reconcile provider state before re-enabling them to avoid reissuing payments. Record actual restore time and data-loss window.
6. Deploy additive schema before compatible application code; enable new workers only when both are ready. Prepare rollback to a schema-compatible build, not a destructive down-migration. During an incident, disable new checkout while retaining webhook ingestion and recovery processing where safe. Never roll the database back to erase an external financial effect.
7. Observe at least one complete scheduled cycle and execute controlled failure/recovery drills. Archive evidence by release commit: CI results, provider references in a restricted artifact, redacted logs, restore result, performance findings and unresolved exceptions.

**Acceptance:** all mandatory packages have passed their tests, zero unexplained monetary discrepancies remain, disabled capabilities are enforced/documented, and operations can recover the deployed release. A verified, bounded exception must name the affected capability; an untested payment path is not an acceptable launch exception.

## Database change groups and rollout boundaries

These are proposed migration groups, not filenames to create without checking current migration history.

| Group | Content | Compatibility / backfill requirement |
|---|---|---|
| M1 | Attempt identity, fingerprint, immutable provider parameters and guest capability binding | Existing attempts with unverifiable ownership are reconciled or expired safely, never guessed into a new principal |
| M2 | Atomic settlement obligations and explicit late-capture compensation | Preserve latest shipping/fee/snapshot logic; dry-run historical discrepancies before repair |
| M3 | Receipt/event outbox, leases and deduplication | Add without enabling worker delivery until application/schema agree; no surprise resend of every historical receipt |
| M4 | Transactional admin commands and authorized external operations | Retain existing audit history; remove bypassing grants/call paths only after new callers deploy |
| M5 | Rate limits, job health and durable synchronization/deletion | Add indexes and cleanup policies; authorize service workers narrowly; avoid long backfill transactions |
| M6 | Media staging/publish policies and remaining type/search fixes | Switch upload clients before removing old compatible paths; close public-original bypass before claiming normalization |

For any new table/function: specify ownership, RLS/grants, fixed search path where applicable, uniqueness, retention and indexes. Test client roles directly. Check the target Supabase advisors after migration. Service-only execution must be granted intentionally and public execution revoked; do not assume a new function inherits safe permissions.

## Traceability and definition of done

| Report finding | Packages | Required closure evidence |
|---|---|---|
| R1 late capture | A03, A16 | Delayed success, mixed basket and compensation crash tests |
| R2 missing payout obligation | A04, A16 | Atomic failure injection, repair and no-double-transfer tests |
| R3 guest email | A05 | SMTP/provider acceptance plus mailbox redemption in a fresh browser |
| R4 retry identity | A02 | Duplicate/lost-response/cross-principal provider tests |
| R5 failing/skipped validation | A01, A16 | Executed database/browser/Stripe release checks |
| R6 audit gap | A06 | Rollback or durable external operation under audit failure |
| R7 telemetry failure | A08 | Hung/rejected telemetry and oversized intake tests |
| R8 scheduler/restore | A09, A16 | Independent alert, backlog recovery and restore evidence |
| R9 renderer egress | A10 | Enforced production disable; HTTP/paste regressions pass |
| R10 abuse/MFA | A02, A06, A07 | Direct-write limits and low-assurance denial |
| R11 lossy sync/events | A04, A11 | Commit/crash/outage/rebuild and deduplication tests |
| R12 privacy/expiry/deletion/media | A05, A11–A13 | Server expiry, consent, paginated cleanup and metadata tests |
| R13 dependencies/CSP/secrets | A14 | Audit, boundary build test, CSP journey and redacted scan |
| R14 drift/UI/scale | A15, A16 | Generated type check, current docs, search/browser/load evidence |

Use status values `not started`, `implementing`, `implemented — verification pending`, `verified`, or `disabled by design` for A10. Each completed package should record its commit, migrations, test output and remaining configuration steps. Do not mark the whole report resolved merely because local unit tests pass.

External setup needed during implementation: an isolated Supabase test project, Stripe test configuration, an actual SMTP/email delivery path, valid monitoring and operator alert destinations, deployment scheduler access and backup/restore access. These do not prevent writing the fixes and tests; they do prevent claiming the associated production behavior has been verified.

**Recommended first change:** A01's isolated SQL guard repair and explicit CI execution reporting, followed immediately by A02–A04's checkout/settlement changes. That sequence makes the highest-risk fixes testable before expanding to the rest of the remediation.

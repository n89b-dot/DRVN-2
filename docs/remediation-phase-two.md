# DRVN remaining remediation plan

Prepared September 5, 2026. This is the execution plan for the gaps in the [implementation status](remediation-implementation-status.md), following the [original remediation plan](remediation-plan-2026-09-04.md). It preserves completed fixes and excludes optional GitHub-derived features and visual redesigns.

**Objective:** finish the remaining safeguards and produce evidence that DRVN's existing functionality can be deployed, operated and recovered safely. This document proposes work; it does not mark any additional package complete.

## Starting point and completion standard

The recorded local baseline is 324 passing unit tests, 156 passing browser tests with 11 skips, nine passing Stripe test API tests, ten passing SQL guard suites, and a successful production build. Local Supabase and Mailpit exist. Hosted CI, external delivery and operational rehearsals remain unverified. Confirm the working-tree baseline before implementation; preserve unrelated password-field and documentation edits.

Use these package states: `not started`, `implementing`, `implemented — verification pending`, `verified`. Code merged or tests compiled is not equivalent to verified. Record the tested commit, migration versions, environment, commands, actual outcomes and remaining limitations for each package. Keep credentials, authenticator images and provider/customer details out of public evidence.

All packages below are in scope for finishing the remediation. Live-money release is additionally blocked by any unresolved payment integrity, access/privacy, migration/restore, or operational recovery failure. A noncritical item can move beyond launch only through an explicit, bounded decision recording impact, owner and deadline; it remains unfinished remediation. Product analytics may remain disabled until its package is verified.

## Delivery order

| Phase | Packages | Exit condition |
|---|---|---|
| 1. Establish repeatable release verification | B01, start B02 | Reliable fixtures and a clearly isolated staging/CI target; local implementation need not wait for external access |
| 2. Finish financial recovery | B03, B04 | Expiry, ambiguous captures and retries have durable outcomes; no unexplained monetary discrepancies |
| 3. Finish access and worker recovery | B05, B06 | Safe email redemption, recoverable admin operations, independent alerts and bounded job processing |
| 4. Complete privacy and data correctness | B07, B08, B09, B10 | Deletion/retention, historical media, search and enabled analytics satisfy their acceptance tests |
| 5. Prove release readiness | B11, B12 | Provider-connected journeys, accessibility, migration/restore and load rehearsals pass on one recorded candidate |

Recommended first reviewable change: B01's self-contained fixtures and required-test reporting, followed by B03's reservation state machine and B04's durable recovery cases. Start B02 environment setup early because B05–B12 need deployed verification. Package descriptions give implementation order; they do not require separate agents.

## B01 — Close test-fixture and CI execution gaps

**Maps to:** A01, A15, A16. **Dependencies:** none. **Owner:** engineering. **Surfaces:** `e2e/helpers.ts`, mobile matrix/remediation specs, catalog picker spec, `tests/stripe/`, `playwright.config.ts`, `.github/workflows/ci.yml`.

1. Give every inventory-dependent test its own named seller, public car, active listing and necessary media. Navigate to its fixture directly; avoid finding arbitrary existing inventory or hardcoded seeded car slugs. Seed a minimal vehicle catalog fixture for the picker.
2. Replace missing-fixture skips with setup failures for mandatory scenarios. Keep the opt-in evidence recorder outside the release test inventory. Preserve production SSRF restrictions: test private-host rejection separately and exercise supported importer parsing with controlled fixtures, without opening private network access in production.
3. Scope cleanup to run-owned IDs and remove their queued receipts/search jobs or otherwise settle their lifecycle before deleting test accounts. Failed cleanup must be visible and must not create unrelated worker failures in later tests.
4. Produce and visually review Linux snapshots on the CI browser/runtime. Keep platform-specific baselines where necessary; do not copy macOS images and declare them validated.
5. Report required test names/counts and unexpected skips, not only whether the suite command ran. Make deliberate SQL failures, absent integration configuration and unexpected mandatory skips fail the release gate. Correct CI summaries to distinguish stub browser coverage from actual Stripe API and provider-connected browser coverage.
6. Prevent overlapping runs from modifying the same disposable fixtures/environment; use unique run namespaces and environment-level serialization where necessary. Configure required branch/release checks after the gate is proven.

**Acceptance:** the eight seed-dependent skips (seven mobile and one catalog) execute successfully on an empty isolated database; all remaining exclusions have explicit reasons. A missing mandatory fixture/secret fails the release gate. Two consecutive runs leave no orphaned run-owned jobs and pass on Linux with reviewed visuals.

## B02 — Provision isolated staging and hosted CI

**Maps to:** A01, A08, A09, A16. **Dependencies:** none for setup; B01 for final gate proof. **Owner:** engineering with account owner for service access.

1. Inventory existing hosting, Supabase, Stripe test, email and monitoring access. Reuse suitable existing services. The prior authorization covers setting up a test environment; do not infer authorization to enable live payments or silently select a paid service tier.
2. Create a dedicated staging Supabase project and staging application deployment with a canonical HTTPS origin. Use synthetic users/data, Stripe test credentials, separate webhook signing secrets and a test Connect configuration. Never copy live secrets into staging or point destructive tests at production.
3. Configure actual SMTP to controlled test inboxes, an error-reporting project and an independent alert destination. Restrict outbound test email to approved recipients. Store secrets in deployment/GitHub secret stores and keep browser-visible keys distinct from service credentials.
4. Validate startup configuration, redirect allowlists, MFA settings, CSP and trusted proxy behavior. Ensure deployment inputs cannot accidentally inherit local stub overrides. Keep the existing stub suite as a separate test lane; introduce a provider-connected browser configuration that explicitly requires test mode.
5. Apply the new schema through the repository's migration procedure, record the project/schema version, and configure worker URLs/secrets only after compatible app code is present. Verify actual scheduled invocations, not merely cron definitions.
6. Run hosted CI against the isolated target and retain sanitized evidence. Record who controls each service, where secrets are managed and how they are rotated, without recording secret values.

**Acceptance:** staging runs over HTTPS, authenticates test users, receives a Stripe test webhook, delivers a controlled email and executes each configured worker. Hosted release CI proves its required suites ran. No test path can select the live payment key or production database by fallback.

**External inputs:** access to the hosting/GitHub/Supabase organization and the chosen email/monitoring accounts. If access or a service-cost decision is missing, continue local packages and record the specific dependency.

## B03 — Finish reservation expiry and payment state handling

**Maps to:** A02–A04. **Dependencies:** B01. **Owner:** engineering. **Surfaces:** payment provider/settlement/refund modules, checkout actions, reservation-expiry SQL and scheduled callers, order presentation.

1. Inventory every reservation release/cancellation path, including SQL cron and direct RPC calls. Define an explicit transition table for unconfirmed, processing, captured, cancelled and unknown provider outcomes. Keep fulfillment status separate from financial recovery status.
2. Before releasing an expired Stripe reservation, durably claim an expiry operation, then inspect/cancel the provider intent outside the database transaction. Re-lock and revalidate the local attempt when applying the result. Successful capture goes through settlement; confirmed cancellation can release inventory; processing or unknown outcomes remain tracked and retryable. A timeout alone must not release stock.
3. Handle attempts whose payment creation was uncertain and never stored a reference. Link this path to B04 recovery; do not assume no reference means no charge and do not blindly recreate beyond the safe idempotency window.
4. Keep late-capture compensation as defense against races. Validate the entire captured basket, then allocate fulfillment or compensation per order. Preserve replacement-buyer ownership and never refund unaffected orders or create duplicate seller obligations.
5. Return explicit settlement outcomes through callers and present unresolved/recovery states accurately. Keep saved attempt parameters immutable and preserve accepted-offer checkout behavior.

**Acceptance:** deterministic race tests cover cancellation versus capture, provider timeout, failed attempt followed by success, two buyers competing for stock, valid/expired orders in one basket, duplicate/out-of-order events and accepted-offer retries. Inject crashes before and after provider/local commits. Assert exact charged/refunded/seller-obligation balances, one provider operation per identity, and correct stock ownership after recovery.

## B04 — Make every ambiguous capture recoverable and reconciliation fair

**Maps to:** A03, A04, A09. **Dependencies:** B03's outcome contract; implement together where needed. **Owner:** engineering. **Surfaces:** `settlement.ts`, `capture-reconciliation.ts`, webhook route, `payment_requests`, recovery/admin surfaces and reconciliation SQL.

1. Extend the existing recovery model with a stable unique capture/attempt identity, reason, safe diagnostic references, status, attempts, next-check time and operator resolution audit. Unknown orders, mismatched buyer/currency/amount/order set and incomplete captures must create durable cases rather than merely log or throw indefinitely.
2. Acknowledge a webhook only after settlement or a durable recovery obligation commits. If neither can be saved, return a retryable response. Deduplicate repeated events into the same case and retain enough provider identity to reconcile without retaining unnecessary personal payloads.
3. Reconcile reference-less uncertain creations using supported provider lookup/metadata and the persisted correlation identity. If matching remains inconclusive, hold a visible unresolved case; require authoritative evidence before mapping, refunding or permitting a new payment.
4. Replace a fixed first-50 reference scan with claimed due work or a persisted cursor plus backoff. Track last attempt and oldest unresolved age. One permanent failure must not consume every batch or hide later captures.
5. Validate existing seller obligations against amount, currency, seller and source where applicable. A conflicting obligation becomes recovery work, never a silent successful replay. Use existing admin case surfaces for diagnosis/resolution rather than building a new dashboard.

**Acceptance:** unknown and deliberately mismatched test events produce one visible case; storage failure causes retry; repeated delivery cannot duplicate refunds/transfers. Seed more than two reconciliation batches with poison items and prove every eligible healthy item progresses. Recover a lost-reference creation without creating a second charge. Every acknowledged test capture has fulfilled obligations, compensation or a durable unresolved case.

## B05 — Finish email and administrator recovery

**Maps to:** A05, A06, A14. **Dependencies:** B01; B02 for external proof. **Owner:** engineering; account owner designates recovery operator. **Surfaces:** `/confirm`, receipt worker/templates, `/admin-verify`, admin guard/audit/actions.

1. Replace token consumption on email-link GET with a minimal confirmation page and an explicit same-origin POST/server action. Do not authenticate or consume the token during GET/HEAD/prefetch. Avoid third-party resources on the token-bearing page, retain no-store/no-referrer behavior, validate the destination, and remove the token from the URL after exchange.
2. Test link opening by a scanner before the recipient, legitimate first redemption, reuse, expiry and a fresh browser without PKCE cookies. Confirm receipt retries do not misrepresent acceptance as inbox delivery.
3. Verify SMTP sender configuration and delivery to controlled external inboxes, including provider rejection and delayed delivery. Record results and actionable failure/retry behavior.
4. Rehearse lost-TOTP recovery with a disposable admin and a separately authorized operator: identity verification, factor removal, session revocation, audit record and mandatory reenrollment. Retain all normal AAL2/membership requirements.
5. Inject failure after an external admin operation succeeds but before its completion audit is saved. Reconcile using the persisted operation ID/provider reference; make retry resume the same operation instead of repeating the external side effect.

**Acceptance:** ordinary link scanning cannot consume access; cross-origin redemption attempts fail; fresh-browser redemption works once in all three browsers. External delivery succeeds and failures stay visible. MFA recovery and interrupted external admin actions complete with intact authorization and an attributable audit trail.

## B06 — Prove worker health, leases and failure isolation

**Maps to:** A07–A09. **Dependencies:** B02, B03–B05 for deployed proof. **Owner:** engineering and designated operator. **Surfaces:** worker endpoints, health endpoint, queue RPCs, monitoring transport, rate limiter and runbook.

1. Set explicit batch/time budgets for each worker family. Add fenced lease renewal or checkpointed continuation where deletion, index rebuild or provider work can exceed the lease. A stale worker must not commit completion after ownership changes.
2. Verify all scheduled families appear in health reporting, including search/deletion/media work. Alert on stale execution, oldest backlog age and exhausted items; an endpoint returning 200 must not conceal a failed family.
3. Configure monitoring outside the application/worker being monitored. Derive alert thresholds from actual schedules and deadlines; document the operator and response for each failure type.
4. Run hanging/429/500 telemetry tests against a controlled transport and confirm bounded memory, response time and redaction. Validate the real proxy strips untrusted forwarded headers; test spoofing and distributed guest abuse without weakening closed-on-error checkout behavior.
5. Pause and crash workers, exceed one batch and one lease, and inject a poison item. Confirm independent alerts arrive, other families continue, and restarting drains healthy work without duplicate effects.

**Acceptance:** measured job durations fit the hosting budget or checkpoint safely; expired owners cannot acknowledge work; all healthy due jobs make progress under backlog. Actual external alerts fire and resolve. Monitoring failure does not block financial responses, and client-supplied forwarding headers cannot bypass abuse limits.

## B07 — Complete deletion, retention and export behavior

**Maps to:** A12. **Dependencies:** B06; retention decisions before destructive implementation. **Owner:** engineering; business owner approves retention policy, with qualified advice where needed. **Surfaces:** deletion worker/request RPC, account export, payment customer integration, storage/evidence policies.

1. Build one inventory of user data across database rows, staged/public/private storage, search, analytics and Stripe customer records. Record ownership, export scope, deletion/anonymization rule, retention reason and duration for each family.
2. Resolve financial/evidence retention rules explicitly. Separate public identity removal from evidence legitimately retained for counterparties. Do not invent statutory retention periods or blindly delete customer/transaction records with active obligations.
3. Complete idempotent Stripe customer cleanup where eligible and anonymize retained personal fields according to the approved policy. Recheck unresolved payments/disputes/returns/payouts atomically when accepting deletion and before irreversible stages.
4. Persist progress or bounded cleanup manifests so large jobs resume across leases and failures. Keep identity deletion last and ensure retries remain executable if the identity was removed externally. Preserve stale-token write denial throughout.
5. Verify export against the same inventory with more than one API page in each large family. Return complete scoped data or an explicit failure; exclude private counterparty fields.

**Acceptance:** large nested accounts survive interrupted storage/provider/auth cleanup and resume without omissions. Active financial obligations block unsafe deletion. Retained evidence remains accessible only to authorized parties, public identity/search results disappear, stale writes fail, and export completeness is demonstrated.

## B08 — Remediate historical public originals

**Maps to:** A13. **Dependencies:** B07 retention rules and B06 bounded job execution. **Owner:** engineering. **Surfaces:** media lifecycle/staging, storage references and a resumable backfill command/job.

1. Produce a read-only inventory of legacy public objects and every referencing field, including copied order snapshots. Classify already normalized derivatives and protected evidence; estimate work before mutation.
2. Build a dry-run manifest and a resumable, paced backfill. Decode/re-encode safe public photos through the same normalization boundary as new uploads, write a new derivative, verify it, and only then atomically remap eligible references.
3. Preserve required snapshot provenance and authorized evidence. Delete superseded public originals only after reference/retention checks and verified replacement; follow the storage/CDN's supported invalidation process. Document that prior external copies cannot be recalled.
4. Record per-object success/failure and support safe retry. Rollback may restore references to safe retained derivatives; it must not republish sensitive originals.

**Acceptance:** representative GPS/EXIF images lose metadata, retain correct orientation and render at all referenced surfaces. Interrupted runs resume; no broken references or accidental evidence deletions occur. Inventory totals reconcile to migrated, retained with reason, or actionable failures before closure.

## B09 — Finish search consistency and uncapped pagination

**Maps to:** A11, A15. **Dependencies:** B06. **Owner:** engineering. **Surfaces:** marketplace/explore indexers and providers, search worker, query modules, database triggers.

1. Audit all visibility-affecting mutations: edits, sales/removal, deletion, suspension and private/public transitions for listings, cars, posts and profiles. Ensure each enqueues every affected document family.
2. Use canonical current state with version/order protection so a delayed task cannot restore an old public document after deletion or privacy changes. Recheck authorization/visibility at read time and prevent stale search metadata from leaking private content.
3. Add bounded reconciliation/rebuild with durable cursors and health reporting. Build replacement collections and switch only after completeness checks where supported; keep canonical database search available during outages.
4. Replace candidate truncation with filtering/ranking and stable pagination that can find eligible items beyond the current cap. Keep accurate totals or explicitly non-exhaustive totals during migration, without loading an unbounded catalog into application memory.

**Acceptance:** fixtures exceed current caps and span several pages; eligible records remain discoverable with stable ordering. Commit/crash, out-of-order work, index outage/rebuild and all privacy mutations converge correctly. No deleted/private record reappears and search remains usable without Typesense.

## B10 — Finish consent-aware purchase analytics

**Maps to:** A11. **Dependencies:** B04, B06. **Owner:** engineering. **Surfaces:** analytics module, purchase settlement outbox, preferences/disclosure.

1. Define exactly which committed business transition emits purchase completion and how orders/baskets are counted. Do not count receipt delivery, browser redirects, raw webhook receipt or compensation as completed purchases.
2. Persist a minimal event with a stable deduplication ID transactionally with the qualifying transition. Preserve explicit consent context and check applicable current consent before dispatch; never infer consent from purchase, email or worker execution.
3. Retry with bounded delivery and provider deduplication where supported. If the provider cannot guarantee deduplication, deduplicate by event ID in reporting and document transport limits. Define how withdrawal affects queued events and existing retained analytics.
4. Keep product analytics off until the gate is verified. Security/financial logs retain their separate operational purpose and must not be relabeled as product consent.

**Acceptance:** no consent or withdrawn consent prevents queued product analytics delivery. Replayed settlement and transport retries do not inflate measured purchases. Events contain no payment secrets, addresses or unnecessary identifiers; outage recovery preserves correct counting.

## B11 — Finish type and accessibility coverage; verify real Stripe UI

**Maps to:** A14–A16. **Dependencies:** B01–B05; stable financial changes. **Owner:** engineering.

1. Replace remaining handwritten database schema definitions with generated schema imports; retain intentional domain aliases separately. Avoid broad casts that hide incompatibilities. Run generation against the final migrated schema and enforce a clean diff in CI.
2. Test actual modal flows with keyboard, screen reader and reduced motion, including nested modals, empty content, topmost Escape, focus restoration and scroll locking. Fix primitive behavior without redesigning screens.
3. In B02's provider-connected browser lane, exercise Payment Element and 3DS success/failure/cancel/return under enforced CSP and HTTPS. Cover member/guest, multi-seller and accepted-offer checkout, then dispatch/pickup, partial/full refund, post-transfer refund and disputes with test connected sellers.
4. Assert provider balances/operations and local ledger outcomes, not only visible success messages. Confirm stale permission/session revocation where applicable. Keep simulated webhook tests separate from evidence of actual provider events.

**Acceptance:** generated types describe all database accesses without unexplained drift. Critical dialogs pass the documented assistive-technology matrix. Actual Stripe test-mode journeys work under CSP in supported browsers, without allowing arbitrary inline scripts or duplicating financial effects.

## B12 — Rehearse upgrade, restore, load and release

**Maps to:** A16. **Dependencies:** all preceding relevant packages verified. **Owner:** engineering and designated release operator.

1. Record one release-candidate commit and dependency lockfile. Verify additive migrations on a fresh database and a representative pre-upgrade schema with synthetic data. Preserve previous shipping/fee/snapshot behavior; verify RLS/grants, invariants, advisors and type output. Never replay migration 0001 against an existing deployment.
2. Measure representative catalog traffic, concurrent checkout, image processing and worker backlog. Agree latency/error/resource and recovery budgets before the pass/fail run; record percentiles, queue-drain times and bottleneck query plans. Fix measured breaches and rerun affected scenarios.
3. Restore the database and required object storage into an isolated target with outbound jobs disabled. Validate authentication/permissions, immutable order snapshots, private evidence and queued operations. Measure actual recovery time/data-loss window against agreed objectives.
4. Reconcile restored payment operations with Stripe test state before enabling financial workers. Prove retries reuse prior operation identities rather than issuing payments/refunds twice after restore.
5. Deploy schema then compatible app code; enable schedules only when both are ready. Prepare rollback to a schema-compatible build. The incident procedure must stop new checkout while preserving safe webhook ingestion and recovery; never erase the database record of an external financial effect as rollback.
6. Run independent alert/failure recovery drills and observe enough scheduled cycles to cover each worker family, including daily jobs. Store sanitized evidence indexed by candidate commit and list every unresolved exception explicitly.

**Acceptance:** migration, restore, provider reconciliation, load budgets and alert drills pass on the candidate. Required hosted CI executes successfully, no financial discrepancy is unexplained, and an identified operator can follow the runbook. Only then make a separate live-money release decision.

## Cross-package implementation rules

- Reuse the existing stack, queues, admin surfaces and durable operation identities; avoid introducing a second payment or deletion system.
- Read the actual latest SQL definitions and installed Next.js guidance before edits. Verify current provider/Supabase documentation for implementation-specific APIs.
- Generate new migration names through the supported CLI. Preserve historical migrations and record actual applied environments; do not claim local application means hosted rollout.
- Specify service ownership, RLS/grants, indexes, deduplication, lease fencing and retention for new persistent work. Test authenticated/anonymous roles directly.
- Keep external calls outside database transactions and bridge them with durable identity, idempotency and reconciliation. Do not treat provider timeouts as definitive failure.
- Run targeted tests per change, then the complete release matrix on the candidate. A disabled feature, skipped test or missing external credential is never passing evidence.

## Decisions and access needed

| Input | Needed for | Action when unavailable |
|---|---|---|
| Hosting, GitHub and Supabase access | B02 staging/CI and B12 deployment | Continue local code/tests; record exact missing access |
| Test SMTP/mailbox and monitoring destination | B05 delivery, B06 external alerts | Use local transport tests, keep deployed verification open |
| Stripe test Connect access and webhook endpoint | B11 payout/dispute/UI proof | Continue deterministic/API coverage; do not substitute it for provider journey evidence |
| Approved retention rules and responsible operator | B07–B08 cleanup | Complete read-only inventory and dry-run plan; defer policy-dependent destruction |
| Representative load and recovery objectives | B12 measured release decision | Gather baseline measurements and propose budgets for owner agreement |

No new credentials or service purchases are requested by creating this plan. Its next execution step is B01, with B02 setup pursued as access permits.

## Execution record — first implementation batch

Baseline code commit: `25d3090` (the prior remediation was committed before this batch). This batch changes the test harness; it does not deploy application or financial changes.

- **B01 — implementing:** added explicitly isolated, run-owned discovery and catalog fixtures. Removed eight data-dependent skips. Added paginated account cleanup with checked failures and cleanup of attributable receipt/search jobs. Added a CI reporter that rejects missing execution and unexpected required-test skips; the two named production SSRF importer exclusions remain explicit. The opt-in evidence recorder is excluded from ordinary release runs. Corrected the CI provider-coverage summary.
- **B01 still open:** reviewed Linux screenshot baselines, hosted CI execution, and completion of fixture cleanup across other standalone suites. The hosted-only absence of mailbox/deletion proof now fails the required-coverage reporter instead of being silently counted as release-ready; B02 must provide a suitable test lane.
- **B02 — setup discovery:** Supabase connector access works. One organization, `n89b-dot's Org`, is available; the active `drvn-v3` project was identified but not modified or assumed disposable. Requested the required organization selection before checking staging provisioning cost. No hosted project was created and no cost was incurred by this batch.
- **B03–B12:** no new implementation in this batch. Existing phase-one safeguards remain in place.

Verification: 29 targeted Chromium tests passed twice with zero skips; the second run used the release coverage reporter. All 326 unit tests pass; TypeScript passes and lint reports zero errors/five existing warnings. [Evidence](remediation-evidence/phase-two-b01/README.md) records scope and remaining gaps. No live payment credentials, migrations or deployment settings were changed.

### B03 implementation batch — provider-aware expiry

**Status: implemented — additional verification and B04 recovery pending.** Added migration `20260905101425_provider_aware_expiry.sql` and a money-worker expiry family. Cron queues expiring orders without releasing inventory. The worker queries Stripe with bounded timeouts, settles captures, preserves processing/uncertain outcomes, and releases confirmed cancellations through a lease-fenced RPC. Orders with no persisted provider request can expire; uncertain creations without references remain held. Provider preparation and expiry serialize on order locks, and new payment creation is refused once expiry is queued.

Local verification includes unit outcomes, SQL queue/deduplication/permission/lease/reference/unknown-creation guards, a real Stripe test-mode cancellation through the worker, and full fresh-schema migration/guard execution on CI's PostgreSQL image. Evidence is recorded in `docs/remediation-evidence/phase-two-b03/`. No hosted migration or live-money deployment occurred.

Remaining B03/B04 work includes durable operator recovery for reference-less or mismatched captures, fair reconciliation scheduling, the full mixed-basket and concurrent crash matrix, and deployed scheduling proof. The security advisor also reported 28 warnings in existing functions/extensions, none on the four functions introduced/replaced by this batch; triage them before release rather than treating this as a clean database security audit.

## Execution record — remaining repository safeguards

Implemented the remaining local safeguards across B04–B11, with operational tooling for B12. This supersedes the earlier batch-status notes above; it does not declare a production release.

| Package | Repository implementation and evidence | Remaining acceptance gate |
|---|---|---|
| B01 | Run-owned fixtures, required-test reporter, reviewed Linux visuals; protected financial/audit fixtures are banned and hidden instead of violating immutable history | Final hosted CI and required branch checks |
| B02 | GitHub jobs provision their own Supabase/Auth/Storage/Mailpit; existing Stripe test key stored in Actions secrets; operational drills added | Hosted HTTPS staging, organization/cost selection, external SMTP/monitoring |
| B03–B04 | Provider-aware expiry; durable ambiguous-capture cases; reference-less lookup; fair persisted reconciliation; exact payout obligation validation | Hosted scheduling and provider-connected crash/recovery matrix |
| B05 | Scanner-safe GET plus explicit POST; admin external-operation fence; recovery epoch invalidates old admin JWTs; synthetic lost-factor reenrollment tested in three browsers | Human identity-verification procedure and external inbox delivery |
| B06 | Lease checkpoints, bounded provider concurrency/timeouts, independent worker-family results, complete health reporting and standalone monitor workflow | Real notification destination, hosting duration budget, proxy and scheduled outage drills |
| B07 | Financial blockers rechecked; Stripe Customer reference checkpointed; nested storage deletion resumes across runs; export adds owned media and safe financial projections with pagination | Approved immutable-record/evidence/provider retention and remaining subject-access sections |
| B08 | Read-only inventory, resumable 25-object normalization batches, transactional reference remapping, embedded/evidence reference protection | Approved original/CDN cleanup and hosted inventory reconciliation |
| B09 | Canonical uncapped marketplace/build/update relations, stable paging, suspension cascades, serialized index jobs, durable rebuild and ID-only orphan reconciliation | Run/reconcile the populated hosted projection before enabling the optional engine |
| B10 | Transactional consent-version purchase outbox, current-consent check, stable retry IDs, withdrawal respected across browsers | Configured-provider deduplicated reporting and retention; analytics remains off |
| B11 | Generated schema defines database access; nested sheet/dialog focus, Escape and scroll ownership fixed; MFA/keyboard browser drill passes | Manual assistive-technology sign-off and real HTTPS Stripe/3DS/Connect journeys |
| B12 | Fresh schema/type/SQL verification; isolated database and object-archive restoration; operational/load baseline tooling and runbook | Agreed load/RPO/RTO, coordinated hosted restore and provider reconciliation on release candidate |

Local evidence is indexed in [phase-two-completion](remediation-evidence/phase-two-completion/README.md). Operational procedures are in [remediation-operations.md](remediation-operations.md); policy-dependent data handling is inventoried in [remediation-data-inventory.md](remediation-data-inventory.md). The exact release gates are in [remediation-release-gates.md](remediation-release-gates.md).

Application-owned SQL functions now have explicit trusted search paths. The public-schema extension advisories remain documented for deployment review; extension-owned routines were not rewritten and non-relocatable extensions were not moved blindly.

# DRVN: completion plan for staging and production readiness

Prepared 2026-09-05 against `d6f3be6b5baa11de4b556def2fa3f877aac0bf04`, branch `codex/finish-remediation`, [PR #1](https://github.com/n89b-dot/DRVN-2/pull/1).

**Approved launch scope: a controlled beta with invited buyers and sellers.** This plan addresses DRVN's remaining defects and release evidence. It does not add features borrowed from other projects. Three GPT-5.6 reviews covered payments, operations, and UX/accessibility; the coordinating review checked privacy, repository evidence, provider guidance, and the newly identified money paths.

Implementation is underway. The [progress tracker](readiness-progress/index.html) records checkpoint completion, and the [implementation evidence](readiness-progress/evidence/2026-09-05-implementation.md) distinguishes local checks from hosted acceptance. No work package is assumed complete merely because its initial code changes pass tests.

## 1. What “10/10 for both” means

The earlier 8.5/10 staging and 7/10 production assessments were provisional engineering judgments. This follow-up found additional payment failure paths that need closure. A green CI run alone cannot establish either final rating.

| Milestone | Required outcome |
| --- | --- |
| Staging entry | A separate, guarded HTTPS environment with synthetic accounts, test payment providers, working delivery/monitoring integrations, and reproducible deployment/reset. This makes acceptance testing possible; provisioning alone does not earn 10/10. |
| **10/10 controlled staging** | Packages R01–R11 pass for one candidate: financial failure recovery, complete approved export/deletion behavior, deterministic CI, real test-mode browser/Connect flows, accessibility, external notifications, scheduled jobs, capacity, coordinated hosted restore, and rollback. Optional integrations pass their gates or are explicitly disabled and tested as disabled. |
| Production pilot entry | Staging acceptance passes; production-specific secrets, provider capabilities, access controls, backups, deployment controls, launch limits, and operator coverage pass R12's preflight. The owner authorizes the concrete invited-beta rollout. |
| **10/10 production for the invited beta** | R12 also passes: genuine pilot transactions reconcile through fulfillment and the normal clearing period, operators observe healthy scheduled operation, and all evidence matches the deployed candidate. The approved beta limits remain enforced. |

This is a dated acceptance result for a defined scope, configuration, and load envelope. It is not a promise of permanent defect-free operation or readiness for an unrestricted public launch. A mandatory failed gate cannot be offset by a high score elsewhere. No unresolved money-loss, unauthorized-access, personal-data exposure, broken critical journey, or unworkable recovery defect may pass.

## 2. Baseline to preserve

[Hosted CI run 33976840273](https://github.com/n89b-dot/DRVN-2/actions/runs/33976840273) passed on the reviewed head. Existing evidence includes 352 unit tests, 15 SQL guard suites, generated-schema parity, 10 real Stripe test API tests, local operational drills, and successful database and separate object-archive restores.

The browser result was **167 selected: 164 passed initially, one passed on retry, and two explicitly excluded importer cases**. The excluded cases conflict with intentional production SSRF defenses; they are not permission to relax those defenses. Chromium received the broader suite; Firefox/WebKit received selected critical coverage. Twenty-four focused Linux repetitions passed without retries, but do not prove every mutation is reliable.

The local 48-second database restore and byte-identical object archive demonstrate useful components of recovery. They do not prove coordinated hosted recovery or a production recovery-time objective. Likewise, the small search-RPC benchmark is not an end-to-end capacity result. Existing Stripe API tests do not cover hosted Payment Element/3DS, Connect transfers and bank payouts, post-transfer refunds, or provider-originated disputes.

Keep the implemented capture recovery, financial guardrails, admin fencing and recovery epochs, worker bounds, deletion checkpoints, search privacy, media normalization, consent handling, generated database contracts, and modal fixes. Extend their tests and repair demonstrated gaps; a wholesale architectural rewrite is not required.

The existing nine release gates remain applicable: [remediation-release-gates.md](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-release-gates.md>). This plan supplies their implementation details and additional findings.

## 3. Sequence and ownership

Role names below are assignments to make at kickoff, not claims that additional staff already exist. One person may hold several roles; money and authorization changes still need an independent review.

| Package | Work | Dependencies | Accountable role |
| --- | --- | --- | --- |
| R01 | Beta boundaries and isolated hosted staging | Organization/provider decisions | Release lead + account owner |
| R02 | Durable webhook processing and refund status | Can start immediately | Payments engineer + database reviewer |
| R03 | Transfer/reversal crash recovery | R02 contract; implementation can overlap | Payments engineer + independent reviewer |
| R04 | Deterministic CI and enforceable release checks | Can start immediately; account tier for enforcement | Engineering + repository owner |
| R05 | Explicit, complete account export | Data inventory and policy decisions | Data/privacy engineer + policy owner |
| R06 | Retention-aware deletion and historical media | Approved retention; R05 scope | Data/privacy engineer + operator |
| R07 | Real delivery, monitoring, security/admin operations | R01 | Operations + security/release lead |
| R08 | Hosted payment/provider acceptance | R01–R04; R07 alerts | Payments engineer + QA |
| R09 | Reliable user mutations and accessibility | R04; R01/R08 for provider/device checks | Frontend + accessibility QA |
| R10 | Optional integration boundaries | R05–R07 where applicable | Integration owner |
| R11 | Capacity, coordinated recovery, and staging sign-off | R02–R10 complete enough for representative drills | Operations + release lead |
| R12 | Production preflight, invited pilot, and final evidence | All staging gates pass | Account owner + release/payments/operations leads |

Run three bounded streams: money (R02/R03/R08), application/data quality (R05/R06/R09), and environment/release operations (R01/R04/R07/R10/R11). R12 is the shared final gate. Start R01 decisions and the retention inventory immediately so external dependencies do not arrive at the end.

## 4. Implementation packages

### R01 — Define and enforce the beta; build isolated staging

1. Record the supported countries/currencies, fulfillment methods, account types, invitation rules, transaction limits, and enabled integrations. Preserve current supported behavior; new countries, payment methods, or features require a separate scope decision.
2. Enforce invitation eligibility on the server for joining, selling, and buying. If guest checkout remains enabled, require an invitation credential bound to the normalized checkout email and validate it before reservation or payment; otherwise disable guest checkout and remove its entry points for beta. Cover direct API/Server Action calls and direct database writes where exposed, not just visible buttons. Define what unauthenticated browsing may show. Reject revoked, expired, reused, or unauthorized invitations without leaking member details.
3. Prepare the named Supabase organization, canonical HTTPS host, region, domain/DNS, SMTP, monitoring, object backup, and required GitHub tier choices with current costs. Use the user's existing authorization to set up testing; obtain only outstanding provider-required selections or concrete paid-service approval. **Never reset `drvn-v3` as a fixture target.**
4. Provision a dedicated test project and deployment with separate keys, Stripe sandbox/test Connect accounts, controlled mail recipients, explicit Auth redirect allowlists, Storage buckets/policies, and trusted-origin/proxy configuration. Remove implicit environment fallback. Test setup must reject production project identifiers, live payment credentials, and unapproved recipient domains.
5. Automate migrations, bounded synthetic seeding, deploy, smoke, and cleanup. Record runtime and migration versions. Keep money schedulers disabled until compatible schema/application/webhook handling is installed, then enable the test schedules deliberately.
6. Record a candidate manifest: source SHA, build digest, migration hashes, project IDs, canonical origin, feature flags, provider mode/API configuration, and responsible operator. Store secret names and references, never secret values.

**Pass:** a second operator can recreate staging from the runbook, demonstrate test-only boundaries, and exercise Auth, Storage, signed provider callbacks, and controlled delivery. An uninvited caller cannot bypass beta controls. A reset can only address the explicit disposable project.

### R02 — Make webhook acknowledgement mean durable responsibility

**Observed code gaps:** refund/dispute handlers can log unknown mappings and return; several database reads/writes ignore errors; `account.updated` catches a failed profile write and returns. Dispatch then reports success and the route marks the event processed. Recovery inserts and admin replay completion also need checked persistence. These are code-level findings; the fault-injection reproductions are work to perform, not evidence already collected. Start with [settlement.ts](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/payments/settlement.ts>), [webhook route](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/app/api/stripe/webhook/route.ts>), and [admin actions](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/admin/actions.ts>).

1. Give every handled event an explicit result: effects committed, durable recovery recorded, retry required, or intentionally irrelevant. Only the first two and an evidenced irrelevant event can be acknowledged successfully. A temporarily missing local mapping is not automatically irrelevant.
2. Check every dependent read, transition, affected-row result, recovery insert, and processed marker. On a persistence failure, retain the event as unprocessed and return a retryable response. Use the same contract for operator replay. Deduplicate recovery obligations by provider event/object identity, with transactional uniqueness rather than log-message matching.
3. Make partial multi-order application safe under replay, duplicate delivery, parallel delivery, and out-of-order events. Use atomic database transitions where local effects must commit together; protect terminal state from older events. Paginate provider collections needed for refund attribution; embedded first pages must not define the accounting truth.
4. Correct the additional verified refund-status gap: the current Stripe adapter and retry lookup treat any status except failed/canceled as refunded, and dispatch omits refund lifecycle events. Extend provider results and persistent operations to distinguish pending, requires-action, succeeded, failed, canceled, and an unknown transport outcome. Preserve the refund reference/status, failure reason, and relevant balance-transaction reference. A timeout must not become proof that no refund occurred. Subscribe to and durably process `refund.created`, `refund.updated`, and `refund.failed`, retaining charge-level reconciliation. An initially pending refund must not advance final refunded totals or seller reversal. For a later succeeded-to-failed transition, commit idempotent corrective ledger entries, restore net refund/fee aggregates as appropriate, and record an exact seller re-credit obligation if a reversal already occurred. Preserve the original history; make the customer's unresolved refund and operator action explicit. Stripe supplies both pending-to-succeeded and succeeded-to-failed scenarios. [Stripe asynchronous refund testing](https://docs.stripe.com/testing#refunds)
5. Apply the persistence contract to enabled shipping callbacks as well: the current EasyPost route permits a failed claim to proceed and does not check its processed-marker write. Prove unknown events are truly unrelated or put them into bounded reconciliation when they may precede local records.

**Pass:** inject database failure at lookup, first/middle/last effect, recovery insert, and completion; test unknown mapping followed by later attribution and concurrent/reordered replay. For asynchronous refunds, prove pending-to-succeeded settles once and succeeded-to-failed compensates once before transfer, after transfer, and after partial/full reversal. Crash around each compensation commit; no duplicate refund, reversal, or seller re-credit may occur. Every relevant 2xx has committed effects or one durable, alerted obligation. Capture request/response, event state, recovery identity, and reconciled buyer/seller/platform balances for each case.

### R03 — Close transfer and reversal recovery across process death

**Observed code gaps:** stale transfer claims do not increment `attempts`, but provider reconciliation runs only when `attempts > 0`; `setIntent` ignores database errors and affected rows. Existing transfer lookup inspects only one page and matches only order metadata. Reversals can call the provider again after success-before-local-write without first recovering the original reversal. Review [transfer-worker.ts](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/payments/transfer-worker.ts>), [refunds.ts](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/lib/payments/refunds.ts>), and the current claim function before adding a new forward migration.

1. Persist an operation identity and immutable provider-call parameters before dispatch. Track whether a call might have occurred independently of an error-attempt counter. Require checked compare-and-set writes and lease ownership before effects and completion; do not announce a transfer merely because a write was attempted.
2. Reconcile every uncertain or reclaimed transfer before creating another. Paginate lookup and match operation/order, source charge/group, destination, amount, and currency. Recover the original frozen transfer amount if refunds changed the current payable balance; process the required adjustment separately. Multiple or inconsistent matches become a single operator case, not an arbitrary first match.
3. Reconcile reversals by transfer plus operation metadata and exact amount/currency before creating another. Apply complete pagination and exact identity/parameter matching to existing refund recovery too. Separate provider failure from provider success followed by a failed local write. Check recovery creation and resolution writes too.
4. Retain provider idempotency keys as one protection, alongside persistent intent and provider reconciliation. Stripe may prune keys once they are at least 24 hours old; reusing a pruned key can create a new request. [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
5. Exercise concurrent workers, lease expiry during a call, process death immediately after provider success, failed reference writes, amount changes after a partial refund, more than one lookup page, and an unavailable provider. Simulate an expired provider idempotency cache in contract tests instead of waiting a day or manipulating live money. Any test failpoint must be inaccessible in production and require the explicit disposable project.

**Pass:** restarting each transfer, refund, reversal, capture, and admin operation produces exactly one intended external effect and correct local obligations, or leaves one visible recovery that prevents unsafe reissue. A stale worker cannot commit, a failed query cannot masquerade as “no matching operation,” and recovery does not depend on the provider retaining an idempotency key forever.

### R04 — Make green CI a dependable release signal

1. Diagnose the `explore-search` car-edit setup failure with trace, console/network output, current URL, and persisted state. Establish whether the application failed to complete or the test observed the wrong event. Replace fixed sleeps with observable completion; fix the affected application boundary if it is a user-visible failure. Do not spread the dispute transport workaround to unrelated forms without evidence.
2. Update [release-reporter.ts](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/e2e/release-reporter.ts>) to publish expected, flaky, excluded, and unexpected counts and reject any flaky or unexpected required result. Run the release lane with zero retries; diagnostic retry lanes can remain separately labeled. Preserve the two named SSRF exclusions and their controlled parser/security coverage.
3. Add bounded CI job timeouts, pinned reproducible dependencies/images, and authenticated registry pulls or a controlled mirror/cache with bounded backoff. The last run encountered Docker registry throttling; unlimited retries would conceal the problem.
4. Require typecheck, lint, unit/security tests, SQL guards, generated-type parity, clean production build, browser suite, and real Stripe API execution. Add the hosted provider/acceptance result to promotion requirements; missing credentials must fail that required lane rather than turn it into a skipped success. Keep stub and provider test reports distinct.
5. Enforce required checks/review on the private repository after the account supports them. The previous API call returned 403; GitHub documents private-repository protection on Pro/Team/Enterprise plans. Keep the repository private and verify enforcement with a deliberately failing disposable PR. Verify production deployment restrictions separately rather than assuming every environment feature exists on the selected tier. [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
6. Store sanitized successful candidate manifests and reports, with restricted diagnostic artifacts and an approved retention period. Use release artifact digests and explicit migration versions so unrelated successful runs cannot satisfy promotion.

**Pass:** two consecutive complete hosted candidate runs pass on first attempts; at least 20 targeted repetitions of the formerly flaky mutation pass, plus critical mutations in Firefox/WebKit. Counts reflect the actual expanded inventory, not a permanently hard-coded baseline. A failed/missing required check or wrong candidate digest blocks promotion.

### R05 — Complete exports with explicit field boundaries

The current export paginates and fails explicitly beyond its synchronous limit, but includes several `select("*")` projections, only sent messages and buyer-side offers, and incomplete operational/evidence sections. Row-level security does not substitute for a deliberate column-level export contract. Start with [account export](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/src/app/api/account/export/route.ts>) and [data inventory](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/docs/remediation-data-inventory.md>).

1. Create a table/field matrix for each data family: whose data it is, authorized requester, export projection, counterparty redaction, retention purpose/duration, hold rule, deletion action, provider copy, and backup treatment. Have the policy owner resolve applicable obligations; do not invent legal retention periods.
2. Replace wildcard projections with versioned explicit contracts. Complete approved recipient/conversation and seller-offer coverage, returns/disputes, private evidence, seller adjustments, transfer/refund history, order snapshot media, and relevant delivery records. Export the person's authorized data without operational secrets, raw provider payloads, unrelated counterparty information, or another person's private objects.
3. Keep short exports simple. Provide a durable bounded path for exports that exceed request/runtime/memory limits: resumable job, stable snapshot or documented cutoff, deterministic pagination, completeness manifest/counts, private archive, authenticated short-lived download, expiry, and purge. Recheck requester eligibility before delivery. A 503 at the size cap is not a complete export solution.
4. Test both sides of a transaction, an unrelated member, anonymous and expired sessions, more than 500 related rows, multiple pagination boundaries, interrupted/resumed jobs, changed rows during generation, denied/private evidence, archive expiry, and a failing section. Inspect the final archive, not only the HTTP status.

**Pass:** every inventory row has an approved included/redacted/excluded decision and an implemented access path. Export manifests reconcile to the authorized source snapshot; no partial export is labeled complete, and cross-account/private-column leakage tests pass.

### R06 — Make deletion and historical-media completion policy-aware

1. Turn approved retention rules into explicit deletion outcomes: temporarily blocked by active obligations, resumable cleanup, retained/anonymized under a named reason and review date, completed, or operator action required. A permanent immutable-FK conflict must not burn generic retries indefinitely or be presented as full erasure.
2. Preserve financial checks and append-only references. Define precisely when an active customer may access ongoing orders during a hold, when new writes stop, and when access/session revocation occurs. Scrub eligible profile/provider data while retaining only the identity necessary for justified records; do not disable foreign keys to force completion.
3. Give operators a durable case with the blocker, affected data classes, next action, responsible owner, and review/expiry date. Implement eventual anonymization/purge where policy allows. Include provider-held data, logs, analytics if enabled, and backup expiry; ensure restoration does not silently republish previously erased content.
4. Test a fresh financial hold arriving during cleanup, failure after each checkpoint, a retained audit/financial identity, eligible Stripe Customer cleanup, absent/repeated customer deletion, nested storage continuation, and recovery from an interrupted job. Validate what the user is told against what was actually erased or retained.
5. Use the existing public-media inventory/apply/resume tool on the hosted catalog. Review the exact manifest, normalize historical originals, reconcile updated references and failures, and preserve commercial/evidence media. Remove eligible originals only after approved retention and verified replacement; execute the provider's actual CDN invalidation procedure and verify the managed origin/CDN stops serving them within its documented invalidation window. Record retained and failed objects explicitly, including the limits of deletion: previously downloaded copies and third-party/browser caches cannot be recalled by deleting the source.

**Pass:** the approved policy is executable and visible in deletion status; held identities cannot retain unintended access; eligible data disappears from primary stores/public surfaces while protected records survive. Every historical-media object is accounted for as normalized, legitimately retained, or a blocking failure. An unhandled retry-exhausted case cannot count as success.

### R07 — Prove delivery, monitoring, and human recovery

1. Configure external SMTP, application error reporting, and an independent alert destination with a primary and backup responder. Exercise signup/magic link, reset/change-email, order receipt, and admin recovery delivery under the actual HTTPS origin. Verify scanner GET/HEAD does not consume a link and intended POST redemption still succeeds.
2. Test accepted, delayed, rejected, and recovered delivery. Preserve durable receipt identities and report status honestly. Redact tokens, addresses, sensitive query parameters, provider payloads, and payment details from logs/traces.
3. Account for all 14 tracked worker families: observe each enabled family under real scheduling, including at least two natural executions of each enabled daily family; prove explicitly disabled families remain inactive with no provider dispatch. Health reporting must distinguish disabled work from failed/missing schedules. Test queue age, exhausted work, stuck leases, poison work, provider timeout, and scheduler outage. Expected long holds such as seven-day clearing must not be confused with overdue runnable work.
4. Enable and validate [worker-monitor.yml](</Users/neilbarrow/Desktop/Cursor Projects/DRVN 2/.github/workflows/worker-monitor.yml>) as a secondary check. Its 15-minute schedule and current stale thresholds do not meet a five-minute critical-alert target. Add an independent faster heartbeat/uptime path, per-family expected schedules, dead-man detection, delivery deduplication/escalation, and recovery notifications. An alert generated inside the failed application is insufficient by itself.
5. Rehearse lost-factor recovery on a disposable hosted admin: documented identity verification, audited authorization, actual factor removal, denial of old JWTs at both app and RLS boundaries, fresh sign-in, and TOTP reenrollment. Keep factor secrets and captured tokens out of evidence artifacts. The interrupted financial-command drill follows R02/R03 in R08 so monitoring setup does not depend on payment acceptance.
6. Recheck hosted Auth/Storage/RLS, object authorization, job credentials, CSRF/origin handling, CSP/Stripe redirects, upload/import SSRF controls, rate limits behind the real proxy, secret exposure, and production dependency advisories. Triage remaining Supabase advisor findings with impact/owner evidence; do not blindly move managed extensions or call an unreviewed warning harmless. Read current provider guidance and installed Next.js guides before implementation.

**Pass:** actual external recipients receive expected messages and outage/recovery alerts; a named operator acknowledges and follows the runbook. Stale admin credentials fail. No unresolved exploitable critical/high finding or failed critical authorization boundary remains. Each enabled worker has observed schedule evidence and an owned failure path; each disabled family has explicit inactive-state proof.

### R08 — Execute real hosted payment and enabled-provider journeys

Add a separate provider-connected HTTPS browser configuration. The current Playwright configuration intentionally requires payment stubs and should remain a fast regression lane.

1. Under the production CSP/origin rules, cover Payment Element loading, success, decline/retry, required 3DS success/failure/cancellation/return, refresh/back, session expiry, delayed webhook, and double submission. Exercise member, invited guest if enabled, accepted offer, saved payment method if enabled, and multi-seller checkout across an explicit Chromium/Firefox/WebKit matrix.
2. Create test sellers with payable and restricted capabilities. Verify capability changes prevent/permit transfers correctly. Follow delivery and clearing into the actual platform-to-connected-account transfer. Separately inspect connected-account bank payout state: a Stripe Transfer is not proof of a bank Payout. Correct the current transfer notification so it describes funds transferred to the seller's Stripe balance, without implying bank arrival. Use the supported connected-account dashboard for bank status during beta; if DRVN promises or displays bank payout progress, add connected-account payout event handling, pending/paid/failed state, alerts, and corresponding sandbox tests before that promise ships. Stripe warns sandbox capability enforcement can differ from live accounts. [Stripe Connect testing](https://docs.stripe.com/connect/testing)
3. Execute partial/full refunds before and after transfer, pending and later-failed refunds, proportional reversal and fee/adjustment accounting, insufficient seller balance, provider-created refunds with exact attribution, and ambiguous attribution with one recovery case. Replay and reorder callbacks after each path.
4. Generate provider test disputes and winning/losing outcomes using supported Stripe test scenarios. Assert DRVN's order holds, ledger entries, seller recovery, alerts, and operator resolution. Test incomplete/refunded/multi-seller orders, not only a single untouched charge.
5. After the R02/R03 fixes, interrupt a hosted sandbox admin refund after provider success but before completion/audit persistence. The operator must recover the same fenced operation, reconcile it, and finish the audit without issuing another refund.
6. For every other enabled commercial provider, test the real staging contract and failure path. For shipping this includes label purchase/status/refund, tracking, delivery, and resulting seller adjustments. If an integration is excluded from beta, disable its server entry points and remove unreachable UI rather than claim unexecuted acceptance.

**Pass:** each case has browser evidence, provider object/event IDs, before/after local state, and exact reconciliation of buyer total, platform fees/adjustments, seller obligation, transfer, payout status, refund, and reversal as applicable. Zero unexplained differences or duplicate effects; deliberate recoveries are uniquely recorded, alerted, and resolved through the runbook. A stub result cannot satisfy this gate.

### R09 — Finish mutation reliability and accessibility

1. Inventory critical mutations across auth/MFA, cars/gallery/mods, listings/import, offers/cart/checkout, fulfillment/returns/disputes, messages/settings/deletion, and admin commands. Link each critical user journey to the code boundary and regression test; do not infer coverage from the number of tests alone.
2. Require immediate pending feedback, duplicate-submit protection, visible/announced validation and failure messages, persisted success after reload, correct navigation, and preservation of adjacent unsaved state. Test success, invalid input, expired authorization, failed server call, lost response after commit, refresh, and repeat activation. On ambiguous financial completion, reconcile status before allowing another operation; “click again” is not a safe recovery.
3. Expand automated accessibility from public pages into authenticated states, dialogs, errors, checkout, order actions, settings, and admin. Gate applicable WCAG 2.2 A/AA rules rather than only axe's serious/critical impact labels. Review moderate heading/landmark findings individually and fix applicable failures; no broad selector exclusions.
4. Test keyboard completion, nested focus restoration, focus not obscured, status announcements, reduced motion, text spacing, 200% text, 400% zoom/reflow, contrast, touch targets, and alternatives to dragging in supported themes. Target WCAG 2.2 AA for complete in-scope processes. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
5. Record manual VoiceOver/Safari on macOS and iPhone, NVDA/Chrome on Windows, and TalkBack/Chrome on Android. Every critical flow needs desktop and mobile screen-reader evidence; auth/MFA, nested dialogs, checkout/3DS, errors, and focus return need the agreed full platform matrix. Include physical-device keyboard, rotation, camera/photo upload, and touch behavior. Playwright WebKit is not physical iPhone evidence.

**Pass:** no unresolved applicable A/AA failure in the supported critical processes and no silent/stuck/duplicate critical mutation. Retain a matrix with tester, date, device/OS/browser/assistive-technology versions, findings, fixes, and recheck evidence. Automated checks alone do not establish manual accessibility acceptance.

### R10 — Close optional integration boundaries

Recommended beta default: keep product analytics and the optional external search engine disabled until their existing gates pass. This is an explicit scope choice, not acceptance of broken enabled functionality.

- **Disabled mode:** verify server/client configuration and network traces show no analytics dispatch or external search writes/queries. Verify relational search, pagination, authorization/privacy, and user-facing behavior remain complete. Remove any already-populated stale external projection under the approved policy; disabling new writes alone does not erase old data.
- **If external search is enabled:** run the existing resumable rebuild and reconciliation on the populated catalog; prove deletion/private transitions, orphan removal, queue replay, concurrent updates, more than one page/batch, outage, and relational fallback. Reconcile exact authorized document identities before switching traffic.
- **If analytics is enabled:** verify real-provider consent version/expiry, purchase-event deduplication, withdrawal during queued delivery, identifier minimization, retention and erasure, and accessible preference changes. Perform the promised provider-side deletion procedure and retain evidence.

**Pass:** each flag has an owned decision and tested behavior. Enabling either provider later requires its full gate and updates the candidate's readiness record.

### R11 — Prove capacity, restore, rollback, and staging acceptance

1. Approve the numerical targets below before the pass/fail run. Use the proposed production-equivalent service tier, region, runtime, backup configuration, and object-version process, recording any differences. Seed representative listings, conversations, orders in all financial states, protected media, and worker queues; include realistic distribution and object sizes, not only row totals.
2. Test DRVN throughput with isolated provider substitutes at documented boundaries; separately execute bounded real-provider functional scenarios in R08. Stripe discourages using its sandbox for load testing because sandbox limits differ. [Stripe rate limits](https://docs.stripe.com/rate-limits)
3. Capture database backup/restore points and separate versioned object archives with a manifest tying rows to object versions/checksums. Supabase database backups contain Storage metadata but exclude Storage API object bytes. [Supabase backups](https://supabase.com/docs/guides/platform/backups)
4. Restore into a separate hosted target with outgoing money, mail, and scheduled jobs disabled. Reapply environment-specific secrets safely; validate migrations, RLS/Auth, protected object bytes and references, immutable snapshots, and complete financial operation identities. Reconcile provider activity since the restore point before allowing any money worker to resume. Never blindly replay all locally pending operations against Stripe after restoring an older database.
5. Measure recovery from incident declaration through reconciled, safe service restoration. Record actual lost/unrecovered data and the last consistent database/object point. If an external operation cannot be reconstructed exactly, hold it for investigation rather than creating a replacement. Reapply deletion/retention tombstones so a restore does not publish erased information.
6. Rehearse application rollback against additive migrations, queued work, and existing provider events. Retain the previous compatible build. Use a forward fix where schema/state is no longer compatible; do not erase financial effects or rely on blanket down migrations.
7. Run two complete first-attempt candidate suites and at least 72 hours of staged observation, including two natural cycles for enabled daily jobs, scheduled backlog processing, delivery/alert failures, and recovery. Fixing behavior creates a new candidate; rerun affected evidence plus the final aggregate gates.

**Pass:** approved capacity and recovery targets are measured and achieved, an operator completes restore/rollback from the runbook, all R01–R10 gates are closed, and the evidence ledger is complete. This is **10/10 controlled staging**.

### R12 — Promote safely and complete production acceptance

1. Review the exact production configuration: provider/account mode, active live Connect capabilities, supported currencies/payment methods, shipping mode, verified mail domain, canonical origin, Auth redirects, secret scopes, restricted admin accounts, independent alerts, backups, feature flags, invitation/cap controls, and required-check enforcement. Reconcile older runbook examples with the final event subscriptions, actual worker inventory, selected geography, retention policy, and user-facing test/live terms; publish one authoritative release procedure. Repeat non-destructive production smoke/security checks. Test-mode success cannot establish live capability activation.
2. Capture an actual production database/object recovery point and restore it to a separate isolated target with outbound jobs disabled before opening invitations. Compare tier, encryption/access, recovery mechanism, configuration, and object-version handling against R11's representative drill. Repeat capacity/recovery measurements for material differences; an empty production restore alone cannot prove full-size RPO/RTO.
3. Present a concrete launch record for the owner's authorization: candidate digest, migration order, invited participants/limits, minimum qualifying pilot sample, actual provider costs/fees, operator coverage, production backup/restore references, rollback build, stop conditions, and staged proof. Paid-service and business/policy decisions are not inferred from this planning request.
4. Deploy reviewed additive migrations and the compatible application with new checkout and money dispatch paused. Keep safe signed webhook ingestion and durable event storage available. Verify schema, privileges, smoke paths, provider configuration, and balances before enabling schedules and opening invitations.
5. Run a small **genuine commercial pilot** with invited buyers and sellers purchasing and fulfilling real orders. Reconcile through DRVN's normal seven-day clearing period after delivery and the applicable provider payout schedule. Do not shorten production holds to accelerate evidence. Use sandbox scenarios for manufactured refunds, failures, and disputes; do not charge real payment methods merely to test. Stripe explicitly directs testing to test-mode credentials. [Stripe testing guidance](https://docs.stripe.com/testing)
6. Observe real receipts, order state, seller transfers, connected payout status, queues, and balance reconciliation. Handle any legitimate refund/return through normal policy; an artificial live chargeback or forced refund is not required for sign-off. Keep sandbox proof of those failure paths in the release record.
7. After the qualifying pilot sample completes fulfillment/clearing/payout, require at least another 24 hours of healthy scheduled operation and a clean reconciliation report. Confirm incident/support coverage, resolve unexplained recoveries, and sign the evidence record. Broader invitations remain within the approved numerical limits. If natural commercial activity has not reached the agreed sample/branch coverage, report pilot acceptance as still open rather than manufacture purchases.

**Pass:** all preflight and actual pilot evidence reconcile on the approved candidate, no mandatory gate remains open, and release/payments/operations owners sign. This is **10/10 production acceptance for the invited beta**. Until then, report the actual intermediate milestone rather than a premature final score.

## 5. Proposed beta targets to ratify

Only the invited-beta launch model has been approved. These numbers are proposed acceptance targets, not measured current guarantees or authorization to buy the necessary service tier.

| Area | Proposed target and measurement |
| --- | --- |
| Initial enrollment | Up to 100 invited buyers and 25 sellers; server-enforced enrollment/transaction controls. Owner specifies maximum order value, daily money exposure, supported regions, and when to expand. |
| Qualifying pilot sample | Proposed minimum: 5 genuine buyers, 3 sellers, and 10 fulfilled orders, covering each enabled fulfillment/payment branch and multi-seller checkout if enabled. Ratify before launch; a numerical sample does not substitute for the exhaustive sandbox failure matrix. |
| Normal load envelope | 50 concurrent active sessions, up to 10 checkout starts/minute, 10,000 representative listings; include large account histories and actual media-size distribution. |
| Capacity exercise | One hour at normal load, 30 minutes at 2× arrival rate, and a 10-minute 3× spike; minimum 1,000 measured reads and 100 checkout workflows against controlled substitutes. Record warm/cold behavior, DB saturation, worker interference, and recovery to normal load. |
| Latency/error budget | Search RPC p95 ≤750 ms, maximum ≤1.5 s; critical app requests p95 ≤2 s excluding interactive/provider time; unexpected 5xx <1% at normal load. Measure full user-flow timings separately so excluded provider time remains visible. |
| Financial correctness | Zero duplicate external operations, oversold units, or unexplained balance differences. Every uncertain outcome has one durable case and blocks unsafe reissue. |
| Worker recovery | Runnable routine queues drain within 15 minutes; induced outage backlog within 30 minutes after recovery. Long contractual holds are excluded from runnable-age calculations. Poison/stale work cannot block healthy items. |
| Alert delivery | Critical app/payment-dispatch outage alerts reach an external destination within 5 minutes; overdue jobs use per-family thresholds. Primary acknowledges within 15 minutes, then escalation. Money-moving availability requires named coverage, including overnight async jobs. |
| Email | At least 20 controlled deliveries; ≥95% reach the inbox within 2 minutes, the remainder have evidenced delivery/recovery; no duplicate receipt effects. Demonstrate rejection/delay and recovery separately. |
| Recovery point | Target ≤15 minutes of ordinary-data loss across the **combined** database and object recovery point. Select backup/object replication capable of this; daily database backups alone do not satisfy it. Account for every provider financial effect before reopening money dispatch. |
| Recovery time | Reconciled checkout/money service ≤2 hours from incident declaration; optional search ≤4 hours with relational fallback available. Measure human/provider waiting time, not only database import duration. |
| Observation | At least 72 hours staging with two natural cycles of every enabled daily family; production qualifying sample through actual delivery + seven-day clearing + applicable provider payout time + 24 healthy hours. |

Lower-cost recovery or smaller capacity targets may be chosen explicitly before testing. Record the revised scope and accept its implications; do not silently relax a failed target to obtain 10/10.

## 6. Evidence, stop conditions, and maintaining readiness

For every package retain: case ID, owner, candidate SHA/build digest, migration versions, redacted environment/provider mode, execution timestamp, command or manual procedure, expected invariant, actual first-attempt outcome, exclusions, restricted evidence location, findings, and reviewer. Use statuses **not started / implementing / ready to verify / passed / blocked**, with a concrete blocker and next action. Existing unit/SQL evidence can support a gate; it cannot substitute for a missing hosted/manual/provider result.

Final acceptance ledger:

| Existing release gate | Required packages | Status at plan creation |
| --- | --- | --- |
| Hosted staging | R01 | Open |
| Real delivery and alerts | R07 | Open |
| Stripe browser and Connect | R02, R03, R08 | Open; additional code fixes identified |
| Retention and deletion | R05, R06 | Open; policy and engineering both needed |
| Historical originals | R06 | Open |
| Populated search projection | R10 | Open if enabled; disabled-mode proof still needed |
| Accessibility | R09 | Open |
| Recovery and capacity | R11 | Open |
| Hosted release checks | R04, R11 | Current CI green; stronger acceptance/enforcement open |
| Production invited-beta acceptance | R12 | Open |

Immediately pause new checkout and affected money dispatch for a duplicate financial effect, unexplained balance discrepancy, or authorization/private-data breach. Also stop expansion for two missed required worker cycles, an overdue critical queue beyond the budget, sustained unexpected 5xx >2% for five minutes, or latency above twice its budget for 15 minutes. Preserve event ingestion where safe, retain evidence and operation identities, and reconcile before resuming. A compatible rollback or forward fix follows the rehearsed procedure.

After launch: review financial reconciliation, runnable queues, failed delivery and recovery cases daily; review access/advisories/dependencies regularly; rehearse hosted restore at least quarterly and after material recovery changes. Rerun relevant gates when changing payments, schema, Auth/RLS, provider configuration, retention, or launch limits. Incident evidence can invalidate acceptance until the defect is resolved.

## 7. Decisions, delegation, and estimate

Decisions needed during execution:

- **Account owner:** Supabase organization/project selection; concrete hosting/SMTP/monitoring/backup/GitHub tier costs; domain access; live provider onboarding and final rollout authorization.
- **Business/policy owner:** launch regions/currencies/fulfillment, invitation and money-exposure caps, retention/hold/export rules, user-facing privacy/support text, and operator coverage. Obtain qualified policy advice where the applicable obligations are unclear; engineering does not invent retention law.
- **Release/operations owner:** ratified capacity/latency/RPO/RTO targets, primary/backup responders, evidence retention/access, and exact promotion/stop procedure.

Use GPT-5.6 agents for bounded implementation/test work: CI/reporter fixes, explicit export projections, deterministic browser fixtures, media/search inventory tooling, monitoring/runbooks, and regression cases for a specified payment invariant. The coordinating engineer owns cross-package contracts, migration/deployment ordering, and release evidence. Financial state-machine changes, immutable-retention behavior, and authorization changes require an independent review; an agent's report is not human accessibility sign-off, provider approval, or business authorization.

Planning allowance: **approximately 40–65 engineering days total across parallel streams, plus 8–15 accessibility specialist days for the stated device/process matrix and rechecks, and operator participation**. With two to three engineers/agents supported by QA and the account owner, allow roughly **4–7 calendar weeks to fully validated staging after access and policy decisions are available**. Budget a separate **2–3 or more calendar weeks from pilot entry to production acceptance**, depending on genuine order volume, fulfillment, seven-day clearing, and provider payout timing. That suggests roughly **6–10 or more weeks overall**, not a deadline. This includes overlapping work, not the sum of duplicated sub-review estimates. Substantial reproduced defects or provider delays can extend it; additional agents cannot remove the commercial observation period.

The first implementation slice is **R02/R03 financial failure reproductions and fixes, R04 release-signal repair, and R01 environment/decision preparation**, with the R05 policy inventory started alongside them. Finish code and reviewable setup proposals before requesting any remaining concrete service or rollout approval.

This document is the implementation plan. No new remediation code, paid provisioning, production migration, deployment, live transaction, or final readiness claim was performed as part of preparing it.

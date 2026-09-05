# DRVN production readiness and GitHub adoption report

Reviewed September 4, 2026 (America/New_York). Repository: [n89b-dot/DRVN-2](https://github.com/n89b-dot/DRVN-2). Revision: `f6cf0a90b027424c7f1564e9fba499a21543fd7b`, identical locally and at GitHub HEAD when checked.

## Decision

**Do not open unrestricted live-money checkout yet.** DRVN has a credible product architecture and substantial implemented functionality, but payment recovery, guest order access, and release verification have concrete gaps. The appropriate next investment is a focused reliability release followed by an instrumented, invitation-only pilot.

Keep the Next.js/Supabase architecture and the Livesheet design system. A framework replacement, microservices migration, or generic marketplace template would introduce considerable migration work while leaving the important defects unresolved.

This assessment supersedes the old readiness reports for the areas examined. Several earlier findings have been fixed: orders, fulfillment, returns, saved searches, Connect transfers, disputes, account deletion, and an admin console exist. Earlier documentation also understates newer database admin checks. Their presence does not establish that every path is operationally verified.

## Scope and evidence

The tracked inventory contains 472 files under `src`, 57 SQL migrations, 44 E2E-related files, 33 documentation files, 66 pages and 20 route handlers. I surveyed the repository structure and reviewed representative implementations across authentication, commerce, payments, shipping, returns, guest access, database guards, administration, import security, media, search, analytics, UI primitives, SEO, CI and operations. High-risk money and authorization paths received deeper tracing.

This is a repository-wide, risk-based engineering review, **not a claim of line-by-line verification of every file**. No live database security scan, production configuration audit, browser journey, accessibility certification, load test, real Stripe transaction, or restore rehearsal was performed. There was no clearly isolated test database established for running mutation-heavy E2E suites. The local production startup attempt failed its configuration guard, so design recommendations below are based on code and project references, not a newly completed visual audit.

The working tree was clean initially. This review adds the report and evidence files only; I did not change application code or infrastructure. Unrelated password-field/authentication UI and component-documentation edits appeared in the shared workspace by the final check. Those later uncommitted edits were preserved and are outside the reviewed GitHub revision and recorded test results.

| Check | Result | Interpretation |
|---|---|---|
| Local versus GitHub HEAD | Match | Report applies to the current GitHub revision |
| `npm run typecheck` | Pass | Type-level consistency |
| `npm run lint` | Pass, 8 warnings | No lint errors; minor cleanup remains |
| `npm test` | 43 files, 309 tests passed | Existing local unit and structural checks pass |
| `npm run build` | Pass | Next.js production compilation succeeds |
| `npm run start -- -p 3107` | Instrumentation fails: missing `SENTRY_DSN` | Current local configuration cannot serve the production app; not evidence about deployed secrets |
| `npm audit` | 4 high-severity package entries | Development dependency findings; includes transitive propagation |
| `npm audit --omit=dev` | 0 reported vulnerabilities | No production-tree advisories reported by this audit, not proof of no vulnerabilities |
| Latest GitHub CI | Failure | Admin SQL guard fails; later SQL guards skip |
| GitHub E2E and Stripe tests | Skipped | Job-level success is not executed test coverage |
| Isolated failure probes | 3 behaviors reproduced | Settlement and admin audit control-flow defects, with mocked dependencies |

The latest [GitHub run](https://github.com/n89b-dot/DRVN-2/actions/runs/33709180641) successfully applied all migrations and passed the purchase guard. The admin guard then raised `FAIL: is_admin() false for admin member`. Security, money and import guard steps did not execute afterward. Both secret-gated integration jobs skipped their actual test steps. The six most recent CI runs listed during this review all had failure conclusions; only the latest failure was investigated in detail.

Evidence is saved under `docs/review-evidence/2026-09-04`: GitHub job/step results, full and production-only dependency audits, and an executable isolated probe. Run the probe from the repository root with `node docs/review-evidence/2026-09-04/control-flow-probes.cjs`. It transpiles current modules and substitutes in-memory dependencies; it never contacts a database or payment provider.

## What is already worth preserving

- **Product differentiation:** source-car provenance, seller-stated condition and fitment, and build histories provide a coherent reason to use DRVN beyond ordinary classified listings.
- **Database-centered commerce:** reservations, terminal-state guards, commercial snapshots, refund operations, transfer leases and recovery queues are substantial foundations. Extend their guarantees rather than replacing the ledger.
- **Provider boundaries:** Stripe, shipping, search, analytics and notifications have identifiable integration seams. Postgres remains canonical when an optional search engine is used.
- **Access controls:** request-level admin checks, database RLS, private dispute evidence, and the migration 0040 actor assertion are meaningful defenses. Membership is separate from editable public profiles.
- **UI investment:** shared components, documentation checks, Storybook stories, responsive/E2E specifications, loading and error boundaries, and reusable listing/order presentation already exist.
- **Importer defenses:** the HTTP fetch path validates actual connect-time DNS addresses, rechecks redirects, and limits decompressed response sizes. Preserve that stronger path when improving rendering.

## Findings, in remediation order

Priorities: **P0** means a live-money launch blocker; **P1** means resolve before public launch or explicitly disable the affected capability; **P2** means schedule for the pilot or immediately afterward. Confirmed control flow is distinguished from production behavior that still needs an integration test.

### R1 — P0: successful payment can leave a cancelled order without compensation

**Evidence:** [settlement handler, lines 93–128][settlement]; [finalization and reservation expiry][finalize].

The reservation sweeper cancels expired pending orders and releases inventory. `purchase_finalize` correctly refuses to move a terminal order backward and returns JSON containing `applied: false`. However, `settleIntent` checks only the RPC `error`; it ignores that result. A successful PaymentIntent arriving after cancellation is consequently treated as applied, and `purchase_completed` is emitted. The cancelled order gets no transfer intent, and this branch creates no refund/recovery operation.

**Reproduced:** an isolated call with a successful Stripe intent and a cancelled order returns `true`, emits the completion event and creates no payout intent. This proves handler behavior; the timing scenario still requires a real test-mode integration test. Stripe documents that some payment methods can remain processing for days, so a 15-minute inventory reservation is not a universal payment deadline. [Stripe payment status documentation](https://docs.stripe.com/payments/payment-intents/verifying-status).

**Fix:** handle `applied`, reason and current state explicitly. When payment succeeds for inventory that has been released, durably initiate compensation or create an actionable recovery case before acknowledging completion. Coordinate expiry with PaymentIntent status; restrict enabled payment methods until their lifecycle is supported. Never simply resurrect an order whose inventory may have sold again.

**Acceptance:** expire checkout A, reserve its listing for B, deliver A's success webhook; A must receive exactly one durable refund/recovery outcome, B's inventory must remain correct, and repeated events must not duplicate effects.

### R2 — P0: payout intent creation can fail while the webhook acknowledges success

**Evidence:** [createTransferIntent and settleIntent][settlement], plus [webhook acknowledgment][webhook].

`createTransferIntent` logs non-duplicate insert errors and returns normally. `settleIntent` therefore remains successful, and the webhook returns 200 and marks the event processed. A paid order can be missing the durable queue row needed to pay its seller. The worker's reconciliation repairs existing intent/order transfer references; it does not backfill every paid order lacking an intent.

**Reproduced:** a simulated transfer-intent insert failure still returns successful settlement.

**Fix:** make finalization and payout-intent creation atomic where possible. Otherwise propagate retryable failure, preserve durable recovery state, and add an invariant sweep for paid orders with no payout obligation. Replay should repair legitimate paid/shipped/delivered orders, not depend solely on `status === 'paid'`.

**Acceptance:** inject an insert failure after payment finalizes; webhook delivery must retry or leave a durable recovery record, and the seller must eventually have exactly one correct payout obligation.

### R3 — P1: guest order email is not sent, and Stripe checkout bypasses the call

**Evidence:** [guest buyer helper][guest], [checkout action][checkout], [Stripe return route][return-route].

`sendOrderAccessLink` calls `auth.admin.generateLink`, discards its generated data and never invokes an email sender. Supabase explicitly describes this API as generating links for a custom email provider. Separately, `checkoutCart` returns early for asynchronous payment confirmation before reaching this function. Neither the settlement handler nor return route supplies the missing guest email dispatch. [Supabase generateLink documentation](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).

A guest can pay and see an immediate receipt in the originating browser but does not receive the promised durable way back to manage the order. Existing guest E2E tests inspect account/order creation; they do not prove mailbox delivery and link redemption.

**Fix:** enqueue order-access delivery from authoritative successful settlement, deduplicated by order/payment and recipient. Send through a real provider or an appropriate Supabase sending API. Use a configured canonical origin, retry delivery, expose resend, and distinguish transactional notices from marketing preferences.

**Acceptance:** a real Stripe test-mode guest purchase produces a delivered email whose link opens the correct order in a fresh browser. Duplicate webhooks send no duplicate receipt. Delivery outages remain visible and retryable.

### R4 — P1: retries reuse a Stripe key but change the request parameters

**Evidence:** [checkout action][checkout], especially lines 232–242 and 901–911; [Stripe adapter][stripe].

Each attempt creates a fresh `correlationId` and includes it in PaymentIntent metadata, even when the idempotency key is reused. Stripe compares parameters on retries and rejects a reused key with changed parameters. The adapter converts that error into an ordinary failed payment, which can release an existing order even though a prior intent exists. This is a source-traced failure path, not a Stripe API reproduction. [Stripe idempotency contract](https://docs.stripe.com/api/idempotent_requests).

Also, `purchase_begin` retrieves prior attempts solely by a globally supplied idempotency key; the lookup does not verify `buyer_id`. This should be scoped to the principal and immutable basket parameters, even though random-key guessing is not a demonstrated attack.

**Fix:** persist correlation identity and provider reference on the first attempt; reuse identical parameters or retrieve the existing intent. Bind attempts to authenticated identity or a server-issued guest checkout capability and a basket hash. Distinguish an uncertain provider outcome from a definitive failure.

**Acceptance:** duplicate submit, lost response and retry resume one unchanged intent; attempts from another identity cannot reuse the original result.

### R5 — P1: release validation is failing and important suites are absent

**Evidence:** [latest CI run](https://github.com/n89b-dot/DRVN-2/actions/runs/33709180641), [workflow][ci], SQL test fixtures.

Resolve the failing admin guard before treating the database as verified. Its failure may be a fixture/auth shim mismatch rather than a production authorization defect: the shim's fallback `auth.uid()` reads `request.jwt.claim.sub`, whereas the admin fixture writes `request.jwt.claims`. That is an investigation lead, not an established root cause.

The workflow does not invoke the existing `snapshot_guard.sql` and `return_guard.sql` suites. E2E and Stripe tests skip when secrets are absent; job-level success obscures this in summaries. Playwright currently runs `next dev`, with Chromium only, rather than exercising the production server.

**Fix:** run every relevant SQL guard independently, repair the auth fixture contract, preserve failure output, and make executed integration tests mandatory for release approval. Use a dedicated Supabase test project, Stripe test keys, production-server journeys, and WebKit/Firefox coverage for checkout and dialogs. Surface explicit `ran/skipped` outputs in CI. Verify branch protection separately; it was not inspected.

**Acceptance:** same release revision passes all SQL guards, browser guest/member flows, and Stripe failure/retry/refund/transfer scenarios. A missing mandatory secret fails the release gate.

### R6 — P1: admin mutation and audit are not atomic

**Evidence:** [auditedAction][audit].

The callback mutates first; `writeAudit` executes afterward in a separate request. An audit outage therefore leaves a real mutation without its audit record, while returning “action aborted.” This contradicts the helper's stated guarantee and encourages unsafe retries.

**Reproduced:** the mutation remains applied when the audit insert fails.

**Fix:** for database-only actions, perform authorized mutation plus audit in one transaction/RPC. For provider operations, create a durable operation record first and append outcomes through the existing idempotent recovery workflow. Return an accurate partial/recovery state. Migration 0040's actor assertion is useful, but an app-called assertion is not a universal database prohibition on every service-role mutation.

**Acceptance:** an audit-write failure rolls back a database action or leaves an identifiable provider operation that recovery can complete safely.

### R7 — P1: monitoring can block money endpoints and silently lose reports

**Evidence:** [monitoring transport][monitoring], [webhook][webhook], [client intake][intake].

The custom Sentry transport has no explicit request timeout and does not check HTTP response status. `flushMonitoring` waits for all pending sends, including from webhook/worker `finally` blocks. A slow telemetry endpoint can consume a money endpoint's execution window; a 429 or 500 is treated as successful delivery. Browser intake parses the entire JSON body before truncating fields and has no explicit route-level rate limit or streamed byte cap.

**Fix:** bounded transport and flush deadlines, HTTP failure handling, validated configuration, rate-limited/size-limited intake, and a monitored synthetic error. Evaluate the official Sentry Next.js SDK for source maps and tracing; verify its compatibility with this installed Next version before switching. Telemetry availability must not determine transaction availability.

**Acceptance:** hanging or rejecting telemetry does not exceed the webhook response budget; operator tests prove useful stack traces actually arrive.

### R8 — P1: automated money operations can start without a working scheduler

**Evidence:** [environment validation][env], [worker endpoint][worker].

Missing `CRON_SECRET` and `ADMIN_ALERT_WEBHOOK_URL` produce warnings rather than a hard launch failure. Without the cron secret, the worker refuses requests; this affects transfers, refund resume, return timers and dispute processing. Live scheduler configuration and monitoring were not inspected.

**Fix:** make automated-worker readiness a launch prerequisite, with an independent last-success/queue-age alarm. Confirm database job configuration, deployment URL, secret rotation, concurrency limits, and worker runtime capacity. Prove a restore of database and necessary storage and record recovery time/data-loss targets.

**Acceptance:** fail or pause the worker and receive an actionable alert; resume and drain correctly. Execute the documented restore procedure in an isolated environment.

### R9 — P1 when browser importing is enabled: DNS protection is weaker than HTTP importing

**Evidence:** [browser renderer][renderer] and `safe-fetch.ts` beside it.

The renderer resolves a hostname, caches the allow verdict, then lets Chromium resolve/connect independently. The validated address is not pinned to the browser connection. This leaves a DNS-rebinding gap that the HTTP fetcher deliberately closes. The route check also does not enforce the HTTP fetcher's equivalent port/credential policy. This is a source-level risk, not a network exploit reproduction; it is conditional on the rendering flag.

**Fix:** keep browser rendering disabled until it runs behind enforced public-only egress/proxy isolation, with subresource limits, service-worker restrictions and a total execution/resource budget. A second JavaScript DNS lookup alone is insufficient.

**Acceptance:** redirects, rebinding, subresources and private-network targets all fail at the network boundary, while allowed public pages still render.

### R10 — P1 before public acquisition: checkout abuse and admin session assurance

**Evidence:** [checkout action][checkout], [rate limiter][limiter], [admin guard][admin-guard].

Guest checkout resolves/creates accounts and reserves stock without a checkout-specific `allowAction` call. Most existing action limits fail open on limiter errors. Database authorization prevents many forbidden writes, but it does not prevent repeated legitimate-looking reservations or account creation. No admin MFA/assurance-level gate was found in the application.

**Fix:** add layered checkout/reservation limits, bounded active attempts, bot controls when warranted, and explicit failure policy for expensive operations. Review direct Data API write access because app-level limits do not cover direct client writes. Require stronger session assurance for admin money actions, plus reauthentication for especially sensitive actions.

**Acceptance:** an anonymous actor cannot continuously monopolize inventory or create accounts at an unbounded rate; low-assurance admin sessions cannot refund or change operational settings.

### R11 — P2: telemetry and search synchronization are lossy

**Evidence:** [analytics][analytics], listing search indexing, and the `void sync*ToSearch` call sites in sell/garage actions.

Product events and index updates use unawaited fetch work. A serverless invocation can end before completion. Analytics ignores non-2xx responses and puts every unidentified visitor under `anonymous`, making distinct visitor funnels unreliable. A stale index can omit real listings even when its stale positives are filtered correctly against the database.

**Fix:** use framework-supported post-response execution for expendable events, and a transactional outbox/retry worker for required notifications and index updates. Deduplicate authoritative purchase events. Add a privacy-appropriate anonymous-session strategy before publishing conversion metrics; otherwise report aggregate anonymous events only. Test index outage, rebuild, deletions and visibility changes.

### R12 — P2, before enabling analytics: privacy promises and retention need alignment

**Evidence:** [privacy page][privacy], analytics, guest receipt cookie, account deletion, media uploader.

The privacy page promises to ask before adding analytics; `POSTHOG_KEY` enables server events without a corresponding user preference gate. Resolve this product/policy mismatch before enabling it. This is not a jurisdiction-specific legal conclusion.

The guest receipt is HMAC-signed but has no timestamp inside the signed payload; the six-hour lifetime is browser cookie metadata, not server-verified expiry. Account deletion lists storage without pagination, ignores storage deletion errors, and signs out after deleting the auth user. Public-image normalization sometimes preserves original EXIF or returns the original after an error, so it is not a guaranteed GPS-removal boundary.

**Fix:** align disclosures and tracking behavior, enforce signed receipt expiry, make deletion durable/paginated with a clear retained-record policy, revoke relevant sessions, and normalize public uploads server-side if location stripping is promised. Preserve private dispute evidence according to its separate retention policy.

### R13 — P2: dependency and browser security hygiene

**Evidence:** saved npm audit results and [Next configuration][next-config].

The four high-severity package entries are `browserslist`, `image-size`, `vite-plugin-storybook-nextjs`, and `@storybook/nextjs-vite`; several entries describe the same transitive chain. The production-only audit reports zero. Upgrade the development chain deliberately and verify Storybook instead of using a blind force-fix.

Production CSP includes both `unsafe-inline` and `unsafe-eval`. The installed Next documentation explicitly says `unsafe-eval` is unnecessary in production. Remove it there and evaluate nonce/hash-based script policy with actual Stripe and caching tests. The privileged Supabase admin client lacks an explicit `server-only` import despite its server-only comment; add the build-enforced boundary.

### R14 — P2: maintainability, UI confidence and scale budgets

**Evidence:** commerce action module, search providers, sitemap, dialog primitive, test configuration and README.

Split the roughly 1,900-line commerce action module by checkout/offers/messages/disputes, preserving public action contracts. Generate database types from the verified schema and detect drift. Update the README's obsolete migration range and coverage/feature claims. Keep migration deployment controlled; migration 0001 is destructive and the repository explicitly warns against blindly applying it to an existing database.

The custom modal supports focus cycling but does not establish a robust background-inert/nested-modal model. Reuse a proven accessibility primitive under existing styling and test screen-reader/focus behavior. Candidate caps in search and the sitemap's 1,000-per-entity cap require larger-catalog tests; bounds protect resources but can hide results. Add query plans and representative data tests before choosing a new search/database architecture.

Establish measured budgets for checkout latency, image weight and Core Web Vitals. There are no new field-performance measurements in this review, so no numerical performance score is justified.

## GitHub projects worth adopting or learning from

I evaluated 12 repositories through current GitHub metadata, project documentation/READMEs and selected relevant implementation paths. This is a fit assessment, not a comprehensive audit of those projects. All 12 were non-archived when checked. Most showed August/September 2026 pushes; Lighthouse CI's last reported push was March 27, 2026. Push activity is only a maintenance signal, not proof of release quality or security.

The effort bands below are engineering estimates for a focused first integration: **small** approximately 1–3 engineering days, **medium** 3–7, **large** more than a week. They exclude procurement, provider approval and production validation delays. Do not sum them into a promised launch date.

| Project | Specific value for DRVN | Recommendation and integration point | Effort / tradeoff |
|---|---|---|---|
| [React Email](https://github.com/resend/react-email) | Responsive transaction email components and previews | **Adopt early.** Build order access, receipt, shipping, return and dispute-action templates; send through an actual delivery provider behind a durable outbox. Templates alone do not fix R3. | Small–medium; MIT; email delivery and bounce handling remain separate work |
| [Sentry JavaScript SDK](https://github.com/getsentry/sentry-javascript) | Maintained Next.js instrumentation, source-map/error tooling | **Evaluate early.** Replace or strengthen the bespoke transport at `monitoring.ts`; correlate checkout, webhook and worker errors using persisted IDs. | Small–medium; MIT SDK; check Next 16.2.12 compatibility and data scrubbing |
| [PostHog](https://github.com/PostHog/posthog) | Funnels, retention, feature flags and experiments | **Complete the existing integration.** DRVN already has a capture seam. Add dependable event delivery and three decision-focused dashboards before adding replay or experimentation. | Medium; core license has enterprise exceptions; hosted use and self-hosting have different operating burdens |
| [TanStack Table](https://github.com/TanStack/table) | Headless selection, sorting/filtering and data-grid behavior | **Adopt selectively for admin.** Build one shared ledger with server pagination, saved filter URLs, selectable columns and clear bulk-action outcomes; start with payments/cases. | Medium; MIT; keep authorization and large-table queries server-side |
| [Radix Primitives](https://github.com/radix-ui/primitives) | Mature modal focus scope, dismissal layers and hidden-background handling | **Adopt underneath Livesheet.** Replace the internals of dialog/sheet controls while preserving their visual language and public component API. | Medium; MIT; animation and nested-dialog regression tests required |
| [Typesense](https://github.com/typesense/typesense) | Typo-tolerant discovery and configurable search behavior | **Use the existing adapter only when measured need justifies it.** Fix synchronization and query evaluation first. Maintain strict identifier matching and honest fitment claims. | Medium; server GPL-3.0; evaluate exact client/server distribution separately; memory and operational cost |
| [Graphile Worker](https://github.com/graphile/worker) | PostgreSQL-backed background work and task execution | **Borrow the transactional enqueue pattern now; adopt the runtime conditionally.** Email and search outboxes fit naturally. Keep current refund/transfer state machines as business truth. | Medium–large; MIT; needs a running worker process and pooled DB planning; avoid duplicating two schedulers |
| [Medusa](https://github.com/medusajs/medusa) | Commerce workflow decomposition and an extensive order workflow reference | **Study, do not replace DRVN's commerce engine.** Borrow explicit workflow steps, compensation and operator outcomes for returns/fulfillment. Review the [order workflow directory](https://github.com/medusajs/medusa/tree/develop/packages/core/core-flows/src/order/workflows). | Medium to extract a pattern; large migration avoided; MIT core with enterprise exclusions |
| [Novu](https://github.com/novuhq/novu) | Multichannel notification workflows | **Defer until orchestration is needed.** DRVN's current one-channel seam plus transactional email can remain simple. Reconsider for digest scheduling, channel fallback and substantial preference workflows. | Medium–large; MIT and enterprise package boundaries; verify files/features selected |
| [Immich](https://github.com/immich-app/immich) | Photo-centric browsing and asset interaction reference | **Borrow UX ideas.** Explore date-grouped build updates, selection mode, upload progress and keyboard photo navigation; adapt to vehicle histories. Study its [asset components](https://github.com/immich-app/immich/tree/main/web/src/lib/components/assets). | Medium; AGPL-3.0; recommend independently implementing interaction ideas rather than copying source |
| [Gitleaks](https://github.com/gitleaks/gitleaks) | Secret detection in repository history and CI | **Adopt early.** Add redacted history and pull-request scanning, narrow reviewed allowlists, and a documented credential-rotation response. Current `.env.local` is untracked, but history was not comprehensively scanned here. | Small; MIT CLI; check chosen GitHub Action terms separately |
| [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) | Repeatable frontend performance regression checks | **Adopt for a small production-build page set.** Track public marketplace, listing and exploration pages against stable fixtures; pair with real-user vitals after launch. | Small–medium; Apache-2.0; synthetic results vary and do not replace device testing |

License observations come from repository license files/metadata inspected during the review. PostHog and Medusa top-level files explicitly distinguish core from enterprise material; Novu exposes separate MIT and enterprise files. This table is not permission to copy every directory. Preserve notices and check the exact package/license at adoption time.

### The highest-value product improvements

**1. A trustworthy post-purchase experience.** Build on the existing order and return pages: reliably deliver order-access email, show the next action and deadline, make delayed payment/recovery states intelligible, and make support entry obvious. This directly addresses a current failure instead of adding another feature surface.

**2. An admin exception workbench.** Reuse current cases, payment recoveries and audit records. Give operators saved views for paid-without-payout-intent, aged refund operations, undelivered receipts, overdue seller actions and stale workers. Add ownership, queue age and correlation links. Money actions need previews, reasons, appropriate session assurance and durable outcomes. TanStack Table is useful here without imposing a new visual design.

**3. A focused analytics layer.** Build three dashboards from actual events and database measures: activation (vehicle added → update published or listing published), marketplace conversion (search → listing consideration → checkout → paid order), and transaction health (dispatch, delivery, returns, refunds, recovery age). Existing taxonomy lacks some funnel observations; add only what answers a concrete decision. Compute financial totals from the ledger, not analytics events. Distinguish counts of events from counts of visitors and successful orders.

**4. Better discovery evaluation.** Establish a curated test set of OEM numbers, alternate part identifiers, typos, broad descriptions and vehicle-filter combinations. Measure zero-result rate and successful matches. Improve the existing Postgres/Typesense seam using those results. Keep “seller stated” and “potential match” qualifiers. An open-source engine does not supply authoritative fitment data.

**5. More usable vehicle histories.** Use Immich as an interaction reference for photo navigation, batch selection and upload feedback. Use DRVN's existing activity/build-evolution components to offer a chronological history with source-part links. Preserve the provenance-led presentation instead of importing an unrelated dashboard theme.

**6. Accessible interaction internals.** Move repeated difficult behavior—focus management, layered dialogs and keyboard dismissal—into proven primitives. Preserve Livesheet tokens and layouts. Validate on mobile Safari, reduced motion, keyboard-only use and a screen reader before calling the redesign complete.

Avoid adding a second analytics platform, another search engine, a separate admin application, a new notification orchestrator and a replacement commerce framework at the same time. Each creates a new operational dependency. Adopt the smallest addition that closes a demonstrated gap.

## Delivery plan and launch gate

| Phase | Work | Exit criterion |
|---|---|---|
| 1. Transaction correctness | R1–R4; durable receipt delivery; recovery invariant tests | Paid money always maps to fulfilled obligations or tracked compensation, across retries and late events |
| 2. Release and operations | R5–R10; telemetry deadlines, audit durability, scheduler monitoring and staging configuration | Executed release suites pass; operator alerts and recovery procedures are demonstrated |
| 3. Controlled pilot | R11–R14; minimum dashboards; browser/accessibility/performance measurements | Invited buyers and sellers complete representative transactions and support can resolve exceptions |
| 4. Measured improvements | Admin table, gallery/history UX, search tuning and optional richer notifications | Each addition has a concrete user or operational outcome and a regression check |

Before public live-money launch, retain evidence for all of these:

- [ ] R1/R2 failure injection passes against a real isolated database and Stripe test mode.
- [ ] Retry identity, parameters, ownership and compensation are verified.
- [ ] Guest receipt is delivered and redeemed in a fresh browser.
- [ ] All relevant SQL guards execute and pass, including snapshots and returns.
- [ ] Member/guest purchase, refund, return, pickup and seller payout scenarios execute on the release build.
- [ ] Production configuration boots; Stripe modes/keys and supported methods match the intended environment.
- [ ] Worker heartbeat, oldest-item alerts, receipt failures and payment recoveries reach a responsible operator.
- [ ] Admin audit failure and low-assurance sessions fail safely.
- [ ] Restore rehearsal, storage recovery and deployment rollback are demonstrated.
- [ ] Enabled analytics/media behavior matches user-facing promises.
- [ ] Mobile/browser accessibility and realistic catalog/performance checks are recorded.

The repository is well beyond a UI prototype. Its remaining launch risk is concentrated in whether distributed operations finish correctly and whether the release process can prove that they do. Close those gaps first; then the existing architecture supports the proposed product improvements without a rewrite.

[settlement]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/lib/payments/settlement.ts#L54
[finalize]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/supabase/migrations/0012_commerce_hardening.sql#L129
[webhook]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/app/api/stripe/webhook/route.ts#L54
[guest]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/features/commerce/guest-buyer.ts#L82
[checkout]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/features/commerce/actions.ts#L232
[return-route]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/app/%28discover%29/cart/complete/route.ts#L25
[stripe]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/lib/payments/stripe.ts#L44
[ci]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/.github/workflows/ci.yml
[audit]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/lib/admin/audit.ts#L46
[monitoring]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/lib/monitoring.ts#L95
[intake]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/app/api/monitoring/route.ts#L9
[env]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/lib/env.ts
[worker]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/app/api/jobs/transfers/route.ts
[renderer]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/lib/listing-import/fetch/render.ts
[limiter]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/lib/rate-limit.ts
[admin-guard]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/lib/admin/guard.ts
[analytics]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/lib/analytics.ts
[privacy]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/src/app/%28legal%29/privacy/page.tsx#L116
[next-config]: https://github.com/n89b-dot/DRVN-2/blob/f6cf0a90b027424c7f1564e9fba499a21543fd7b/next.config.ts

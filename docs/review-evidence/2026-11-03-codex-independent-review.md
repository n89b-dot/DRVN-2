## Overall verdict

**DRVN is not ready for production.** The main problems are bypassable financial safeguards, public access to private media, deletable transaction evidence, incomplete account deletion, and gaps in abuse controls and operational monitoring. I reviewed all 106 `page.tsx`/`route.ts` files across the requested groups, their supporting code, and relevant definitions across the 218 migrations in filename order. This was an independent static review: I did not read the excluded review, modify files, run tests/builds/servers/migrations, or make network calls. “Verified” below means traced through current code; hosted configuration and provider behavior remain unverified.

## Launch blockers

1. **An in-app action can remove an active bank-dispute payout hold.** Buyer and admin dispute closure restore the order’s payable status without resolving or checking the Stripe dispute journal. See **C1**.
2. **Members can delete photos retained as purchase or dispute evidence.** Storage DELETE policies bypass the application’s reference protection. See **D1**.
3. **Private-car and unpublished photos are publicly accessible through Storage.** Page-level visibility does not protect the underlying objects. See **D2**.
4. **The shipped legal and retention policies explicitly contain unresolved launch decisions.** The repository identifies the terms as a working draft requiring review before real payments. See **D4**.

The High findings below should also be release gates for their affected features, particularly Connect eligibility, account security, non-dispatch protection, and AI privacy.

## Findings by area

### Auth & account

**A1 — Password recovery bypasses the ordinary password-change safeguard**

- **Severity**: High
- **Page/feature**: `/login/reset`, Settings → password change
- **Evidence**: `src/app/(auth)/login/reset/page.tsx:20`; `src/app/(auth)/actions.ts:318`; `src/app/(product)/settings/account-actions.ts:95`; `supabase/config.toml:229`.
- **Technical**: The reset page and action accept any authenticated user; they do not establish that the session came from a verified recovery flow. Settings requires the current password, but the reset action calls `updateUser({ password })` without that check, and checked-in Auth configuration disables secure password changes.
- **Plain-language impact**: Someone holding an ordinary stolen session can use the reset path to establish a new password.
- **Fix**: Enforce reauthentication at the Auth boundary and distinguish verified recovery sessions from ordinary sessions. Test reset attempts using an ordinary authenticated session and direct Auth API calls.
- **Confidence**: Verified (traced); hosted Auth configuration needs confirmation.

**A2 — Account deletion skips saved-card cleanup for former traders**

- **Severity**: High
- **Page/feature**: Settings → delete account; account-deletion worker
- **Evidence**: Latest blocker function: `supabase/migrations/20260905185725_account_privacy_completion.sql:115`; `src/lib/account-deletion-worker.ts:104`; Stripe cleanup at `src/lib/account-deletion-worker.ts:121`; privacy promise at `src/app/(legal)/privacy/page.tsx:278`.
- **Technical**: Any historical order makes `retained_identity` true, even after financial activity has finished. That branch completes the worker job and returns before deleting the Stripe customer; its operator task has no review date and explicitly awaits policy decisions.
- **Plain-language impact**: A former buyer or seller can remain indefinitely in a partially deleted state, including retained saved payment details, despite the privacy page’s promise.
- **Fix**: Separate necessary financial-record retention from independent payment-method cleanup. Give retained-identity work an approved policy, named owner, deadline, and retryable completion process.
- **Confidence**: Verified (traced).

### Social/Explore/Garage

**S1 — Concurrent build-sheet saves silently discard changes**

- **Severity**: High
- **Page/feature**: Garage build editor; agent build changes
- **Evidence**: Latest `save_mod_items`: `supabase/migrations/20261019100000_mod_items_stock_origin.sql:32`, deletion at `:137`, upsert at `:177`; `src/app/(product)/garage/actions.ts:332`; `src/features/agent/build.ts:45`.
- **Technical**: Saving replaces the caller’s complete sheet without an expected revision. Rows omitted from a stale payload are deleted unless protected by a listing or purchase reference, while included rows overwrite newer values.
- **Plain-language impact**: Saving an older browser tab can erase parts or edits added from another tab or by the agent.
- **Fix**: Add a car/build revision and reject stale saves, or use versioned row-level mutations. Cover concurrent editor/editor and editor/agent changes.
- **Confidence**: Verified (traced).

**S2 — Showcase replacement can destroy the previous showcase on failure**

- **Severity**: Medium
- **Page/feature**: Garage → edit showcase
- **Evidence**: `src/app/(product)/garage/actions.ts:532`, DELETE at `:561`, INSERT at `:563`.
- **Technical**: Existing pins are deleted in one request and replacements inserted in another. The delete result is ignored, and an insertion failure cannot roll back the deletion.
- **Plain-language impact**: A failed save can permanently remove the previously working showcase.
- **Fix**: Replace pins through one transactional RPC that validates ownership and all references before changing anything.
- **Confidence**: Verified (traced).

**S3 — Saved content becomes inaccessible as collections grow**

- **Severity**: Medium
- **Page/feature**: `/saved`
- **Evidence**: `src/app/(product)/saved/page.tsx:54`, `:95`, `:118`, `:146`; `supabase/config.toml:18`.
- **Technical**: Save/follow relationships are fetched without pagination, despite the checked-in 1,000-row API cap. Secondary collections are additionally sliced to 100 items without navigation, and listing pagination operates only on IDs returned by the truncated relationship query.
- **Plain-language impact**: Older saves and follows disappear from this page, counts become incomplete, and searching saved listings cannot recover omitted items.
- **Fix**: Page the relationship table by collection type, hydrate only that page, and obtain counts separately.
- **Confidence**: Verified (traced); the 1,000-row limit depends on hosted configuration, while the explicit 100-item truncation does not.

**S4 — Showcase pin placement has no keyboard equivalent**

- **Severity**: Medium
- **Page/feature**: Garage showcase editor
- **Evidence**: `src/app/(product)/garage/[id]/edit/showcase-editor.tsx:103`; coordinate clamping at `src/app/(product)/garage/actions.ts:540`.
- **Technical**: Pin position comes exclusively from pointer coordinates in a click handler. There are no keyboard movement controls or coordinate inputs; keyboard activation does not supply a meaningful position within the photograph.
- **Plain-language impact**: A keyboard-only member cannot place pins where intended.
- **Fix**: Provide keyboard-controlled placement or accessible position inputs, including instructions and visible focus. Verify the complete flow using only a keyboard.
- **Confidence**: Verified (traced).

### Marketplace & selling

**M1 — Direct database calls bypass the Stripe Connect publishing gate**

- **Severity**: High
- **Page/feature**: Sell, listing publication, marketplace purchases
- **Evidence**: App gate: `src/app/(product)/sell/actions.ts:346`; intended invariant: `src/lib/payments/connect.ts:113`; latest listing INSERT policy: `supabase/migrations/20261017140000_rls_initplan.sql:206`; latest creation RPC: `supabase/migrations/20261019120000_negotiation_contract.sql:109`; latest purchase function: `supabase/migrations/20261004130000_checkout_charge_bounds.sql:87`.
- **Technical**: The server action checks whether the seller can receive payouts, but the database publication paths do not enforce that condition. Listing INSERT permits an unsuspended owner, and purchase claiming does not independently require a payable seller.
- **Plain-language impact**: A member can bypass onboarding through PostgREST, publish, and take a buyer’s payment while unable to receive the proceeds.
- **Fix**: Enforce trusted Connect eligibility at both publication and purchase boundaries. Test these paths with a member JWT and publishable key, bypassing Next.js.
- **Confidence**: Verified (traced).

**M2 — Fees copy incorrectly promises the listing number is the final charge**

- **Severity**: Low
- **Page/feature**: `/fees`; DRVN Shipping checkout
- **Evidence**: `src/app/(legal)/fees/page.tsx:109`; `src/features/commerce/checkout-shipping.ts:85`.
- **Technical**: The fees page says nothing is added at checkout and the listing number is what the buyer pays. DRVN Shipping calculates shipping during checkout, so that statement does not describe every supported purchase.
- **Plain-language impact**: Buyers can interpret a legitimate shipping charge as an undisclosed addition.
- **Fix**: State that buyers pay the item price plus shipping, with calculated shipping shown before payment.
- **Confidence**: Verified (traced).

### Cart/checkout/orders/offers/messages/disputes

**C1 — Local dispute closure can release a live bank-dispute hold**

- **Severity**: Blocker
- **Page/feature**: Order dispute closure; admin seller resolution; seller payouts
- **Evidence**: `src/features/commerce/dispute-actions.ts:274`; order UI at `src/app/(product)/orders/[id]/page.tsx:1142`; latest admin command at `supabase/migrations/20261007100100_unsuspend_refuses_requested_deletion.sql:67`; latest provider journal handling at `supabase/migrations/20260905195518_provider_dispute_ordering.sql:46`; payout checks at `src/lib/payments/transfer-worker.ts:420` and `:518`.
- **Technical**: Stripe disputes put orders into `disputed` and record a separate provider journal. Buyer closure and admin seller resolution restore the previous order status without checking that journal; transfer eligibility then checks payable order status and time, without independently checking the bank dispute.
- **Plain-language impact**: An order can become locally eligible for seller payout while its charge remains contested at the bank, exposing DRVN to unrecoverable loss.
- **Fix**: Make provider holds independent of editable order status and enforce them transactionally at payout dispatch. Only verified terminal provider outcomes should release that hold; test both buyer and admin closure during an active chargeback.
- **Confidence**: Verified (traced); an actual Stripe transfer was not attempted.

**C2 — Buyers cannot report a seller who never dispatches**

- **Severity**: High
- **Page/feature**: Paid orders awaiting shipment; cancellation and protection
- **Evidence**: `src/features/commerce/dispute-command.ts:36`; `src/features/commerce/order-fulfillment-actions.ts:154`; `src/lib/payments/dispute-sla.ts:76`.
- **Technical**: Problem reporting permits only shipped, delivered, or completed orders. Cancellation is seller-only, and dispute automation processes orders already marked disputed, leaving a paid, never-dispatched order outside both buyer remedies.
- **Plain-language impact**: An absent or uncooperative seller can leave the buyer dependent on out-of-band support, with no in-app escalation.
- **Fix**: Add an overdue-dispatch deadline and buyer escalation path, backed by a durable operator/refund workflow.
- **Confidence**: Verified (traced).

**C3 — Pickup-pass regeneration can erase completed handoff evidence**

- **Severity**: High
- **Page/feature**: Order pickup pass and redemption
- **Evidence**: `src/features/commerce/pickup-actions.ts:98`, unconditional upsert at `:120`; latest redemption function at `supabase/migrations/20261006100000_payout_hold_setting.sql:115`.
- **Technical**: Pass generation separately reads paid/unredeemed state, then upserts a pass while clearing redemption fields. Redemption locks and updates the order/pass atomically, but a generation request that passed its earlier checks can subsequently overwrite the redeemed pass.
- **Plain-language impact**: A completed collection can lose its recorded redemption proof. This is an evidence-integrity problem; the traced race does not itself demonstrate duplicate payout.
- **Fix**: Mint and rotate passes in a transactional RPC using the same lock order as redemption, and never clear a completed redemption. Add a concurrent mint/redeem regression test.
- **Confidence**: Verified (traced).

### Payments back-end & workers

**P1 — Disabling integrated shipping strands high-value shipping orders**

- **Severity**: High
- **Page/feature**: Seller-arranged shipping; order dispatch
- **Evidence**: `src/lib/shipping/provider.ts:44`; `src/features/commerce/order-fulfillment-actions.ts:45`; latest threshold and dispatch enforcement at `supabase/migrations/20261009100000_payout_release_risk_controls.sql:64` and `:278`.
- **Technical**: The default risk setting requires provider-backed tracking from $1,000. Tracker registration is conditional on integrated shipping being enabled, although seller-arranged shipping remains available; with the provider disabled, such an order cannot satisfy dispatch validation.
- **Plain-language impact**: A seller can receive a paid order that the normal interface cannot mark dispatched.
- **Fix**: Separate tracking verification from label-purchase availability, or reject unsupported transactions before charging. Test high-value flat-shipping orders with integrated shipping disabled.
- **Confidence**: Verified (traced).

**P2 — Delivery proof is not bound to the order’s destination or sale date**

- **Severity**: High
- **Page/feature**: Seller-entered tracking; automatic delivery and payout timing
- **Evidence**: `src/lib/shipping/easypost.ts:207`, `:340`; `src/lib/shipping/apply-tracking.ts:54`, `:194`, `:388`.
- **Technical**: Tracker creation accepts the seller’s carrier and tracking number, and reconciliation checks tracker/code/carrier identity. It does not establish destination correspondence or reject delivery scans predating this purchase before using delivered status to advance the order.
- **Plain-language impact**: An unrelated or previously delivered tracking number may be usable as apparent delivery proof, starting the payout clock without delivery to this buyer.
- **Fix**: Validate scan chronology and destination evidence before accepting delivery for settlement. Exercise old, recycled, wrong-destination, and unrelated tracking numbers against the actual provider.
- **Confidence**: Suspected (needs runtime check); the missing validation is traced, but exploitability depends on provider responses.

**P3 — Scheduled payout processing has a low fixed throughput ceiling**

- **Severity**: Medium
- **Page/feature**: Transfer queue; payout timeliness at scale
- **Evidence**: `src/lib/payments/transfer-worker.ts:39`, single claim at `:62`, return at `:89`; latest transfer schedule at `supabase/migrations/0020_transfer_scheduling.sql:140`.
- **Technical**: Each invocation claims at most eight intents and does not drain further batches. The repository schedule invokes it every ten minutes, yielding at most 48 claimed intents per hour from that schedule, including attempts that do not transfer.
- **Plain-language impact**: A modest transaction burst or recovery backlog can delay payouts well beyond eligibility.
- **Fix**: Drain bounded batches within a time budget or scale worker invocation safely. Define and monitor queue-age objectives, then load-test expected launch and recovery volumes.
- **Confidence**: Verified (traced); additional externally configured invocations were not inspected.

### AI agent

**AI1 — Multi-turn history bypasses the promised PII redaction**

- **Severity**: High
- **Page/feature**: `/agent` chat
- **Evidence**: `src/features/agent/chat.ts:88` and `:101`; `src/lib/ai/run.ts:111` and `:275`; storage redaction at `supabase/migrations/20261021100000_agent_foundation.sql:431`; privacy promise at `src/app/(legal)/privacy/page.tsx:170`.
- **Technical**: New text passes through model redaction, but stored history is forwarded unchanged on subsequent turns. Database message redaction removes card numbers only, leaving email addresses, phone numbers, and VINs available in that history.
- **Plain-language impact**: Information removed from the first model request can be sent to Anthropic on the next message, contrary to the published promise.
- **Fix**: Redact every history message at the final model boundary. Add a multi-turn regression containing each protected identifier.
- **Confidence**: Verified (traced).

**AI2 — Daily spend limits do not reserve or fully account for spending**

- **Severity**: High
- **Page/feature**: Agent model execution and cost controls
- **Evidence**: Latest spend check: `supabase/migrations/20261024100000_agent_admin_measure.sql:115`; `src/lib/ai/spend.ts:22`; `src/lib/ai/run.ts:197`, `:269`, `:289`, `:302`.
- **Technical**: Admission checks previously recorded cost without reserving budget, so concurrent requests can all pass. Usage is recorded only after the complete runner finishes; partially completed failures bypass recording, and ledger insertion failures are merely logged.
- **Plain-language impact**: The advertised daily caps do not reliably bound provider charges, particularly under concurrency or provider failures.
- **Fix**: Atomically reserve budget before provider work, settle actual usage, and conservatively account for uncertain partial failures. Reject unpriced model configurations and test concurrent admission.
- **Confidence**: Verified (traced).

**AI3 — Direct RPC calls bypass closed buyer/seller mandate creation gates**

- **Severity**: Medium
- **Page/feature**: Agent beta controls; mandate creation
- **Evidence**: `src/lib/agent/beta.ts:30`; `src/features/agent/actions.ts`; latest `agent_mandate_set` at `supabase/migrations/20261021100100_agent_worker.sql:1064`, authenticated grant at `:1502`, halt checks at `:363`.
- **Technical**: Buyer/seller rollout gates are checked in application actions, but the authenticated mandate RPC does not enforce them. A member can create a mandate directly while that scope is closed; the worker’s separate kill switches still apply.
- **Plain-language impact**: Opening one operational agent scope can leave supposedly closed scopes available to members using the API.
- **Fix**: Enforce creation and resumption gates in the database using authoritative configuration. Test direct authenticated RPC calls while individual beta steps are closed.
- **Confidence**: Verified (traced).

**AI4 — Advertised product, fitment, and comparable-price tools remain stubs**

- **Severity**: Medium
- **Page/feature**: Agent product research and pricing
- **Evidence**: `src/lib/capabilities/reads.ts:134`, `:146`, `:158`; tool exposure at `src/lib/capabilities/registry.ts:17`.
- **Technical**: These capabilities ignore their inputs and always return pending/insufficient-evidence results. They are nevertheless supplied to the model as available research tools.
- **Plain-language impact**: The agent cannot perform these advertised lookups, even when suitable data is present.
- **Fix**: Connect the tools to scoped database queries and comparable-sale calculations, or explicitly disable the unavailable capabilities. Test against populated fixtures.
- **Confidence**: Verified (traced).

### Admin & ops

**O1 — The health endpoint omits important scheduled work**

- **Severity**: High
- **Page/feature**: `/api/health/workers`, external monitoring, agent and aggregate jobs
- **Evidence**: Latest health function: `supabase/migrations/20261006100100_untracked_delivery_auto_confirm.sql:391`; agent route at `src/app/api/jobs/agent/route.ts:11`; additional schedules at `supabase/migrations/20261011120000_precomputed_aggregates.sql:582`, `20261011130000_search_engine_at_scale.sql:747`, and `20261020120000_products.sql:645`.
- **Technical**: The final health inventory omits the agent and later aggregate/catalog refresh schedules. Its runnable queues also omit the provider dispute journal’s `loss_pending` state, and agent checks run inside the agent invocation rather than providing an independent missing-invocation heartbeat.
- **Plain-language impact**: Health can appear satisfactory while agent work stops, discovery data becomes stale, or chargeback processing remains unfinished.
- **Fix**: Maintain one authoritative schedule inventory with independently checked heartbeat freshness and queue age, including provider dispute recovery. Test stopped schedules, not just failing handlers.
- **Confidence**: Verified (traced).

**O2 — Finance CSV exports silently truncate under the checked-in API limit**

- **Severity**: Medium
- **Page/feature**: `/admin/export`
- **Evidence**: `src/app/(admin)/admin/export/route.ts:20`, `:68`, `:125`; single-range queries at `src/lib/admin/queries.ts:653` and `:1396`; `supabase/config.toml:18`.
- **Technical**: Export requests ask for up to 5,000 rows through a single PostgREST query. The checked-in API limit is 1,000, and the export does not page through that limit or disclose the resulting truncation.
- **Plain-language impact**: Finance or audit users can receive an apparently complete export that omits transactions or audit entries.
- **Fix**: Fetch deterministic pages below the API cap and disclose the intentional export ceiling. Test exports containing more than 1,000 and 5,000 records.
- **Confidence**: Verified (traced) under checked-in configuration; hosted row limits need confirmation.

**O3 — The migration runner disables database certificate verification**

- **Severity**: Medium
- **Page/feature**: Production migration operations
- **Evidence**: `scripts/apply-migration.mjs:21`.
- **Technical**: The runner connects as `postgres` with `ssl: { rejectUnauthorized: false }`. Traffic is encrypted without authenticating the database server’s certificate.
- **Plain-language impact**: A connection interception could expose privileged credentials or alter migration traffic.
- **Fix**: Verify the server certificate using the appropriate trusted CA configuration and fail closed on verification errors.
- **Confidence**: Verified (traced).

### Database/storage security & cross-cutting

**D1 — Storage policies permit deletion of retained transaction evidence**

- **Severity**: Blocker
- **Page/feature**: Listing photographs, frozen purchase snapshots, dispute evidence
- **Evidence**: Latest public-media DELETE policy: `supabase/migrations/0001_v3_schema.sql:401`; latest evidence DELETE policy: `supabase/migrations/0024_grading_dispute_process.sql:182`; URL snapshots at `supabase/migrations/0049_commercial_snapshot.sql:254`; application-only reference protection at `src/lib/media-lifecycle.ts:112`.
- **Technical**: The policies allow uploaders to delete their own objects without checking purchase or dispute references. Purchase snapshots preserve image URLs, while the application’s reference-aware deletion helper can be bypassed by calling Storage directly.
- **Plain-language impact**: A seller or evidence uploader can remove material needed to establish the purchased condition or resolve a dispute.
- **Fix**: Enforce retention at the Storage boundary and preserve immutable evidence bytes independently of mutable listing media. Test deletion using a member JWT after purchase and after evidence submission.
- **Confidence**: Verified (traced); later evidence privacy changes replace READ access, not this DELETE permission.

**D2 — Private and unpublished photographs remain publicly readable**

- **Severity**: Blocker
- **Page/feature**: Private cars, listing drafts, agent photo attachments
- **Evidence**: Public buckets and unrestricted media SELECT: `supabase/migrations/0001_v3_schema.sql:377` and `:385`; public upload URLs/cache policy at `src/app/api/media/public-photo/route.ts:68`; agent attachment bucket at `src/features/agent/chat.ts:77`; private-car promise at `src/app/(legal)/privacy/page.tsx:137`.
- **Technical**: Car and listing photographs use public buckets with SELECT access independent of car visibility or publication state. Anonymous Storage listing/read access is not constrained by the application’s private-car RLS, and uploads request a year of caching.
- **Plain-language impact**: Private-car, draft, or chat-only photographs can be obtained outside the page that protects them; marking a car private does not retract its public images.
- **Fix**: Use private staging and private-car storage with authorized reads, publishing separate copies only deliberately. Address existing public objects and caches, then test anonymous listing and object retrieval.
- **Confidence**: Verified (traced).

**D3 — Application rate limits do not protect several direct API write paths**

- **Severity**: High
- **Page/feature**: Messages, social interactions, dispute-evidence uploads
- **Evidence**: Message action limiter at `src/features/commerce/message-actions.ts:81`; latest message INSERT policy at `supabase/migrations/20261017140000_rls_initplan.sql:220`; latest message guard at `supabase/migrations/20260928140000_person_conversations.sql:84`; evidence upload policy at `supabase/migrations/0024_grading_dispute_process.sql:174`.
- **Technical**: The message database boundary validates identity and relationship, but does not enforce the action’s quota. Evidence uploads similarly permit authenticated writes to the member’s folder without requiring an eligible dispute or enforcing the application upload workflow.
- **Plain-language impact**: A member can bypass Next.js to flood permitted recipients or consume evidence storage without the intended throttling.
- **Fix**: Enforce quotas and eligibility through database guards or narrowly granted RPCs, and authorize evidence uploads against a real dispute. Exercise abuse cases using PostgREST and Storage directly.
- **Confidence**: Verified (traced). This finding does not apply indiscriminately to all RPCs; offer paths have database-level controls.

**D4 — Legal identity and retention decisions are explicitly unfinished**

- **Severity**: Blocker
- **Page/feature**: `/terms`, `/privacy`; deletion and retention operations
- **Evidence**: `src/app/(legal)/terms/page.tsx:29`; controller description at `src/app/(legal)/privacy/page.tsx:39`; unresolved retention at `:272` and `:288`.
- **Technical**: The terms identify themselves as a working draft requiring review before real payments, with entity, governing-law, liability, tax, and retention decisions outstanding. The published privacy page explicitly leaves post-deletion retention and backup expiry undecided.
- **Plain-language impact**: Members are being asked to transact before the business has finalized the rules and data lifecycle it will operate.
- **Fix**: Obtain owner/counsel approval for the actual entity, operating markets, responsibilities, and retention schedule, then implement and publish matching behavior. This finding identifies unfinished release work rather than asserting a particular jurisdiction’s legal violation.
- **Confidence**: Verified (traced).

## What looks solid

These are positive design observations, not runtime certification.

- **Auth & account:** Confirmation uses a deliberate POST flow, with origin checking and bounded input handling: `src/app/(auth)/confirm/route.ts:54` and `:62`.
- **Social/Explore/Garage:** Quick-post handling is separated from published-post editing, avoiding the earlier draft-selection ambiguity: latest function at `supabase/migrations/20260919202000_post_edit_repairs.sql:143`.
- **Marketplace & selling:** Checkout uses database locking and idempotent purchase claiming, with charge bounds and USD enforcement: `supabase/migrations/20261004130000_checkout_charge_bounds.sql:87`, `:124`, and `:530`.
- **Commerce & payments:** Transfers preserve dispatch identity and reconcile uncertain provider outcomes before creating another transfer: `src/lib/payments/transfer-worker.ts:18`; `supabase/migrations/20260905173052_transfer_dispatch_recovery.sql:96`.
- **AI agent:** Model tools have an explicit scope/risk allowlist, and money-changing capabilities are excluded from that list: `src/lib/capabilities/registry.ts:8` and `:26`.
- **Admin & ops:** Admin mutation infrastructure combines authorization, step-up checks, and transactional audit commands: `src/lib/admin/actions.ts:52`; `src/lib/admin/audit.ts:62`; `supabase/migrations/20261007100100_unsuspend_refuses_requested_deletion.sql:26`.
- **Database/storage & cross-cutting:** Public photo uploads normalize images server-side, and external listing fetches pin validated DNS results: `src/app/api/media/public-photo/route.ts:62`; `src/lib/listing-import/fetch/safe-fetch.ts:72`.
- **Docs and release surfaces:** Docs pages and text handlers independently enforce access; CI has an aggregate gate requiring its component checks: `src/app/(docs)/layout.tsx:32`; `src/app/(docs)/docs/llms.txt/route.ts:12`; `src/app/(docs)/docs/md/[slug]/route.ts:17`; `.github/workflows/ci.yml:423`.

## Launch checklist

- [ ] Resolve the Blocker findings and gate affected features until their High findings are fixed. Include direct member-JWT/PostgREST/Storage tests, not only server-action tests.
- [ ] Obtain green CI for the exact release commit and verify deployment/branch protection actually requires it. The repository gate is at `.github/workflows/ci.yml:423`; hosted enforcement was not inspected.
- [ ] Verify all 218 migrations against the target project’s applied history, in filename order. Harden certificate verification before using `scripts/apply-migration.mjs:21`.
- [ ] Verify production Auth confirmation, recovery, password reauthentication, SMTP, and redirect configuration. Checked-in defaults disable confirmation and secure password changes: `supabase/config.toml:220`.
- [ ] Exercise live-mode-equivalent Stripe scenarios: authentication-required payment, interrupted checkout, duplicate/out-of-order webhooks, partial refunds, reversals, payout recovery, and bank disputes. Validate environment pairing using `src/lib/env.ts:196`.
- [ ] Resolve the tracking configuration mismatch and test old, wrong-destination, and recycled tracking numbers before enabling high-value shipping purchases. See **P1–P2**.
- [ ] Reconcile the actual scheduler inventory with every worker and aggregate refresh. Stop each schedule deliberately and verify an independent alert; see **O1**.
- [ ] Load-test queue recovery and payout age at expected volumes. The repository’s scheduled transfer capacity starts at eight claims per ten-minute invocation; see **P3**.
- [ ] Test account deletion for a former trader with saved cards, retained evidence, an export, and completed orders. Verify provider cleanup and the operator completion path; see **A2**.
- [ ] Test anonymous media listing/read access and member deletion of purchased/evidentiary photos. Include previously cached public URLs; see **D1–D2**.
- [ ] Add concurrency regressions for stale build sheets, showcase replacement failure, and pickup mint/redemption. See **S1–S2** and **C3**.
- [ ] Test saved collections and admin exports beyond 1,000 records, including counts and explicit truncation behavior. See **S3** and **O2**.
- [ ] Test multi-turn AI redaction, concurrent budget admission, partial provider failures, and closed-scope direct RPC calls before enabling agent features. See **AI1–AI3**.
- [ ] Complete owner/counsel approval and implement the resulting retention/deletion schedule before accepting real members or payments. See **D4**.
- [ ] Perform keyboard and screen-reader walkthroughs of signup, selling, checkout, messaging, disputes, pickup, and garage editing. The showcase placement gap is already traced in **S4**.
- [ ] Rehearse database/object restoration and financial reconciliation in an isolated environment, including safe handling of outbound jobs after restoration. Use `docs/production-runbook.md` as the procedure, then retain evidence of the completed exercise.

**No hosted configuration, successful test execution, restore exercise, or provider transaction is certified by this review.**
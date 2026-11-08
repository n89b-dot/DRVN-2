# Readiness crosswalk: the OS's N4xx and R items, mapped to the plan and to proof

Built 7 November 2026 by cloud session C, against main at 8338418 (#87 merged).

## Why this exists

The Intelligence OS lists 88 open items numbered N4xx to N6xx, plus some R- items. They come from the 3 November review, `docs/production-readiness-2026-11-03.md`, which itself numbers only its blockers (B1 to B9). The blocker batches and every merged PR used a different numbering, N1 to N250, from `docs/plans/2026-11-blockers-resolution.md`. No commit on main named an N4xx id, so items that were fixed stayed open.

This file joins the two. One row per OS item:
- **Title** is the OS's own title.
- **Plan id / batch** is the N1–N250 id and the OS-W batch from the blockers plan. Where a PR body names the id, it is quoted. Where it isn't, the id was inferred from the order of the 3 Nov findings: the plan's ids run through each section in the same order. Inferred ids are marked *(inferred)*.
- **PR / commit** is the merged PR and its merge commit on main.
- **Proving test** is copied from the source, `file › describe › test name`. SQL guards in `supabase/tests` have no test names, so they're cited by the text of the check that fails. CI's `sql-guard` job runs every guard; this session had no database, so those guards weren't run here. Every vitest file cited was run on main and passed.

## Statuses

- **FIXED:** on main, with a test that fails if the fix is reverted.
- **FIXED, test added here:** on main, but nothing proved it; this sweep adds the test.
- **OPEN, CLAIMED:** not fixed on main, and in a batch someone owns. Cloud A owns W08, W11, W21, W23, W28, W31, W32, W33 and W34. The local session owns W05, W07, W10, W16, W17, W20 and W29.
- **OPEN, UNCLAIMED:** a real gap no batch covers. These are the next batch.
- **NEEDS NEIL / LOCAL:** needs hosted systems, secrets or spend.
- **CLAIMED (cloud D):** cloud D's 18+ and legal-page work.

## Totals

| Status | Items |
|---|---|
| FIXED | 38 |
| FIXED, test added here | 1 (N410) |
| OPEN, CLAIMED | 31 |
| OPEN, UNCLAIMED | 9 |
| NEEDS NEIL / LOCAL | 5 |
| CLAIMED (cloud D) | 4 |
| **Total** | **88** |

Each area below is proved by its own PR, whose title starts with every id that area proves FIXED.

---

## Auth and account

Proof PR: #98, from `cloud/os-proof-sweep-auth`.

| Item | Title | Status | Plan id / batch | PR / commit | Proving test (file › test name) |
|---|---|---|---|---|---|
| N418 | Account deletion keeps personal data forever | OPEN, CLAIMED | N16 / OS-W34 (cloud A) | — | — |
| N420 | Open redirect | FIXED | N19 / OS-W12 | #86 / 23f725c | `src/lib/safe-redirect.test.ts › safeRedirectPath › rejects control characters hidden inside the path`; `… › rejects encoded variants that turn dangerous after one more decode` |
| N421 | Password-change bypass | FIXED | N20 / OS-W12 | #86 / 23f725c | `src/app/(auth)/actions.test.ts › password reset completion › refuses an ordinary signed-in session and changes nothing`; `src/lib/reauthentication.test.ts › recovery authorisation › refuses an ordinary signed-in session, however fresh` |
| N439 | Deleted traders keep their saved cards | OPEN, CLAIMED | N16 / OS-W34 (cloud A) | — | — |
| N442 | Usernames are only validated in the form | OPEN, CLAIMED | N38 / OS-W34 (cloud A) | — | — |
| N443 | Suspended members can't export or delete their data | OPEN, CLAIMED | N39 *(inferred)* / OS-W11 (cloud A) | — | — |
| N444 | Google sign-in during invite-only beta leaves a stuck onboarding loop | FIXED | N40 / OS-W12 | #86 / 23f725c | `src/app/(auth)/callback/route.test.ts › successful OAuth returns › sends an account with no profile row to onboarding, not round a loop (N40)`; `src/app/(auth)/actions.test.ts › onboarding an account with no profile › creates the missing profile row instead of pretending an empty update worked` |
| N445 | Account deletion and email change are too easy from an unlocked session | FIXED | N41 / OS-W12 | #86 / 23f725c | `src/app/(product)/garage/delete-account.test.ts › account deletion › requests nothing when the member can't confirm it's them`; `src/app/(product)/settings/account-actions.test.ts › email change re-authentication › changes nothing without it, and says which proof to offer` |
| N446 | Sign-up has no throttle or CAPTCHA | FIXED | N42 / OS-W12 | #86 / 23f725c | `src/app/(auth)/actions.test.ts › sign-up throttling › sends no confirmation email once any key is exhausted` |
| N447 | Cancelling Google sign-in shows link expired | FIXED | N44 / OS-W13 | #86 / 23f725c | `src/app/(auth)/callback/route.test.ts › OAuth returns that carry no session › says cancelled when the person backed out at Google, keeping the destination` |
| N448 | Google-only members see an unusable password form | FIXED | N45 / OS-W13 | #86 / 23f725c | `src/app/(product)/settings/password-section.test.tsx › password section › shows a Google-only member the set-password path instead` |
| N450 | Data export is a JSON list of links that expire in 10 minutes | OPEN, CLAIMED | N47 *(inferred)* / OS-W11 (cloud A) | — | — |
| N452 | Raw Supabase error text is shown to users | OPEN, UNCLAIMED | N49 / OS-W13, sign-in half only | #86 / 23f725c, sign-in half | Sign-in half only: `src/lib/auth-errors.test.ts › public auth error copy › never returns the provider's message, and reports only what wasn't expected` |
| N453 | Login and sign-up have no main landmark | FIXED | N50 / OS-W13 | #86 / 23f725c | `src/app/(auth)/layout.test.tsx › auth layout landmarks › renders exactly one main landmark, around the page content` |

Notes:
- **N446:** the throttle is in. CAPTCHA was left as the owner's choice in the runbook.
- **N421:** the hosted Supabase "Secure password change" switch is still the owner's step. `supabase/config.toml` sets it for local.
- **N452 is still open outside sign-in.** About 16 member-facing actions still return `error.message` straight from the database:
  - `garage/actions.ts` (6, including the Settings profile and notification saves);
  - `sell/actions.ts:706,791`;
  - `features/activity/actions.ts:63`;
  - `features/activity/mod-actions.ts:55`;
  - `features/commerce/dispute-command.ts:68`;
  - `features/commerce/dispute-actions.ts` (4);
  - `features/commerce/add-to-car-actions.ts:115`;
  - `features/commerce/returns.ts:139`.

  Some of these pass on RPC messages that were written for members, so each needs a look rather than a blanket swap.

## Social

Proof PR: #99, from `cloud/os-proof-sweep-social`.

| Item | Title | Status | Plan id / batch | PR / commit | Proving test (file › test name) |
|---|---|---|---|---|---|
| N434 | Counts silently go wrong past 1,000 rows | FIXED | N30, N56 / OS-W22; N133 / OS-W14 | #77 / ade4ff8; #87 / 8338418 | `src/lib/marketplace/query.test.ts › N30: card likes, questions and seller ratings come counted from the database, past 1,000`; `src/features/activity/load-engagement.test.ts › N56: counts every reaction and reply past 1,000 instead of the rows it fetched`; `src/app/(admin)/admin/export/route.test.ts › orders export (N133) › exports all 2,500 orders, past the 1,000-row cap, each exactly once` |
| N435 | Following feed and Saved break when the ID list exceeds URL limits | FIXED | N31 / OS-W22 | #77 / ade4ff8 | `src/lib/feed-followed.test.ts › N31: the database joins the follows — no follow list is read and no id list is sent`; `supabase/tests/social_retrieval_guard.sql` › "N31: the Following feed read % rows" |
| N454 | Photos stay public after deletion or moderator removal | FIXED | N51 / OS-W15 | #73 / d5a3eff | `src/lib/media-lifecycle.test.ts › processMediaCleanupQueue (N51) › removes unreferenced photos of deleted content, keeps referenced ones, and dequeues both`; `supabase/tests/media_integrity_guard.sql` › "FAIL 6: % was not queued for cleanup" |
| N456 | Cars can't be reported | OPEN, CLAIMED | N53 / OS-W21 (cloud A) | `cloud/os-w21-moderation`, not merged | — |
| N457 | Members can't block or mute anyone | OPEN, CLAIMED | N54 / OS-W32 (cloud A) | — | — |
| N458 | Owners can attach image URLs from anywhere | FIXED | N55 / OS-W15 | #73 / d5a3eff | `src/lib/media-url.test.ts › isOwnedStorageUrl — canonical, ours, the member's own folder (N55) › accepts the member's own canonical public URL`; `… › ogImageSource — the share card's fetch allow-list › refuses %s`; `supabase/tests/media_integrity_guard.sql` › "FAIL 5: a car cover accepted %" |
| N459 | Opening one notification clears the whole public cache | FIXED | N57 / OS-W24 | #83 / 57ea7ea | `src/lib/revalidate.test.ts › opening or clearing notifications refreshes only the member's list (N57)` |
| N460 | Reaction and comment actions refresh any path the browser names | FIXED | N58 / OS-W24 | #83 / 57ea7ea | `src/features/activity/actions.test.ts › what reactions and replies refresh (N58) › ignores a path the browser sends with a reply`; `src/lib/revalidate.test.ts › no action revalidates a path read from its arguments or form (N58)` |
| N461 | Car activity tab shows only the 50 newest updates | FIXED | N60 / OS-W22 | #77 / ade4ff8 | `supabase/tests/social_retrieval_guard.sql` › "N60: paging read % updates in % pages; expected 61 in 2"; `src/lib/page-cursor.test.ts › page cursors (OS-W22) › pages a list far past every old cap completely, each row once` |
| N462 | Notifications and saves of deleted items are left behind | FIXED | N61 / OS-W22 | #77 / ade4ff8 | `supabase/tests/social_retrieval_guard.sql` › "N61: a deleted update left saves or notifications behind"; "N61: a deleted build left saves, follows, likes or notifications behind" |
| N463 | Showcase pins can't be placed with a keyboard | OPEN, CLAIMED | N67 *(inferred)* / OS-W23 (cloud A) | — | — |
| N464 | Saved page cuts secondary collections at 100 items | FIXED | N68 / OS-W22 | #77 / ade4ff8 | `supabase/tests/social_retrieval_guard.sql` › "Saved %: paged % (expected %)" |
| N627 | Old message photos may keep metadata | OPEN, UNCLAIMED | none (not in the 3 Nov doc; W08/R81 is agent-chat attachments) | — | `supabase/tests/message_photo_normalization_guard.sql` covers new uploads only |

Notes:
- **N454:** copies already cached at the edge (one-year cache) aren't purged.
- **N458:** fails closed until `job_config.media_storage_origin` is set, which is a deploy step.
- **N627:**
  - **Why:** the `message-photos` bucket took browser uploads from 28 Sep (`20260928140000`) until uploads went server-only on 5 Oct (`20261005100000`). The browser's re-encode let small files through with their metadata, and `scripts/public-media-backfill.mjs` never touched this private bucket.
  - **To prove:** a read-only inventory of objects created before 5 Oct, checked with sharp for EXIF, ICC or XMP.
  - **To fix:** extend the backfill to the bucket and remap `messages.attachments`.

## Listings and discovery

Proof PR: #100, from `cloud/os-proof-sweep-listings`.

| Item | Title | Status | Plan id / batch | PR / commit | Proving test (file › test name) |
|---|---|---|---|---|---|
| N430 | Fraud thresholds are publicly readable | OPEN, CLAIMED | N26 / OS-W16 (local) | #89, open | — |
| N433 | Several foreign keys have no database index | FIXED | N29 / OS-W25 | #71 / e8a6a15 | `supabase/tests/foreign_key_index_guard.sql` › FAIL 1 "foreign keys with no covering index"; FAIL 3 "keys from the readiness review still uncovered" |
| N465 | Sellers can edit any column of their own listing | OPEN, CLAIMED | N69, N5 / OS-W16 (local) | #89, open (image-URL part fixed by #73) | — |
| N467 | "N sold on DRVN" can be faked | OPEN, CLAIMED | N71 / OS-W16 (local) | #89, open | — |
| N468 | A refused listing traps the seller in the Sell form | OPEN, CLAIMED | N72 / OS-W16 (local) | #89, open | — |
| N469 | Saved-search alerts miss listings published from drafts | FIXED | N73 / OS-W25 | #71 / e8a6a15 | `src/app/api/jobs/saved-searches/route.test.ts › a part published from a draft enters the window when it is published, not when it was saved (N73)`; `supabase/tests/listing_published_at_guard.sql` › FAIL 5 "the saved-search window missed a part published from a draft" |
| N470 | robots.txt fails when the database fails | FIXED | N74 / OS-W26 | #74 / 836d636 | `src/lib/robots.test.ts › answers during a database outage with fixed sitemaps and no database read` |
| N472 | Import address check misses some IPv6 forms | FIXED | N76 / OS-W25 | #71 / e8a6a15 | `src/lib/listing-import/fetch/guard.test.ts › address corpus (IPv6 and embedded IPv4) › canonicalises a mapped address to the IPv4 address it wraps` |
| N473 | Deleting a listing silently deletes buyers' offers | OPEN, CLAIMED | N77 / OS-W33 (cloud A) | — | — |
| N474 | Saved-search alerts have no frequency cap | OPEN, UNCLAIMED | N78 / OS-W35 (email half only) | #84 / 87b0728, email half | Email half only: `src/app/api/jobs/saved-search-digests/route.test.ts › accumulation across in-app runs › never sends a second digest the same day; later matches wait for tomorrow's` |
| N475 | Store page numbers accept invalid values | FIXED | N79 / OS-W25 | #71 / e8a6a15 | `src/lib/page-param.test.ts › store page numbers (N79) › treats anything that is not a whole positive page as page 1` |

Notes:
- **N430, N465, N467, N468:** their proving tests exist only on #89. They can close when #89 merges.
- **N474 needs Neil's ruling.** His N78 ruling ("daily digest") was built in #84 for email. In-app alerts still go out every 30 minutes, so up to 48 a day.
  - If the digest is the whole fix, N474 can close on #84's tests.
  - If not, the in-app cap is about 20 lines: skip a send while `last_matched_at` is recent.

## Commerce and money

Proof PR: #101, from `cloud/os-proof-sweep-commerce`.

| Item | Title | Status | Plan id / batch | PR / commit | Proving test (file › test name) |
|---|---|---|---|---|---|
| N411 | Buyer cannot get a refund if the seller never ships | OPEN, CLAIMED | N6 / OS-W29 (local) | — | — |
| N415 | Dispute and purchase evidence can be deleted | FIXED | N12, N99 / OS-W15 | #73 / d5a3eff | `supabase/tests/media_integrity_guard.sql` › checks 2 to 4, "member credentials cannot delete or overwrite evidence or media objects (N12)", "staged uploads are server-registered, owner-bound and immutable (N12)", "references and deletion targets share one (bucket, path) identity (N12, N99)"; `src/lib/media-lifecycle.test.ts › removeMediaObject — the GC's owner check (N12) › treats an object outside the verified owner's folder as invalid, never touching storage` |
| N416 | Closing a dispute releases payout during an open chargeback | FIXED | N13, N223 / OS-W18 | #72 / 4890bfd | `src/lib/payments/transfer-worker.test.ts › bank chargeback freeze › is frozen by one unresolved chargeback among resolved ones`; `… › shelves a fresh payout while the chargeback is %s`; `supabase/tests/chargeback_payout_freeze_guard.sql` |
| N481 | Checkout dead-ends after a reload or address change | OPEN, CLAIMED | N85 *(inferred)* / OS-W17 (local) | — | — |
| N482 | Cart page hides its error messages | OPEN, CLAIMED | N86 *(inferred)* / OS-W17 (local) | — | — |
| N483 | Finish checkout on a pending cart order opens the wrong page | OPEN, CLAIMED | N87 *(inferred)* / OS-W17 (local) | — | — |
| N484 | Guests can hold any listing for free, at scale | OPEN, CLAIMED | N89 / OS-W31 (cloud A) | — | — |
| N485 | Payment step breakdown uses stale numbers | OPEN, CLAIMED | N90 *(inferred)* / OS-W17 (local) | — | — |
| N486 | Resolved disputes can be reopened | OPEN, CLAIMED | N91 / OS-W29 (local) | — | — |
| N487 | A one-cent refund offer stalls a dispute | OPEN, CLAIMED | N92 / OS-W29 (local) | — | — |
| N488 | Re-generating a pickup pass can erase proof of collection | FIXED | N93 / OS-W19 | #82 / e952c8d | `supabase/tests/fulfilment_integrity_guard.sql` › check 3 "a completed handoff can never be reset by a mint" |
| N489 | Mark shipped calls EasyPost before checking the seller | FIXED | N94 / OS-W19 | #82 / e952c8d | `src/features/commerce/order-fulfillment-actions.test.ts › markShipped › N94: a stranger's dispatch makes zero provider calls` |
| N490 | Delivery proof is not tied to the order | OPEN, CLAIMED | N95 / OS-W29 (local) | — | — |
| N491 | Shipping quotes are unthrottled | FIXED | N96 / OS-W19 | #82 / e952c8d | `src/features/commerce/shipping-quote-actions.test.ts › quoteCartShipping › fails closed: an exhausted or unanswerable quota makes no provider call and writes no rows` |
| N493 | Evidence uploads need no dispute | FIXED | N100 / OS-W15 | #73 / d5a3eff | `supabase/tests/media_integrity_guard.sql` › check 1 "evidence uploads only into an open dispute the uploader is party to (N100)"; `src/lib/media-url.test.ts › isOwnedDisputeEvidenceRef › refuses %s` |
| N497 | Error reports drop the actual error on money paths | FIXED | N104 / OS-W27 | #81 / d9d3832 | `src/lib/monitoring.test.ts › nested errors (N104) › keeps name, message and stack of an Error nested in an object`; `… › reportError logs and reports the nested error, not {}` |
| N498 | charge.refunded handler expects an old Stripe shape | OPEN, CLAIMED | N105 / OS-W20 (local) | #91, open | — |
| N499 | Transfer crash recovery only searches 1,000 transfers | OPEN, CLAIMED | N106 / OS-W20 (local) | #91, open | — |
| N500 | A restricted seller account strands payouts | OPEN, CLAIMED | N8 / OS-W20 (local) | #91, open | — |
| N502 | Stripe webhooks stuck on retry are not reported | FIXED | N109 / OS-W09 | #80 / 1e06cdb | `src/app/api/stripe/webhook/route.test.ts › Stripe webhook retries are recorded (N109) › counts a retry outcome against the claimed event`; `src/lib/payments/webhook-failures.test.ts › recordWebhookFailure › records a retry and reports it with the attempt count` |
| N504 | Core money logic has no unit tests | OPEN, CLAIMED | N111 / OS-W20 (local) | #91, open | — |
| N507 | Payouts are slow and blocked rows can starve ready ones | OPEN, CLAIMED | N114 / OS-W20 (local) | #91, open | — |
| N508 | No daily reconciliation of the ledger against Stripe | OPEN, CLAIMED | N115 / OS-W20 (local) | #91, open | — |

Notes:
- **N416:** Neil ruled that an open chargeback freezes the payout (blockers plan, N13 + N223). The in-app close isn't refused. The freeze is what's proven. A live test-mode chargeback is still part of R-unproven.
- **N504:** `money-worker.ts` has partial tests on main. `dispute-sla.ts`, `capture-reconciliation.ts` and `receipt-worker.ts` have none.

## Admin, ops and CI

Proof PR: #103, from `cloud/os-proof-sweep-ops`.

| Item | Title | Status | Plan id / batch | PR / commit | Proving test (file › test name) |
|---|---|---|---|---|---|
| N232 | Recovery plan ignores storage files and Stripe state | OPEN, UNCLAIMED | not in a batch (hosted restore is R77, owner) | — | — |
| N410 | Two high-severity dependency vulnerabilities (undici, zod) | FIXED, test added here | N2 / OS-W01 (OS-PR65) | #65 / f2b8eee | `tests/ci/dependency-advisories.test.ts › production dependency advisories (N410, B1) › verify fails on any high or critical production advisory, and release-gate needs verify`; `… › the lockfile resolves %s at or above %s` |
| N414 | Admin console checks access only in the layout | FIXED | N11 / OS-W14 | #87 / 8338418 | `src/lib/admin/read-gate.test.ts › every privileged read checks for itself › %s 404s a signed-out request before any all-access read`; `src/lib/admin/guard.test.ts › the console read gate (N11) › sends a lapsed step-up (TOTP over 15 minutes old) back to verify, with no client` |
| N525 | One wrong migration command can wipe the database | OPEN, CLAIMED | N131, N246 / OS-W10 (local) | #92, open | — |
| N528 | Deploys don't wait for CI or check migrations | OPEN, UNCLAIMED | N3 (deploy half, owner/hosted); migration check in no batch | — | — |
| N529 | Finance CSV exports stop at 1,000 rows | FIXED | N133 / OS-W14 | #87 / 8338418 | `src/app/(admin)/admin/export/route.test.ts › orders export (N133) › exports all 2,500 orders, past the 1,000-row cap, each exactly once`; `src/lib/admin/queries-complete.test.ts › Users filters (N133) › asks the database for the Sellers page, with no capped listing or order fetch` |
| N530 | A failed admin refund locks refunds on the order | FIXED | N134 / OS-W14 | #87 / 8338418 | `src/lib/admin/refund-refusal.test.ts › auditedAction and refused refunds › closes the request when the refusal is proven and the records agree`; `supabase/tests/admin_refund_refusal_guard.sql` |
| N531 | Admin exports are not audited | OPEN, UNCLAIMED | N135 (not in a batch; #87 left it for Neil) | — | — |
| N532 | New admin MFA enrolment is first-come | FIXED | N136 / OS-W14 | #87 / 8338418 | `src/lib/admin/guard.test.ts › unconfirmed authenticators (N136) › sends a promoted member the operator hasn't confirmed to /admin-verify, never the console`; `supabase/tests/admin_enrolment_guard.sql` |
| N534 | Admin pages hide database errors | FIXED | N138 / OS-W14 | #87 / 8338418 | `src/lib/admin/queries-complete.test.ts › audit log (N138) › throws on a failed read, never 'No actions recorded'`; `… › member detail (N138) › throws when the member can't be read, instead of saying they don't exist` |
| N536 | Moderation messages are misleading | OPEN, CLAIMED | N140 / OS-W21 (cloud A) | `cloud/os-w21-moderation`, not merged | — |
| N537 | CI jobs don't restrict GitHub token permissions | FIXED | N141 / OS-W02 (OS-PR33) | #33 / aca3fa5; #78 / 4488e10 | `tests/ci/workflow-policy.test.ts › public-repository workflow hardening › $name defaults the token to read-only and never grants write`; `… › only the incremental secret scan widens the token, and only to read PRs` |
| R-migrations | Shared dev migration tracking is unreliable | OPEN, UNCLAIMED | blockers plan, "Owner or hosted": "Claude can build a read-only report" | — | — |
| R53-pr | Design docs PR has conflicts | OPEN, UNCLAIMED | none | #53, open | — |

Notes:
- **N410:**
  - **What's on main:** `npm audit --omit=dev` reports 0 vulnerabilities.
  - **Already guarding it:** CI's verify job runs `npm audit --omit=dev --audit-level=high`.
  - **What the new test adds:** it pins that step, and that the lockfile resolves next ≥ 16.4.1, undici ≥ 8.12.2 and zod ≥ 4.6.6. A dropped step or a lockfile downgrade then fails `npm test` offline.
- **N414:** every read goes through the read gate. Also gating `/admin` in `src/proxy.ts` would be defence in depth only, so it isn't required.
- **N532:** #87's migration still needs applying, and the first admin's enrolment still needs confirming on the hosted project.
- **N528:** the deploy half needs the hosting account (N3). The migration half is a health check comparing the expected latest migration with the database, about 50 lines. It only means something once #92 records migration history.
- **N531:** needs Neil's decision on whether the read-only viewer role may export. Writing the audit row is about 15 lines plus a test.
- **N232:** runbook §6 names storage-object restore and Stripe reconciliation in one line each. There's no procedure or script for either, and the hosted rehearsal is "Pending".
- **R-migrations:** no report script on main.
- **R53-pr:** #53 is `dirty`. It has 5 conflicting files (`docs/production-runbook.md`, `docs/site/components.md` and three `opengraph-image.tsx`) and is 189 commits behind main.

## Agent

Proof PR: #104, from `cloud/os-proof-sweep-agent`.

| Item | Title | Status | Plan id / batch | PR / commit | Proving test (file › test name) |
|---|---|---|---|---|---|
| N514 | Chat turns have no timeout | FIXED | N121 / OS-W04 | #64 / 073d133; #79 / a947d92 | `src/lib/ai/run.test.ts › one turn's own bounds (readiness 67, N121) › stops at the deadline: the abort reaches the hanging request, and the turn is settled`; `src/features/agent/chat.test.ts › sendAgentMessage › runs one turn with a deadline, then stores the reply against the same request` |
| N517 | Prompt injection can plant a hidden link in a build change | OPEN, CLAIMED | N124 / OS-W07 (local) | #94, open | — |
| N521 | Suspended members can still use the agent | FIXED | N127 / OS-W04 | #64 / 073d133 | `src/features/agent/chat.test.ts › sendAgentMessage › refuses a suspended member before storing, fetching, reserving or calling anything` |
| N522 | Approving an expired offer is recorded as accepted | OPEN, UNCLAIMED | none found (W05's N128 is "agent database authority"; not confirmed to cover it) | — | — |

Notes:
- **N522:**
  - **The bug:** `agent_approval_decide` (only definition: `20261021100100_agent_worker.sql`) marks the approval `approved` even when `offer_move_core` answers `expired`. The offer itself is not accepted.
  - **The fix:** a forward migration that records `superseded` instead. The status check already allows it.
  - **The proof:** a check in `supabase/tests/agent_worker_guard.sql`. It needs a database, which this session didn't have.

## Needs Neil or a local session (hosted systems, secrets or spend)

| Item | Title | Status | Plan id / batch | PR / commit | Proving test (file › test name) |
|---|---|---|---|---|---|
| R-unproven | Money paths are unproven on hosted systems | NEEDS NEIL / LOCAL | blockers plan, "Owner or hosted" | — | — |
| R75 | Nothing has run against a real model on record | NEEDS NEIL / LOCAL | blockers plan, "Owner or hosted" | — | — |
| R-staging-behind | Staging is 2 migrations behind main | NEEDS NEIL / LOCAL | R-staging (#85) | — | — |
| N503 | Orders of $1,000 or more need DRVN Shipping to be live | NEEDS NEIL / LOCAL | N110 / OS-W30 (code), owner setting | #82 / e952c8d (code) | — |
| N429 | Content Security Policy may block Stripe's payment frames | NEEDS NEIL / LOCAL (code half FIXED) | N25 / OS-W27 | #81 / d9d3832 | Code half: `src/proxy.test.ts › Content Security Policy header (N25) › admits Stripe.js's frame and script origins for the Payment Element and 3-D Secure`; `src/app/api/monitoring/csp/route.test.ts › CSP report intake › forwards a blocked Stripe frame as a tagged warning` |

Notes:
- **R-staging-behind:** #85 brought staging level with main at 232 migrations. Main has since gained 5 more (`20261107200100`, `200300`, `200500`, `200510` and `200520`). Whether staging has them needs a check against staging itself.
- **N503:** #82 removed the $1,000 dispatch rule from the code. Whether the hosted setting matches is the owner's check.
- **N429:** the `*.js.stripe.com` origins and the report endpoint are proven. The remaining half is one real test-mode checkout with a 3-D Secure card in a browser, which needs hosted Stripe.

## Claimed by cloud D

| Item | Title | Status | Plan id / batch | PR / commit | Proving test (file › test name) |
|---|---|---|---|---|---|
| R69-age | No 18+ confirmation | CLAIMED (cloud D) | R69 | — | — |
| R69-dmca | No copyright takedown route | CLAIMED (cloud D) | R69 | — | — |
| N629 | Updated date and change announcement before publishing | CLAIMED (cloud D) | — | — | — |
| R-audit-composer | Phone agent composer sits under the bottom bar | CLAIMED (cloud D) | — | — | — |

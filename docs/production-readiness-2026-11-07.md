# DRVN production-readiness review: 7 November 2026

A whole-codebase readiness review of `main` at `c4d318f` (merge of PR #136, 8 Nov 03:12 UTC; checks below ran on `43aef2a`, one docs-free commit earlier), written on the evening of Saturday 7 November 2026 (US Eastern). It covers everything merged that day, re-checks the nine launch blockers from `docs/production-readiness-2026-11-03.md`, reconciles the Intelligence OS's open list against the code, and sets out what still stands between this repository and a real product with real members and real money.

**How to read this**

- **Severity:** Blocker (fix before any real member or payment) · High (before public launch) · Medium (soon after, or before scale) · Low (polish).
- **Confidence:** Checked (re-traced in code or reproduced today) · Reported (a session or document says so and it was not re-traced) · Needs a live test.
- Finding ids: `B1`–`B9` are the 3 November blockers. `N###` and `R-…` are the Intelligence OS's ids. New findings in this review are `#88` onward, continuing report two's numbering (60–87).
- Sources: the code and migrations on `main`; GitHub PR and run data; a read-only probe of the shared dev and staging databases; the local check suite; and written summaries from the seven other sessions that worked on DRVN today (blockers and CI, Work Board, staging, OS, OS alignment, OS reconstruction, machine performance, Fable review). Nothing in the project was modified other than adding this file.

---

## 1. The short version

**Verdict: not yet a real product. No-go for real members or real money this week, and for a different reason than on 3 November.** On 3 November the gaps were in the code. After today, the code is close to release-candidate quality and the remaining gaps are mostly things only the owner can do: hosting, a domain, an email provider, a production database, Stripe live mode, counsel, tax and the legal entity. The code itself needs about a week of stabilisation after the largest single day of change in the project's history.

| Area | 3 Nov | Today | Why |
|---|---|---|---|
| Code correctness and safety | 55 | 85 | Six of nine blockers fixed in code; rules moved into the database; disputes, payouts, media, admin, sign-in all hardened |
| Tests and CI | 60 | 75 | Local suite green; CI gates every merge; but main was red for an hour today, one new test is timing-flaky, and 12 merged PRs still owe a Codex review |
| Environments and operations | 20 | 35 | Staging exists; no production project, hosting, domain, email, Sentry, alerts, PITR or hosted restore drill |
| Money on hosted systems | 40 | 50 | Settlement, chargeback freeze, reconciliation and payout setup are built; none of it has run against Stripe on a hosted deployment |
| Legal and privacy | 30 | 40 | 18+ and copyright takedown landed; terms still a draft, no tax, deletion still keeps traders' data |
| Agent | 55 | 70 | Model boundary, modes, kill switch and private photos landed; no real-model run on record; tool contracts in an open PR |
| **Overall** | **69** | **78** | Still no-go: the owner path is long, and the code needs to settle |

**What happened today, in numbers**

| Measure | Value |
|---|---|
| PRs merged on 7 November (US Eastern) | 62 (#61–#136, including nine opened in late October) |
| PRs opened | 70 |
| PRs still open at the time of writing | 13 |
| Commits on `main` since midnight | 268 |
| Files changed since the 3 November baseline (`ce19681`) | 738 (+61,092 / −5,406 lines) |
| Migrations added since 6 November | 44 (`main` now holds 262 files) |
| Shared dev | all 44 applied, plus `job_config.media_storage_origin` set |
| Staging | 232 of 262 applied, 30 behind `main` |
| Intelligence OS blockers | 99 open, 125 resolved (was 175 open this morning before the OS's identity repair) |

**The ten things that matter most**

1. **#88 `main` has had no finished green run since 02:03 UTC, and the run that would prove the fix keeps being replaced.** The 02:16 run (merge of #123) failed a non-deterministic SQL guard (#100). Every run since #126 merged at 02:37 failed because #123's new guard updated `beta_access_config`, which #126 dropped. PR #136 fixed that at 03:12, but each later merge (#135, #119, #134) replaced the queued main run before it started, so at the time of writing the only run executing predated the fix. Hold merges to `main` for about 35 minutes after the current run finishes so one run can complete. Treat #126, #129, #130, #131 and #135 as merged on a red main until it does.
2. **#89 Three merged PRs carry P1 defects that are live on shared dev and fixed only in open follow-ups.** #123 (payout setup: dispatch fence bypass, refund queue starvation, a partial refund blocking a full one) is fixed in #134; #122 (withdrawal undoes moderation, buyer offer history 404s) in #132; #105 (stale mod-sheet overwrites) in #133. None of the three should be deployed anywhere without its follow-up.
3. **B7 is still open:** account deletion keeps a trader's email, address and messages, and the worker returns before deleting the Stripe customer, while `src/app/(legal)/privacy/page.tsx:299` still promises saved cards are deleted. The fix is the queued batch OS-W34; PR #119 (W11) covers only suspended members' rights and the ZIP export.
4. **B3 is still open:** there is no sales tax anywhere in the code and the Terms are still headed as an unreviewed working draft. Both are the owner's and counsel's.
5. **B6 is half done:** a staging project exists, but there is no production project, no hosting account, no domain, PITR was deferred, and the hosted restore drill has not run.
6. **Nothing has ever deployed.** `.github/workflows/` has `ci.yml` and `worker-monitor.yml` only. The release gate protects `main`, not a deployment, because there is no deployment to protect.
7. **Twelve merged PRs have no Codex review yet** (#95, #98 if merged, #100–#103 if merged, #125, #126, #129, #130) and three follow-ups owe a fix-check (#132, #133, #134). Neil ruled Codex never blocks a merge, so this is a debt, not a stop, but it is the largest unreviewed surface the project has carried.
8. **The money paths have never run against Stripe on a hosted system.** 3-D Secure, wallets, a Connect payout, a provider dispute and the day-14 payout-setup refund are all unproven outside unit tests and the stub.
9. **Owner decisions are the critical path.** The OS counts 22 decisions, 20 owner setups and 19 counsel tasks among its 99 open items; the code work that is left (38 items) is smaller than the owner work for the first time.
10. **Two things merged today that Neil had said to hold.** PR #117 shipped the 18+ confirmation and the copyright takedown route, which the 7 November rulings listed under "Not now". Both are reversible; he should rule whether they stay.

---

## 2. What landed on 7 November

Grouped by area. Every PR carried its Intelligence OS task ids in its title; migrations are named where the change lives in the database.

### Money, payouts, disputes and fulfilment (12 PRs)

- #72 OS-W18: an unresolved bank chargeback freezes the seller's payout (`20261107130000`). Closes B9 by Neil's ruling.
- #82 OS-W19/W30: locked Pickup Pass mint, seller-first dispatch, the $1,000 tracking rule removed, throttled quotes, real hold expiry (`20261107200100`).
- #89 and #113 OS-W16: the listing write boundary and payout readiness held in the database (`20261107210000`, `20261107210050`).
- #91 OS-W20: settlement correctness, payout admission served longest-due first, admin retry, and a daily read-only ledger reconciliation job (`20261107210100`).
- #106 and #90 R-hold: every payout-hold fallback is 2 days (`20261107220900`).
- #108 OS-W29: eBay-style dispute recourse with frozen dispatch and delivery dates, a 30-day not-received window, 3 business days for the seller, escalation to day 21, expiring refund offers and verified delivery proof (`20261107210300`). Closes B2 in code.
- #111 OS-W17: checkout resume, restart and reservation release (`20261107232000`).
- #122 OS-W33: listings with offers are withdrawn, never deleted (`20261107220700`).
- #123 and #131 N244: eBay-style payout setup, 14 days to finish (`20261108100000`, `docs/decisions/seller-payout-setup.md`).

### Agent (11 PRs)

- #64 and #79 OS-W04: the model boundary: hosted schedule for the worker (`20261026100000`, closes B8 in code), redacted history, kill switch and spend reserved before any model call, turn deadline and replay, suspended members refused.
- #66 OS-W06: buyer stop and the member's agent mode held in the database (`20261107170000`, `20261107190000`); checkout says who set the price.
- #96 OS-W05: approvals record accepted only when the offer move accepts (`20261107210500`).
- #116 and #127 OS-W08: private agent chat photos; image bytes reach the model only in an explicit photo job (`20261107220300`).
- #102: typed agent measure statuses; PRD W-3 keeps the picker.
- #61, #114, #125: the local jobs runner sweeps the agent; "Stopped." survives a revoked mandate.

### Sign-in, account and admin (5 PRs)

- #86 OS-W12/W13: the open redirect, the password change without a recovery session, and the sign-in messages and layout.
- #112: deletion and password change require fresh proof at the database and Auth boundary (`20261107200450`).
- #87 and #110 OS-W14: every admin read goes through the gate, exports are complete and paged, refused refunds release, admin MFA is operator-confirmed and the session is bound to the factor (`20261107200500` to `200550`). Closes B4.
- #69 OS-p1-commerce: review refusal copy, email-change landing, importer spend cap, stuck-credit payout console, the fixture password out of the tree.

### Social, garage, media and moderation (8 PRs)

- #73 OS-W15: one identity per storage object, server-only staging, immutable dispute evidence, deleted-content cleanup, HEIC copy (`20261107203000`). Closes B5.
- #77 OS-W22: complete counts and joined feeds at scale (`20261107180000`, `180100`).
- #83 OS-W24: Home fold after post eight, Explore captions, narrow cache invalidation.
- #95 OS-W21: database write quotas for messages, comments, reactions, follows, questions and reports (`20261107220000`), car reports and holds (`220010`), private notification settings (`220020`), honest report outcomes. Closes the "rules only in the app" theme.
- #105 OS-W23: versioned build sheet, one-transaction showcase, gallery caps on every write path (`20261107220100`, `220110`).
- #121 and #128 OS-W32: private blocks, suspended members hidden, a real "Message seller", system offer moves that bypass blocks correctly (`20261107220600`, `230000`).

### Discovery, public pages and legal (7 PRs)

- #71 OS-W25: suggest-endpoint rate limit, foreign-key indexes, publication time for Newest, importer IPv6 guard (`20261107153100`, `153200`).
- #74 OS-W26: qualified provenance claims, post sitemaps, database-free robots, honest share and fees copy (`20261107150000`).
- #84 and #115 OS-W35: saved-search email digests, at most one per search per day (`20261107200300`, `200350`).
- #109 OS-W28: a counted listing view records the surface it came from (`20261107220200`).
- #117: 18+ confirmation at sign-up, onboarding and guest checkout (`20261107231001`), copyright notices and a takedown route (`231002`), dated legal pages and member announcements (`231003`), the phone composer above the bar.
- #126 OS-W31: the invite-only beta removed; guest holds capped per device, network and listing (`20261107220800`).

### CI, jobs, migrations and operations (10 PRs)

- #65 OS-W01: Next 16.4.3, undici 8.12.3, zod 4.6.7. Closes B1.
- #88: runs on `main` finish; only superseded pull-request runs are cancelled.
- #78 OS-W02: the CI Supabase start retry kills the whole process tree.
- #80 OS-W09: constant-time job auth, one job inventory, health judged by running (`20261107170000` job inventory).
- #81 OS-W27: nested errors kept in monitoring; Stripe.js frames admitted in CSP with violation intake.
- #92 and #120 OS-W10: the migration runner dry-runs first, allow-lists its target, verifies TLS and records history.
- #75, #76, #129: an offer-accept replay race, a lint warning, and WebKit clicks landing mid-scroll (smooth scrolling now honours reduced motion).

### Docs and proof (8 PRs)

- #63 OS-PR63: runbook, owner checklist and migration record brought level with main.
- #68 and #70: the 3 November review, the November blockers plan, and Neil's rulings on the 25 decision items.
- #85: staging set up and recorded.
- #93: payout-hold docs, the Stripe API version pinned where the client is created, privacy and terms copy.
- #97: the readiness crosswalk mapping the OS's 88 N4xx and R items to plan ids, PRs and proving tests.
- #118, #124, #130: behaviour tests for the 13 untested P0 requirements.

### Open at the time of writing (13)

| PR | What | State |
|---|---|---|
| #134 | N244 payout deadline fences, fair retries, complete refunds (fixes #123's P1s) | money, checks running |
| #133 | OS-W23 every build-sheet write takes the sheet lock (fixes #105's P1s) | sql-guard red on the old main; needs a rerun |
| #132 | OS-W33 withdrawal can't undo moderation; buyers keep offer history (fixes #122's P1s) | sql-guard red on the old main; needs a rerun |
| #135 | duplicate of #136's one-line guard fix | superseded, close |
| #119 | OS-W11 account privacy lifecycle: suspended members keep export and deletion, ZIP export | green except e2e pending |
| #107 | OS-W20 ledger reconciliation and refund gap follow-ups | money, green |
| #94 | OS-W07 agent tool contracts, safe build links, audit trail | green, Codex fix-check done |
| #98, #100, #101, #103 | proof sweeps: tests naming OS ids for items fixed by earlier PRs | green |
| #67 | the 3 November review with B1 marked fixed | docs, green |
| #53 | design docs reconcile | conflicts with main since 2 Nov |

---

## 3. Health checks run today

Run on a clean checkout of `main` at `43aef2a` with a fresh `npm ci`, one job at a time (the Mac's worktree governor pauses a second heavy job under memory pressure).

| Check | Result |
|---|---|
| Production dependency audit (`npm audit --omit=dev`) | **0 vulnerabilities** (3 Nov: 1 critical, 2 high) |
| Typecheck (`tsc --noEmit`) | Pass |
| Lint (`eslint . --max-warnings=0`) | Pass, 0 warnings (3 Nov: 655 warnings) |
| Unit tests (`vitest run`) | **2,494 passed, 2 failed, 8 skipped, 296 files** (3 Nov: 1,183 tests) |
| Generated database types (`db:types:check`) | Not run locally: it needs a local Supabase on port 54322, which was stopped. CI's `sql-guard` job runs it and passed on every green main run today |
| CI on `main` | Last fully green run: `cfd7da5` (PR #125, 02:03 UTC: verify, e2e on chromium, firefox and webkit, sql-guard, stripe-integration, secrets). `b1f532a` failed `sql-guard` on a non-deterministic approval guard (#100); every run since 02:37 failed it on the dropped beta table (#88). The runs for `c4d318f` and later heads were queued or replaced |
| Migrations from scratch | Not run locally (Docker stopped). PR #135's author ran all 262 on a fresh PostgreSQL 17 with the CI shim and every guard passed; CI's `sql-guard` does the same on every PR |
| End-to-end (Playwright) | Not run locally. Passed on `main` at `b1f532a` on all three browsers |

**#90 The two unit failures are one timing-flaky test, not a product bug (Low, Checked).** `src/lib/copyright/blocked-media.test.ts` (from #117) passes a synthetic clock to `blockedMediaKeys(now)` but the module stamps its cache with the real `Date.now()` (`src/lib/copyright/blocked-media.ts:49`), so under load the cache is still fresh when the test expects it to have expired. It passed twice in isolation and passed in CI. Fix: stamp the cache with the `now` argument.

**Shared dev and staging, probed read-only today**

| Project | Migration history | Objects |
|---|---|---|
| Shared dev | 36 rows in `supabase_migrations.schema_migrations` (0001–0011 plus everything applied with the new runner since #92); the other 228 applied files are unrecorded | Every object from today's migrations is present: `pickup_mint_pass`, `withdraw_listing`, `agent_mode_set`, `admin_retry_transfer_intent`, `claim_payout_deadline_cancellations`, `media_object_referenced`, `member_blocks`, `copyright_notices`, `ledger_reconciliation_runs`, `profiles.payout_details_submitted` |
| Staging (`drvn-staging`, via the read-only `os_reader` role) | 232 rows, highest `20261107203000` | 30 files on `main` are not applied: `20261107200100` through `20261108100000` |

**#91 Shared dev's migration history is unreliable until it is backfilled (Medium, Checked).** The runner now records history, but 228 earlier files show as pending to it. A whole-tree apply would try to replay them. Backfill the history table from the applied set before anyone runs the tree, and never run the tree until then. (OS id R-migrations.)

**#92 Staging is 30 migrations behind main (Medium, Checked).** The OS's own `R-staging-behind` check fired today. Apply `20261107200100` through `20261108100000` with the runner, then set `job_config.media_storage_origin`, `transfer_worker_url` and `transfer_worker_secret` on staging, or no photo reference and no hosted job will work there.

---

## 4. The 3 November launch blockers, re-checked

Each one re-traced in the code on `main` today, not taken from PR titles.

| id | 3 Nov finding | Today | Evidence | What remains |
|---|---|---|---|---|
| B1 | The installed Next.js version has a critical published security advisory | **Fixed** | lockfile resolves next 16.4.3, undici 8.12.3, zod 4.6.7; audit clean; CI audits at `high` | `package.json` ranges still say `^16.3.8`; the lockfile pins the fix |
| B2 | A buyer who has paid has no self-service way to get their money back if the seller never ships | **Fixed in code** | `20261107210300`: `freeze_order_deadlines`, `open_order_dispute` for "item never arrived" from the frozen delivery date for 30 days, 3 business days for the seller, escalation to day 21, `begin_not_received_refund`; `src/lib/payments/dispute-clocks.ts` sweeps from the money worker | Needs a live test on hosted Stripe |
| B3 | No sales tax, and the Terms are marked in the code as an unreviewed draft | **Open** | no tax code in `src/`; `src/app/(legal)/terms/page.tsx:35` still "NOT LEGAL ADVICE, working draft"; `docs/legal-review-checklist.md` tax item unchecked | Owner and counsel: entity, jurisdiction, tax, review |
| B4 | Admin console pages check access only in the layout, while reading data with the all-access key | **Fixed** | every read in `src/lib/admin/queries.ts` takes its client from `requireAdminRead()`; `read-gate.test.ts` enumerates every exported read, page and export route | the proxy does not also gate `/admin` (defence in depth only) |
| B5 | Dispute and purchase evidence can be deleted | **Fixed** | `20261107203000`: members never delete media or evidence objects, evidence is immutable, `staged_uploads` locked down, media-gc passes the owner | `job_config.media_storage_origin` must exist on every hosted project or photo saves fail closed |
| B6 | There's no production or staging project, no hosted backups, and restore has never been rehearsed | **Partly** | `drvn-staging` exists on the Pro org with daily backups; `docs/staging-setup.md` steps 3–13 not started; no PITR; restore gate not run | production project, hosting, PITR ruling, hosted restore drill |
| B7 | Deleting your account keeps your email, address and messages forever if you've ever bought or sold | **Open** | `src/lib/account-deletion-worker.ts:108-123` still parks traders in `operator_attention` and returns before the Stripe customer delete at `:125`; no scrub migration on `main` | OS-W34 (deletion scrub with a keyed email digest, 6-year financial clock, username constraints), queued behind #119 |
| B8 | The AI agent's background worker is never scheduled | **Fixed in code** | `20261026100000` schedules `drvn-agent-worker` every 5 minutes through `invoke_remediation_worker('agent')`; the health inventory lists it | hosted `job_config` rows and `AGENT_WORKER_DATABASE_URL`, else the invoker returns silently |
| B9 | Closing a dispute inside DRVN releases the seller's payout while a bank chargeback is still open | **Fixed** | `20261107130000`: `order_has_unresolved_chargeback` enforced in `mark_due_transfer_intents`, `claim_transfer_intents`, `prepare_transfer_dispatch`, mirrored in `transfer-worker.ts` | by Neil's ruling the in-app close stays allowed; the freeze is the fix. Live test-mode chargeback not run |

**The five themes from 3 November**

| Theme | Today | Evidence |
|---|---|---|
| Rules only in the app, not the database | **Fixed** | `20261107220000`: before-insert triggers on messages, comments, reactions, likes, follows, saves, questions and reports call `consume_rate_limit`; follow and like notifications deduplicated per day; `20261107210000` holds the listing write boundary; `20261107220100` caps gallery writes |
| Safety nets for things going wrong | **Mostly fixed** | B2, B9, payout admission, restricted-seller handling (`20261108100000`), checkout resume, settlement reconciliation. Open: deletion of former traders (B7) |
| Operations | **Partly** | CI gates every merge; migration runner hardened; staging exists. Open: everything hosted (section 7) |
| Legal and privacy | **Partly** | 18+, copyright takedown, dated pages, private notification settings, private agent photos. Open: tax, counsel, retention, deletion scrub, DMCA agent registration |
| The small number of real security bugs | **Fixed** | open redirect (`safe-redirect.ts` rejects control characters and requires same origin), password change needs a recovery session (`hasRecoveryAuthorisation`, `secure_password_change = true` in `config.toml`), admin read gate, evidence deletion, Next advisory |

Other 3 November items re-checked: photos after delete now queue in `media_cleanup_queue` and are removed when unreferenced (Fixed; edge-cached copies are not purged); the silent 1,000-row cap is gone from the named pages (watch counts, reaction counts, follower counts, admin exports; not every count site was re-audited); Stripe CSP frames admit `*.js.stripe.com` with a report endpoint (Fixed in code; one real 3-D Secure checkout still owed); sign-up has an app throttle of 3 per hour per address but no CAPTCHA (Partly); username constraints, reserved names and tombstones are still absent (Open, OS-W34).

---

## 5. New findings on main (88 to 100)

**#88 `main` has been red on `sql-guard` since 02:37 UTC and no run has yet proved the fix (High while it lasts, Checked).** Described in section 1. Fixed in code by #136. What it shows: two cloud sessions merged conflicting changes (#126 dropped a table, #123 added a guard that used it) within forty minutes, and nothing before the merge caught it because each PR was green against the main it was based on; then the merge rate itself kept the proving run from starting, because a queued run in a concurrency group is replaced by the next push even with cancel-in-progress off. Rules to adopt: a PR that was green more than an hour ago, or that a later merge touched the same schema objects as, gets its checks rerun on current main before merging; and after a fix to a red main, merges pause until one main run finishes.

**#89 Three merged PRs carry P1 defects fixed only in open follow-ups (High, Reported by the blockers session, titles confirmed).** #123 → #134, #122 → #132, #105 → #133. Merge the three follow-ups before anything deploys, and apply nothing from #123 to staging without #134.

**#90 Timing-flaky copyright test (Low, Checked).** Section 3.

**#91 Shared dev migration history unrecorded for 228 files (Medium, Checked).** Section 3. OS id R-migrations.

**#92 Staging 30 migrations behind main (Medium, Checked).** Section 3. OS id R-staging-behind.

**#93 The privacy page still promises saved cards are deleted (High, Checked).** `src/app/(legal)/privacy/page.tsx:299` says any saved cards are deleted at Stripe, but `account-deletion-worker.ts` returns before that step for anyone who has traded. Until OS-W34 lands, change the sentence. OS id N439.

**#94 The release-candidate script still requires the invite-only beta (Medium, Checked).** `scripts/release-candidate.mjs:7,16` requires `betaRequired: true` and an `invitation-boundaries` gate, and `docs/staging-setup.md` steps 2.5 and 12 still say to turn the gate on, but #126 removed the beta and dropped `public.beta_access_config`. The 15-gate packet cannot be produced honestly until the gate list is re-ruled and the script updated.

**#95 Twelve merged PRs and three follow-ups owe a Codex review (Medium, Reported).** Full reviews: #95, #125, #126, #129, #130, and the proof sweeps #98, #100, #101, #103 once merged. Fix-checks: #132, #133, #134. The list lives in `~/drvn-worktrees/_plan/gpt-postmerge-queue.md` on this Mac, not in the repository; it should be in the repo so the OS can see it.

**#96 Twenty-two SQL functions were restated by more than one migration today (Medium, Checked).** Spot checks found every restatement built on the latest definition, and `private.scheduled_job_inventory` (restated four times) still carries `saved-search-digests`, `ledger-reconciliation` and `payoutDeadlines`. The risk is the next restatement: whoever touches the inventory or `invoke_remediation_worker` must copy all three families. A SQL guard that asserts the inventory's row count and family names would make this mechanical.

**#97 Three migrations were renamed after rebase, so filename order is not apply order (Low, Checked).** `20261107170000` was written as `20261026130000`, `20261107203000` as `150500`, and `20261108100000` is dated after the day it merged. Find new files by `git diff --diff-filter=A`, as `docs/staging-setup.md` already says, never by name.

**#98 The crosswalk cites a test that is not on main (Low, Checked).** `docs/plans/2026-11-readiness-crosswalk.md` names `tests/ci/dependency-advisories.test.ts` for B1; `tests/ci/` holds no such file. The proof-sweep PRs that add other named tests (#98, #100, #101, #103) are open, so their tests are not on `main` either.

**#99 Eighty-five uncommitted design-concept files sit in the main checkout (Low, Reported by the board session).** `design-mockups/` assets and ledger changes have been uncommitted on the shared checkout for weeks and Neil never ruled on them. Commit them to a branch or discard them; a dirty shared checkout hides real changes.

**#100 `supabase/tests/agent_approval_outcomes_guard.sql` is non-deterministic (Medium, Reported by the CI investigation session, log confirmed).** The `b1f532a` run on `main` failed it with "FAIL 8: a refused accept was recorded as refused /" (status refused, no owner event), the replay branch of the decide function, when nothing merged since the green run touched approvals or offers; the same guard passed on the next two finished runs. FAIL 7 does not check `replayed`, which is why the failure surfaces as FAIL 8. A flaky guard on the release gate turns every merge into a coin toss; make the guard deterministic (fix the ordering it depends on, or assert `replayed` in FAIL 7) before it costs another red main.

Carried from 3 November and still open with no PR: usernames are only validated in the form (N442); transfer crash recovery only searches 1,000 transfers (N499, not re-traced today); old message photos may keep metadata (N627); the recovery plan rehearses the database but not storage files or Stripe state (N232, runbook §6 covers the database restore only); private cars' and draft listings' photos are publicly readable (N455, a decision); deploys don't wait for CI or check migrations (N528, moot until a deployment exists).

---

## 6. The Intelligence OS's 99 open items, reconciled against the code

The OS showed 99 open items at 21:53 Eastern: 38 an engineer can do, 22 for Neil to decide, 20 for Neil to do, 19 for counsel or another person. Of the 38 engineer items, 20 are already fixed on `main` or in an open PR. They stay open in the OS because its code checks were last run at `a99ee54` or earlier, or because the fixing PR named an older id. The OS reopens a check when a report says an item is fixed, so each is stated below.

**Fixed on main, waiting for the OS's check or for proof (one line each, with the merged PR)**

- R-audit-composer "Phone agent composer sits under the bottom bar" is fixed by #117.
- R69-age "No 18+ confirmation" is fixed by #117 (`20261107231001`); Neil to confirm it stays.
- R69-dmca "No copyright takedown route" is fixed in code by #117 (`20261107231002`); the DMCA agent registration is the owner's.
- R-directcontact "A policy branch allows unprompted contact with sellers" is fixed by #121 and #128, with the PRD's no-cold-contact line removed.
- R-hold "Fallbacks still say a seven-day hold" is fixed by #106 (`20261107220900`).
- R-betaaccess "Invited-beta access is not checked in the offer functions" is fixed by #126 removing the beta altogether (`20261107220800`).
- N62 "Notification settings are publicly readable" is fixed by #95 (`20261107220020`).
- N247 "Message rate limit can be bypassed through the database API" is fixed by #95 (`20261107220000`).
- N456 "Cars can't be reported" is fixed by #95 (`20261107220010`).
- N536 "Moderation messages are misleading" is fixed by #95.
- N484 "Guests can hold any listing for free, at scale" is fixed by #126 (holds capped per device, network and listing).
- N422 "AI privacy promise not fully kept" is fixed by #93, #64 and #116 (copy says what the agent sends; history redacted; photos private).
- N539 "Stripe API version is pinned only through the SDK" is fixed by #93.
- N629 "Updated date and change announcement before publishing" is fixed by #117 (`20261107231003`).
- N498 "charge.refunded handler expects an old Stripe shape" is fixed by #91 (`charge-refund-reconciliation.test.ts` proves the pinned shape).
- N500 "A restricted seller account strands payouts" is fixed by #91 and #123 (admission rules and `payout_restricted_at`).
- N507 "Payouts are slow and blocked rows can starve ready ones" is fixed by #91 (longest-due first, blocked rows admitted only when payable).
- N508 "No daily reconciliation of the ledger against Stripe" is fixed by #91 (`drvn-ledger-reconciliation`, 05:50 UTC).
- N504 "Core money logic has no unit tests" is largely fixed: `transfer-worker`, `payout-hold`, `payout-deadline`, `ledger-reconciliation`, `charge-refund-reconciliation` and `reservation-expiry` tests exist on `main`.
- N531 "Admin exports are not audited" is addressed by #87 (exports complete, paged and gated); whether each export writes an audit row was not re-traced today.

**In an open PR**

- R73 "The graph tools are stubs", R-audit "Agent actions leave no audit record", N170 "Starter prompts advertise things the agent cannot do" and N517 "Prompt injection can plant a hidden link in a build change" are in #94.
- N443 "Suspended members can't export or delete their data" and N450 "Data export is a JSON list of links that expire in 10 minutes" are in #119.
- R53-pr "Design docs PR has conflicts" is #53, still conflicting.

**Genuinely open for an engineer**

- N418 "Account deletion keeps personal data forever" and N439 "Deleted traders keep their saved cards" and N442 "Usernames are only validated in the form": OS-W34, queued behind #119. This is the last 3 November blocker in code.
- R-staging-behind and R-migrations: section 3.
- R75 "Nothing has run against a real model on record": needs an Anthropic key on a hosted environment.
- R-unproven "Money paths are unproven on hosted systems": needs staging steps 3 to 13.
- N232 recovery plan for storage and Stripe; N499 transfer crash recovery cap; N627 old photo metadata; N528 deploy gating (no deployment exists).

**For Neil to decide (22)**: whether the agent is in the first beta (holds 6 items), the legal entity (5), email provider (2), launch market and currency (2), one car platform and country, release configuration (shipping, search hosting, analytics), the two credit-payout choices, keep or remove "Download my data", which section-audit changes matter, edge caching, private-car photo visibility, who funds chargebacks and absorbs fees, written-off reversals, beta-specific terms, staff reading messages, provider copies after deletion, and R84 buyer acceptance ending the mandate before payment.

**For Neil to do (20)**: hosting account and domain (holds 5), Stripe test mode on a real domain, Sentry and an alert webhook, the independent monitor's repository variables, wallet and email device tests, the 15-gate packet, production and one real transaction, Supabase Auth settings (secure email change, minimum password 8, raised sign-in limits), uptime monitoring, the sandbox override absent in production, contact mailboxes, processor agreements, zero data retention with the model provider, screen-reader and device passes, repository clean-up, and copying the staging secrets into the password manager. R-password (rotate the exposed test passwords) was done on 7 November and should resolve.

**For counsel (19)**: terms and privacy review, retention schedule, tax and merchant role, supervisory authority, business sellers, held-funds and clawback wording, liability cap, standard contract clauses, lawful bases, international transfers, analytics consent, agent binding-counter terms, and the untracked auto-confirm notice.

---

## 7. What stands between this codebase and a real product

Everything here is outside the bug list. Status is read from the documents and code named; nothing hosted was inspected beyond the two database probes.

### Environments and hosting

| Item | Status | Who |
|---|---|---|
| Supabase org on Pro; `drvn-staging` created, Postgres 17, us-east-1 | Done 7 Nov | Owner |
| Staging schema level with main, plus `job_config` rows | Not done (30 behind; `job_config` empty) | Engineer |
| Staging steps 3–13: Auth URLs and SMTP, hosting project, Stripe test webhooks, EasyPost, Sentry, alerts, monitor, GitHub secret, first admin, 15-gate packet | Not started; most wait on a hosting account and domain | Owner creates, engineer configures |
| Hosting account and project (the code assumes Vercel-style `VERCEL_*` fallbacks; no `vercel.json`) | Not started | Owner |
| Domain and mailboxes (pages already print `hello@drvn.app` and `privacy@drvn.app`; ownership unconfirmed) | Not started | Owner |
| Production Supabase project (must be added to `supabase/migration-targets.json` by a reviewed PR first) | Not started | Owner and engineer |
| Deploy pipeline | None exists | Owner picks the host, engineer wires it |
| Branch protection with `release-gate`, repository public, gitleaks over all 446 commits clean | Done 7 Nov | Done |

### Configuration production needs (from `src/lib/env.ts` and `docs/production-runbook.md` §4)

- Supabase: URL, publishable key, secret key.
- Stripe (all required in live mode, the app refuses to boot without them): `PAYMENTS_MODE=stripe`, secret key, platform and Connect webhook secrets, publishable key. Never `PAYMENTS_ALLOW_STUB_IN_PRODUCTION`.
- Site and jobs: `NEXT_PUBLIC_SITE_URL` (https), `CRON_SECRET` (32+), `GUEST_RECEIPT_SECRET` (32+), `TRUST_PROXY_HEADERS` only behind a verified proxy; `job_config` rows for the worker URL, secret and `media_storage_origin`.
- Monitoring (required in live mode): `SENTRY_DSN`, `ADMIN_ALERT_WEBHOOK_URL`. Neither project exists.
- Agent: `ANTHROPIC_API_KEY`, `AGENTS_BETA`, `AGENT_MODEL`, `AGENT_WORKER_DATABASE_URL` (pooler login for the `agent_worker` role), importer model. No production key; zero data retention not arranged; agent-in-beta not ruled.
- Shipping: `FLAG_INTEGRATED_SHIPPING_V1`, EasyPost key and webhook secret. No account; EndShipper-versus-Forge model unsettled; no wallet float.
- Email: configured in Supabase Auth SMTP, no app variable. Provider not chosen (`docs/owner/email-provider.md` compares three).
- Optional: Typesense (else Postgres search), PostHog. Both undecided.

### Money

| Item | Status | Who |
|---|---|---|
| Live-mode guards, API version pin, fail-closed stub refusal | Done | Done |
| Stripe account: Connect Express, platform profile, test then live keys | Not started | Owner |
| Platform and Connect webhook endpoints per environment (`scripts/owner/stripe-webhooks.mjs`) | Not started | Owner runs it |
| Seller payout setup, eBay-style, 14 days (#123, #134) | Done in code; needs Connect live to prove | Engineer then owner |
| Radar 3-D Secure rule; negative-balances script | Not started | Owner |
| Apple Pay and Google Pay domain registration, real-device check | Not started | Owner |
| 21 pg_cron jobs calling `/api/jobs/*` once `job_config` has URL and secret | Done in schema; nothing hosted | Engineer |
| Independent worker monitor (`worker-monitor.yml`, every 15 minutes) | Has never run: skipped until repository variables are set; alerts only by GitHub email | Owner |
| Uptime monitoring and paging for the site itself | None | Owner |
| Sales tax or VAT; Stripe Tax | Not collected anywhere; decision needed | Owner and counsel |
| Who absorbs Stripe and chargeback fees and written-off reversals | Decision needed | Owner and counsel |
| One live purchase, refund, dispute and payout with a real card | Not started | Owner and engineer |

### Legal and privacy

| Item | Status | Who |
|---|---|---|
| Terms and privacy: dated 7 November, accurate to the code, still headed as working drafts; no entity, governing law, liability cap, indemnity | Partly | Counsel and engineer |
| Counsel engagement (`docs/owner/counsel-packet.md` Q1–Q16) | Not started; the longest item | Owner |
| 18+ declaration at sign-up, onboarding and guest checkout (`age_confirmations`) | Done in code; earlier members have no record; Neil had said "not now" | Owner to confirm |
| Copyright takedown route and admin queue | Done in code; `src/lib/legal/copyright-agent.ts` holds `confirmed: false` placeholders until an agent is registered | Owner (needs the entity) |
| Retention periods (privacy page says "still being set"; 12 unapproved data classes) | Decision needed | Owner and counsel |
| Deletion of former traders (B7) | Open, OS-W34 | Engineer after the retention ruling |
| Cookie and analytics consent (opt-in in Settings, no banner) | Done as built; whether it satisfies the jurisdiction is counsel's | Counsel |
| Processor list and DPAs (hosting, SMTP, Typesense, alerts, EasyPost, Sentry) | Not started; depends on providers | Owner |
| Agent clauses and the model provider's commercial terms with zero data retention | Not started; blocks opening the agent | Owner then counsel |
| Supabase Auth hardening in the hosted dashboard (secure email change, minimum length 8, raised rate limits, bot protection) | Not started | Owner, engineer drives |

### Operations

| Item | Status | Who |
|---|---|---|
| Backups: Pro daily backups on staging; PITR declined for now | Decision needed before production | Owner |
| Restore drill: local rehearsals on 6 Sep and 24 Oct; hosted restore and rollback pending | Partly | Engineer, owner accepts |
| Sentry project; alert webhook; status page; on-call | Not started | Owner |
| Admin MFA enrolment for the first admin on staging and production | Not started (code done) | Engineer and owner |
| Production data: vehicle catalogue import, `job_config` rows, no member seeding | Not started | Engineer |
| Anthropic console spend limit above the code caps | Not started | Owner |

### Only provable on staging or live

3-D Secure and wallet checkouts in a browser; a Connect payout and a provider dispute end to end; the day-14 payout-setup refund; CSP against Stripe's current frames; the Supabase sign-in limit under launch load; real SMTP templates (including the guest-link-with-confirm-email gap); HEIC decoding on the deployment runtime; a run against a real Anthropic model; admin-page exploitability (B4); hosted restore RPO and RTO; monitor failure to alert to recovery; and the 15-gate release-candidate packet.

---

## 8. Suggested order of work

**This weekend, engineer (stabilise what merged)**

1. Pause merges to `main` until one run finishes green with #136 in it (about 35 minutes with no new pushes); then rerun #132 and #133 on current main and merge #132, #133, #107 and #94 when green (#134, #119 and #135 merged while this was being written).
2. Fix the flaky copyright test (#90), the non-deterministic approval guard (#100) and the privacy-page sentence (#93) in one small PR.
3. Apply the 30 missing migrations to staging with the runner, set staging's `job_config` rows, backfill shared dev's migration history (#91, #92).
4. Commit the Codex queue into the repository and work it down (#95).
5. Add a SQL guard for the job inventory's families (#96); fix the release-candidate script's beta gate once Neil rules (#94).
6. Build OS-W34 (B7, N418, N439, N442) once the retention ruling exists; until then at least the scrub of email, address and messages for traders, which needs no ruling.

**This week, Neil (the critical path)**

7. Hosting account and domain (holds five OS items). Then an engineer can do staging steps 3–13 in a day.
8. Email provider decision (`docs/owner/email-provider.md`).
9. Legal entity, jurisdiction and counsel engagement; tax decision; whether 18+ and the takedown route stay.
10. Stripe account with Connect, test mode on the real domain, Radar rule, wallet domains.
11. Sentry project and alert webhook; monitor repository variables; Supabase Auth settings.
12. Rulings: agent in the first beta, PITR, release configuration, the 14-day payout-setup rule 5 (#123), credit payouts, "Download my data", soak length.

**Then, together**

13. Staging soak: one real test-mode purchase, refund, dispute, chargeback, payout and deletion, with 3-D Secure and a wallet, on real devices.
14. Hosted restore drill including storage and Stripe reconciliation (N232).
15. Production project, the 15-gate packet, counsel sign-off, one real transaction before opening the doors.

---

## 9. Method and sources

- Code and migrations read on a clean checkout of `main` at `43aef2a`; PR and run data from GitHub at 22:00–23:25 Eastern; `main` moved to `c4d318f` (PR #136) and then on through #135, #119 and #134 while this was being written.
- Read-only probes of the shared dev project (`supabase_migrations.schema_migrations`, `pg_proc`, `information_schema`) and of staging through the `os_reader` role.
- Local check suite as recorded in section 3.
- Two independent read-only verification passes over the 3 November blockers and the owner checklist, each re-tracing the code; their file and line citations are the ones given above.
- Written summaries from the sessions that worked on DRVN today: "Blockers and CI/GitHub Actions" (merges, migrations, Codex queue, P1 follow-ups), "Work status dashboard" (board state, cloud sessions A to G), "Supabase upgrade and staging setup" (staging facts), "DRVN Intelligence OS Milestone 1" and "Intelligence OS issue tracking alignment" (OS counts and ingestion rules), "DRVN Intelligence OS reconstruction", "Computer performance slowdown" (the worktree governor), "Fable agent comment review" (CI proof on main) and "DRVN CI red status investigation" (the two distinct causes of today's red main).
- The Intelligence OS Blockers API at 21:53 Eastern for the 99 open items.
- Nothing in the project was modified other than adding this file.

# DRVN production-readiness review: 8 November 2026

A whole-codebase readiness review of `main` at `cf7109e` (merge of PR #182, 9 Nov 00:05 UTC), written on the late evening of Sunday 8 November 2026 (US Eastern). It is report four. It covers everything merged since report three (`docs/production-readiness-2026-11-07.md`, written at `c4d318f`), re-checks the nine launch blockers from `docs/production-readiness-2026-11-03.md`, states which of report three's findings are fixed and by which pull request, reconciles the Intelligence OS's open list against the code, and sets out what still stands between this repository and a real product with real members and real money.

**How to read this**

- **Severity:** Blocker (fix before any real member or payment) · High (before public launch) · Medium (soon after, or before scale) · Low (polish).
- **Confidence:** Checked (re-traced in code or reproduced today) · Reported (a session or document says so and it was not re-traced) · Needs a live test.
- Finding ids: `B1`–`B9` are the 3 November blockers. `N###` and `R-…` are the Intelligence OS's ids. `#88`–`#100` are report three's findings. New findings in this review are `#101` onward.
- "Fixed by #N" means the named pull request is merged on `main` and the behaviour was re-traced in the code today, unless the line says otherwise. Writing it here asks the Intelligence OS to run that item's code check again; the code decides.
- Sources: the code and migrations on `main`; GitHub pull request, run and artifact data; read-only probes of the shared dev and staging databases; the Intelligence OS Blockers API; the remediation record (`docs/plans/2026-11-remediation-record.md`) kept by the session that executed the remediation plan. Nothing in the project was modified other than adding this file.

---

## 1. The short version

**Verdict: not yet a real product. No-go for real members or real money this week, for the same reason as on 7 November: the code is now at release-candidate quality and nothing hosted exists.** Every engineer item in the remediation plan (`docs/plans/2026-11-remediation-plan.md`) is merged or recorded. The last 3 November blocker in code (B7, account deletion) is fixed. `main` is green on every CI job, branch protection requires an up-to-date branch, staging is level with `main`, and a deploy pipeline exists. It has never deployed, because there is no hosting account, domain, production database, email provider, Stripe account, Sentry project or alert webhook. The owner path is the whole of the critical path.

| Area | 3 Nov | 7 Nov | Today | Why |
|---|---|---|---|---|
| Code correctness and safety | 55 | 85 | 90 | B7 fixed in code; private member photos; deterministic approval guard; every P1 follow-up from 7 November merged |
| Tests and CI | 60 | 75 | 85 | `main` green on all eight jobs; 2,836 unit tests, 154 SQL guards, 328 browser tests on three browsers; flaky test and flaky guard fixed; protection requires up-to-date branches. 31 merged PRs still owe a Codex review |
| Environments and operations | 20 | 35 | 45 | Staging level with `main`; deploy workflow and infrastructure evidence file exist; still no hosting, domain, production project, PITR, Sentry, alerts, or hosted restore drill |
| Money on hosted systems | 40 | 50 | 50 | Unchanged: nothing has run against Stripe on a hosted deployment |
| Legal and privacy | 30 | 40 | 50 | Deletion scrub landed and the privacy page is now true; earlier members asked to confirm 18+; terms still a draft; no tax; no counsel |
| Agent | 55 | 70 | 72 | Approval guard proves the fix on 5,000 ids; id redaction corrected; no real-model run on record |
| **Overall** | **69** | **78** | **82** | Still no-go: the owner path has not started |

**What happened since report three, in numbers**

| Measure | Value |
|---|---|
| PRs merged since `c4d318f` (8 Nov 03:12 UTC to 9 Nov 00:05 UTC) | 53 (#132 through #182) |
| PRs opened on 8 November (UTC) | 67 |
| Commits on `main` since `c4d318f` | 183 (55 merges) |
| Files changed since `c4d318f` | 282 (+26,275 / −927 lines) |
| Files changed since the 3 November baseline (`ce19681`) | 899 (+86,869 / −5,836 lines) |
| Migrations on `main` | 284 (22 added since `c4d318f`) |
| Shared dev | schema complete to `20261108180000`; history records 277 files, the 12 gaps are explained in `supabase/MIGRATIONS.md` (#101) |
| Staging | 284 rows, newest `20261108180000`: level with `main` |
| Intelligence OS blockers | 76 open (24 for Neil to do, 25 to decide, 19 for counsel, 8 for an engineer), 171 resolved (7 Nov: 99 open, 125 resolved) |
| Open pull requests | 1 (#53, design docs reconcile) |

**The ten things that matter most**

1. **Nothing hosted exists.** `.github/workflows/deploy.yml` (#175) deploys to staging on every green push to `main` and to production on a reviewed `rc-` tag, but both jobs skip until the GitHub environments, hosting projects, secrets and the `DRVN_DEPLOY_STAGING` variable exist. The independent worker monitor (`worker-monitor.yml`) has likewise only ever run as a skipped job. Hosting account and domain first; everything in section 7 queues behind them.
2. **B7 is fixed in code.** Account deletion scrubs a former trader's email, addresses and words on a six-year financial clock (#149, `20261107220510`), checks financial holds before banning sign-in (#157, #164, #166), sends a late hold to an operator instead of reinstating the member, strips the deleted member's words from other members' notifications and locks the retired handle (#181, `20261108180000`). The Stripe customer is deleted at `src/lib/account-deletion-worker.ts:221`. The six-year clock is the plan's default; Neil has not ruled on retention. A live deletion on staging (plan item C1) is still owed.
3. **B3 is still open:** there is no sales tax anywhere in the code and `src/app/(legal)/terms/page.tsx:35` is still headed as a working draft. Both are the owner's and counsel's.
4. **B6 is half done:** `drvn-staging` is level with `main`, but there is no production project, no hosting account, no domain, PITR was deferred, and the hosted restore drill has not run.
5. **Every one of report three's engineer findings is closed or recorded** (section 5). The two that remain are a ruling (#101, the twelve shared-dev history rows) and a debt (#102, 31 Codex reviews owed).
6. **Twelve shared-dev migration rows need Neil's ruling (#101).** The runner's `--status` shows 277 applied, 12 files it cannot see in the history and 5 history rows with no file. Every object those files create is present on shared dev; the rows are missing because the files were applied before the runner recorded history. The plan offers two ways to close it (an attested-row runner mode, or documenting the gaps and closing by hand). Until ruled, no one may run the whole tree against shared dev.
7. **Six pull requests merged on 8 November while `main` had no protection** (18:45 to 18:54 UTC: #167, #98, #100, #101, #103, #169, all docs or tests). The next full `main` run (42512274085 on `d2c09f8`) finished green on every job, so they are proven. Since then every merge has been by hand after every check is green on a branch level with `main`, and the ruleset enforces the up-to-date requirement.
8. **The money paths have never run against Stripe on a hosted system.** 3-D Secure, wallets, a Connect payout, a provider dispute and the day-14 payout-setup refund are unproven outside unit tests and the stub. Unchanged since 3 November.
9. **Owner decisions are the critical path.** Of the OS's 76 open items, 68 are for Neil or counsel. The remediation plan's decisions table has 29 rows; the executor applied the plan's recommended defaults where it was allowed to and recorded each one (`docs/plans/2026-11-remediation-record.md`, "Defaults applied"), so Neil's review of that table is confirm-or-reverse, not blank.
10. **Housekeeping is now visible and small:** 31 Codex reviews owed (#102), 115 merged branches still on the remote and 82 untracked design files in the shared checkout (#103), #53 still conflicting (R53-pr), and `package.json` still declares `next ^16.3.8` while the lockfile pins 16.4.3.

---

## 2. What landed since report three

Grouped by area. Every code PR carried its Intelligence OS ids in its title; migrations are named where the change lives in the database. The remediation plan item is given where one applies.

### Deletion, privacy and legal (8 PRs)

- #149 OS-W34: deletion scrubs personal data on a six-year key clock; usernames lowercase 3–30 with reserved names and tombstones (`20261107220500`, `220510`, `220520`). Closes B7, N418, N439, N442 in code.
- #157, #164, #166 OS-W11: deletion checks financial holds before banning sign-in; an open bank chargeback holds deletion; the guard proves the seller is held by the chargeback alone (`20261108130400`, `20261108140000`).
- #181 OS-W34 N418: a late hold after the scrub goes to an operator, other members' notification previews lose the deleted member's words, a per-handle lock closes the tombstone race, retained cases from before the scrub were requeued once (`20261108180000`).
- #148 N531 N627 N232: audited admin exports (`20261108120000`), old message photo metadata stripped (`20261108120010`), recovery plan covers storage files and Stripe state (`20261108120020`).
- #174 OS-W38 N686 (plan C5): members from before the 18+ confirmation confirm it once at their next sign-in (`20261108150000`); `docs/decisions/age-confirmation-and-takedown.md` records that 18+ and the takedown route stay.
- #178 OS-W38 N455 (plan C4): member photos are private storage objects shown through signed URLs minted once at the database boundary; avatars stay public; the account export links photos for seven days (`20261108160000`).

### Money, checkout and disputes (6 PRs)

- #134 N244: payout deadline fences, fair retries, complete refunds and safe restoration (`20261108110000`). Fixes #123's P1s (report three #89).
- #132 OS-W33: withdrawal can't undo moderation, buyers keep offer history, archived listings settle offers (`20261108110100`). Fixes #122's P1s.
- #141 OS-W17 and #152: guest DRVN checkout resumes, Finish checkout works across devices, resume never adds unrelated cart items, guest hold admissions bind atomically (`20261108110300`, `20261108130000`).
- #156: the 8-photo dispute evidence limit holds under concurrent attaches (`20261108130300`).
- #176 N499 (plan C2): crash recovery finds an orphaned transfer past the newest 1,000 and never re-issues the create.

### Agent (3 PRs)

- #158 and #159: card-number redaction never corrupts ids; emails containing ids are still redacted for the model (`20261108130500`). This was the real cause of the non-deterministic approval guard (report three #100).
- #168 and #180 OS-W36 N677 N680 (plan A1, A4): the approval guard fails deterministically and sweeps 5,000 random ids; FAIL 7 is null-safe; the job inventory's families are held to the runbook by a SQL guard.

### Social, garage and moderation (3 PRs)

- #133 OS-W23: every build-sheet write takes the sheet lock, unlink is atomic, media caps hold on moves (`20261108110200`). Fixes #105's P1s.
- #154 OS-W21: a hold always hides the build, the evidence cap is atomic, listing saves dedupe, a takedown closes every reply report (`20261108130100`).
- #153 OS-W11: deletion status is reachable; the admin queue pages past 50.

### CI, migrations, release and operations (17 PRs)

- #136 and #135 OS-W31: the payout-setup guard drops its stale beta-gate update, ending the red `main` of 8 November (report three #88).
- #138, #140, #142, #143, #145, #146 OS-signals: `Resolves:` enforcement and `docs/ids.md`, JUnit from every test lane, finding ids in the tests a PR touches, migration status as JSON with a `MIGRATIONS.md` ratchet, `/api/version` and a per-commit release-gate record, migration rows that record who, which commit and which PR.
- #147 and #151 OS-R-migrations: a verified record-only mode for the migration runner that refuses dynamic SQL it can't parse and unnamed indexes.
- #150 R69-dmca: the blocked-media cache ages from the caller's clock (report three #90).
- #155: the reduced-motion scroll guard catches comma media queries.
- #162 OS-signals and #167 (plan item "staging catch-up"): staging caught up to `main`; shared dev's 12 history gaps explained in `supabase/MIGRATIONS.md`.
- #169 (plan A6, report three #97) and #170 (plan A5, #98): migrations are added in date order and never renamed; the crosswalk cites only files that exist; advisory floors sit at the installed fixes.
- #172 OS-W37 R-rcconfig R-staging-behind (plan B2, B3): guest hold caps is the 15th release gate, replacing the removed beta's "invitation boundaries"; staging must stay within two days of shared dev, with `supabase/migrations-staging-pending.json` for a session that cannot reach staging.
- #173 OS-W38 N540 (plan C7): the sandbox payment override refuses to boot on any hosted deployment (Vercel, a public https site URL or a live key), whatever the payment mode.
- #175 OS-W39 N634 N528 N224 (plan C3, C8, D2): `deploy.yml` gated on `release-gate` and on migration status, refusing rather than applying a missing migration; `docs/release-evidence/infrastructure.md` with a dated row for every account and setting production needs.

### Proof sweeps, docs and the record (16 PRs)

- #98, #100, #101, #103 (plan A7): tests naming OS ids for items fixed by earlier PRs. #67 closed as superseded.
- #124, #130, #144 OS-R-untested: three more of the 13 P0 behaviour tests.
- #137: report three. #139, #161, #165: migration rows marked applied.
- #163: the remediation plan. #167, #171 (plan A3: the Codex review queue moves into the repository as `docs/review-evidence/codex-queue.md`), #179, #182: the remediation record, brought final at 00:05 UTC.
- Design-concept files (plan A8, report three #99): 251 files, 226 MB, committed to branch `design/concepts-2026-10` at `ea105f7`, not merged.

### Migrations applied since report three

All with the runner and a `--pr` tag; every row has both cells in `supabase/MIGRATIONS.md`.

| File | PR | Shared dev | Staging |
|---|---|---|---|
| `20261107200100` through `20261108100000` (the 30 report three found missing) | #162 | already applied | 2026-11-08 |
| `20261107220500`, `220510`, `220520` | #149 | 2026-11-08 | 2026-11-08 |
| `20261108140000` | #166 | 2026-11-08 | 2026-11-08 |
| `20261108150000` | #174 | 2026-11-08 | 2026-11-08 |
| `20261108160000` | #178 | 2026-11-08, after the merge | 2026-11-08 |
| `20261108180000` | #181 | 2026-11-08 | 2026-11-08 |

---

## 3. Health checks

Taken from CI's run on `main` at `cf7109e` (run 42538297662, attempt 2; attempt 1 passed every test and failed only the JUnit upload with a network reset) and from the shared checkout's installed tree.

| Check | Result |
|---|---|
| CI on `main` | **Green on all eight jobs**: verify, secrets, secrets-full, sql-guard, e2e, stripe-integration, summary, release-gate. Every `main` run since #137 finished green except for the stray-branch secrets failures described below, which were rerun |
| Unit tests (`vitest`, verify job JUnit) | **2,836 passed, 0 failed, 13 skipped, 336 files** (7 Nov local: 2,494 passed, 2 failed) |
| SQL guards (sql-guard job JUnit) | **154 guards passed**, on a fresh PostgreSQL 17 with all 284 migrations applied from scratch |
| Browser suite (Playwright, e2e job) | **328 passed, 0 flaky, 2 excluded** on chromium, firefox and webkit; `releaseStatus: passed` |
| Operations suite (`test:operations`) | 20 passed |
| Stripe integration | passed |
| Release gate record | `release-gate-cf7109e…json`: `result: success`, every requirement `ok` |
| Production dependency audit (`npm audit --omit=dev`) | **0 vulnerabilities**; `next` 16.4.3 installed |
| Generated database types (`db:types:check`) | Passed in CI's sql-guard job |
| Branch protection | Ruleset `protect-main` (id 26808907) requires `release-gate` and an up-to-date branch; recorded in `docs/owner/branch-protection.md` (#179) |

**Shared dev and staging, probed read-only today**

| Project | Migration history | Objects |
|---|---|---|
| Shared dev | 277 rows recorded; the runner's `--status` lists 12 files as missing and 5 rows as extra (#101); newest `20261108180000` | Every object from the 8 November migrations is present; `private.username_audit` holds no rows after `220500` |
| Staging (`drvn-staging`, through the read-only `os_reader` role) | 284 rows, newest `20261108180000`: level with `main` | `job_config` is not readable by the reader role; report three's requirement that `media_storage_origin`, `transfer_worker_url` and `transfer_worker_secret` be set on staging is recorded in `docs/release-evidence/infrastructure.md` with only `media_storage_origin` filled |

**Two process facts from 8 November, recorded so they are not repeated**

- From about 18:45 to 18:54 UTC `main` had no ruleset, so `gh pr merge --auto` merged #167, #98, #100, #101, #103 and #169 before their runs finished. All were docs or tests, green locally, and run 42512274085 on `d2c09f8` proved them green on every job. Protection was re-created with the up-to-date requirement at Neil's go-ahead.
- CI's `secrets-full` lane scans every reachable ref. The first commit of #177 (closed and replaced by #178) carried a JWT-shaped test fixture that gitleaks flags, and its branch stayed on the remote, turning `secrets-full` red on every pull request and on `main` at `1b8080c` until the branch was deleted. Rule adopted in the record: a closed PR whose history holds a false positive gets its branch deleted; test fixtures use plainly fake tokens. Scoping the lane to `main` plus the PR head was considered and rejected, because in a public repository every pushed branch is public.

---

## 4. The 3 November launch blockers, re-checked

Each one re-traced in the code on `main` today, not taken from PR titles.

| id | 3 Nov finding | Today | Evidence | What remains |
|---|---|---|---|---|
| B1 | The installed Next.js version has a critical published security advisory | **Fixed** | lockfile resolves next 16.4.3, undici 8.12.3, zod 4.6.7; audit clean; #170 floors the advisories at the installed fixes | `package.json:47` still says `^16.3.8`; the lockfile pins the fix |
| B2 | A buyer who has paid has no self-service way to get their money back if the seller never ships | **Fixed in code** | `20261107210300` (#108): frozen deadlines, "item never arrived" dispute for 30 days from the frozen delivery date, 3 business days for the seller, escalation to day 21, `begin_not_received_refund`; #134 fences the payout deadline | Needs a live test on hosted Stripe |
| B3 | No sales tax, and the Terms are marked in the code as an unreviewed draft | **Open** | no tax code in `src/`; `src/app/(legal)/terms/page.tsx:35` and `privacy/page.tsx:14` still "NOT LEGAL ADVICE … working draft" | Owner and counsel: entity, jurisdiction, tax, review |
| B4 | Admin console pages check access only in the layout, while reading data with the all-access key | **Fixed** | every read in `src/lib/admin/queries.ts` takes its client from `requireAdminRead()`; #148 adds an audit row per export (`20261108120000`) | the proxy does not also gate `/admin` (defence in depth only) |
| B5 | Dispute and purchase evidence can be deleted | **Fixed** | `20261107203000` (#73); #156 holds the 8-photo cap under concurrent attaches | `job_config.media_storage_origin` must exist on every hosted project |
| B6 | There's no production or staging project, no hosted backups, and restore has never been rehearsed | **Partly** | `drvn-staging` level with `main`; `deploy.yml` exists and skips until configured; `docs/release-evidence/infrastructure.md` has one filled row (the staging project) | production project, hosting, PITR ruling, hosted restore drill, every other row of the evidence file |
| B7 | Deleting your account keeps your email, address and messages forever if you've ever bought or sold | **Fixed in code** | `20261107220510` (#149): scrub of email, addresses, messages, questions and comments with a one-way email fingerprint and a six-year clock for records that must be kept; `account-deletion-worker.ts:221` deletes the Stripe customer; `20261108180000` (#181) sends a late hold to an operator and never reinstates; `src/app/(legal)/privacy/page.tsx:295-306` now describes exactly this | retention ruling (the six-year clock is the plan's default); a live deletion on staging (plan C1) |
| B8 | The AI agent's background worker is never scheduled | **Fixed in code** | `20261026100000` schedules `drvn-agent-worker` every 5 minutes; #168's guard holds the inventory's three families | hosted `job_config` rows and `AGENT_WORKER_DATABASE_URL` |
| B9 | Closing a dispute inside DRVN releases the seller's payout while a bank chargeback is still open | **Fixed** | `20261107130000` (#72); `20261108140000` (#164, #166) extends the hold to account deletion | live test-mode chargeback not run |

B7 was the last 3 November blocker with code left to write. The five themes from 3 November (rules in the database, safety nets, operations, legal and privacy, the real security bugs) stand as report three recorded them, with "safety nets" and "legal and privacy" each moved one step by B7's fix.

---

## 5. Report three's findings, re-checked

Each of report three's findings #88 to #100, and the six items it carried from 3 November, with what closed it. "Fixed by" lines are written so the Intelligence OS reopens the item's code check.

- **#88 `main` red on `sql-guard`** is fixed by #136 (with #135 closed as its duplicate). Every `main` run since #137 has finished green except the stray-branch secrets failures in section 3.
- **#89 Three merged PRs carry P1 defects fixed only in open follow-ups** is fixed by #134 (for #123), #132 (for #122) and #133 (for #105), all merged on 8 November before anything was applied to staging.
- **#90 Timing-flaky copyright test** is fixed by #150: `blockedMediaKeys` stamps its cache from the caller's clock.
- **#91 Shared dev migration history unrecorded for 228 files** is closed as far as an engineer can close it by #147 and #151 (a verified record-only runner mode), #162 (every file the mode could verify recorded) and #167 (the 12 it could not, explained per file in `supabase/MIGRATIONS.md`). What remains is #101, a ruling. OS id R-migrations.
- **#92 Staging 30 migrations behind main** is fixed by #162 and #167 (staging at 284 rows today) and kept fixed by #172's two-day rule. OS id R-staging-behind.
- **#93 The privacy page still promises saved cards are deleted** is fixed by #149 and #157: the worker now reaches the Stripe customer delete for traders, so the sentence at `privacy/page.tsx:301` is true. OS id N439.
- **#94 The release-candidate script still requires the invite-only beta** is fixed by #172: `scripts/release-candidate.mjs` requires `guestCheckout: "capped"`, `REQUIRED_GATES` no longer holds `invitation-boundaries`, and `betaRequired` is refused. OS id R-rcconfig.
- **#95 Twelve merged PRs and three follow-ups owe a Codex review** is half fixed by #171: the queue lives in the repository at `docs/review-evidence/codex-queue.md` and six reviews ran on 8 November (findings in `docs/review-evidence/2026-11-08-codex-post-merge-review.md`, filed as N690–N694 and fixed by #180 and #181). The debt itself grew: see #102.
- **#96 Twenty-two SQL functions were restated by more than one migration** is fixed by #168: `supabase/tests/job_inventory_health_guard.sql` now fails a restatement of the inventory that drops or moves a family (FAIL 4b). OS id N680.
- **#97 Three migrations were renamed after rebase** is fixed by #169: `tests/ci/migration-order.test.ts` fails a PR whose new migration is dated before an existing one or renames an existing file.
- **#98 The crosswalk cites a test that is not on main** is fixed by #170 and #103: the crosswalk test cites only files that exist, and the named proof tests are on `main`.
- **#99 Eighty-five uncommitted design-concept files sit in the main checkout** is half fixed: the files are committed to `design/concepts-2026-10` (`ea105f7`, pushed, not merged), so nothing can be lost. The shared checkout still holds them untracked; see #103. OS id R86.
- **#100 `agent_approval_outcomes_guard.sql` is non-deterministic** is fixed by #168 and #180. The cause was not ordering: card-number redaction mangled about 0.3% of random UUIDs (fixed by #158), and the guard now proves it on 5,000 ids. OS id N677.

Carried from 3 November in report three, now closed: N442 "Usernames are only validated in the form" is fixed by #149 (`20261107220500`, database-level rules, reserved names and tombstones). N499 "Transfer crash recovery only searches 1,000 transfers" is fixed by #176 (a scoped complete search; the plan's idempotency-key replay was deliberately not built, since Stripe keeps a key for about 24 hours and a later replay would pay the seller twice). N627 "Old message photos may keep metadata" is fixed by #148 (`20261108120010`). N232 "Recovery plan ignores storage files and Stripe state" is fixed by #148 (`20261108120020`, runbook §6). N455 "Private cars' and draft listings' photos are publicly readable" is fixed by #178 (`20261108160000`: `car-images`, `listing-images` and activity photos are private buckets; signed URLs are minted at the database boundary; the Supabase CDN may serve a copy cached before the flip for up to its TTL, at most an hour). N528 "Deploys don't wait for CI or check migrations" is fixed by #175 (`deploy.yml` waits for `release-gate` on the exact commit and refuses on a missing migration).

**New findings in this review**

**#101 Twelve shared-dev migration history rows are explained but unattested (Medium, Checked).** `node scripts/apply-migration.mjs --target shared-dev --status` reports 277 applied, 12 missing (`20260905011618` through the September files listed in `supabase/MIGRATIONS.md`) and 5 extra rows with no file. Every object is present; the rows are absent because the files were applied before the runner recorded history. The remediation plan (B1) offers two closures: an attested-row runner mode that writes a row only after verifying the file's objects exist, or documenting the twelve and closing R-migrations by hand. The executor wrote the per-file reasons and evidence and built nothing further. Until Neil rules, the whole tree must not be run against shared dev. OS id R-migrations. Step: decide.

**#102 Thirty-one merged pull requests owe a Codex review (Medium, Checked).** `docs/review-evidence/codex-queue.md` has 118 rows: 48 `full`, 16 `fix-check`, 5 `full + fix-check`, 18 `skipped` (docs only) and 31 `owed`, among them #61, #62, #63, #65 and most of 8 November's code PRs. Neil's ruling is that Codex never blocks a merge, so this is debt, not a stop; the queue's own goal is no owed row older than seven days, and the oldest owed row is from 24 October. Work it down money, migration and auth PRs first, as the file says. Step: claude.

**#103 Repository housekeeping: 115 merged branches on the remote, 82 untracked files in the shared checkout (Low, Checked).** 121 remote branches exist; 115 are merged into `main` and could be deleted (the `cloud/os-*` and `fix/*` branches of merged PRs). The shared checkout on the Mac still carries the 82 untracked `design-mockups/` files (408 MB, now safe on `design/concepts-2026-10`), two other untracked paths (`docs/plans/2026-10-analytics-platform-review.md`, `intelligence-os-export/`) and four modified tracked files (`.claude/launch.json`, three `design-mockups/` files). Neil asked to be the one to clear the design files; the branch deletion is an engineer's. OS id R86. Step: you.

---

## 6. The Intelligence OS's 76 open items, reconciled against the code

The OS showed 76 open items at 02:55 UTC on 9 November: 8 an engineer can do, 25 for Neil to decide, 24 for Neil to do, 19 for counsel or another person. 171 are resolved; every engineer item the remediation plan named is among them (N677, N680, N686, N540, N455, N499, N634, N528, N224, N418, N690–N693, R-rcconfig, R-staging-behind, R-migrations). Three of the open items are done and wait only on their check or on Neil marking them.

**Done, waiting for the OS's check or for Neil to mark**

- R-guest "The beta gate refuses guest buyers" is fixed by #126, which removed the invite-only beta and dropped `public.beta_access_config`; #172 names guest hold caps as the 15th release gate in its place, and #141 and #152 prove guest checkout end to end.
- R-protect "Choose public repo or GitHub Pro, then protect main" is done: the repository is public, the `protect-main` ruleset requires `release-gate` on an up-to-date branch, and #179 records it in `docs/owner/branch-protection.md`.
- R-password "Rotate the two exposed test passwords" was done by Neil on 7 November, as report three recorded; no pull request carries it, so it waits for Neil to mark it in the OS.

**For an engineer (8), and what each waits on**

- R-unproven "Money paths are unproven on hosted systems" and R75 "Nothing has run against a real model on record": both wait on a hosted environment with the live Stripe test keys and an Anthropic key (plan D1–D5, E1).
- N666 "First admin MFA enrolment not done", N667 "Production data not loaded", N675 "SMTP templates and the guest-link confirm-email gap untested": wait on the production project and the email provider (D3, D4, D-mail).
- N689 "Agent terms and privacy wording is not on the live pages": by design per `docs/legal-review-checklist.md`, the wording goes in with the release that turns the agent on, which waits on R-agent-decision.
- N694 "Older migration rows are not checked by the staging rule": recorded only, by design; all 120 older prose rows are in the frozen baseline and on staging. It should be closed as accepted, not fixed.
- R53-pr "Design docs PR has conflicts": #53 touches 82 files and has conflicted with `main` since October; the remediation record leaves it for a design session of its own, with the brand assets (favicon, icons, manifest, OG cards) as the part worth splitting out.

**For Neil to decide (25)**: R-entity "Name the legal entity", R-market "Settle launch market and currency", R-niche "Choose one car platform and one country", R-email "No email provider", R-agent-decision "Decide whether the agent is in the first beta", R-credits "Two credit-payout choices remain", R-download "Keep or remove Download my data", R-ux "Choose which audit changes matter", R-m5, R-n4, R-explore2m "Explore text search times out at 2M parts", R84 "Buyer acceptance ends the mandate before payment", N432 "No page can be cached at the edge", N501 "DRVN funds every chargeback up front", N599 "Beta-specific terms undecided", N607 "Stripe and chargeback fees absorbed", N608 "Written-off transfer reversals", N621 "Account deletion leaves copies at providers", N622 "No internal policy for staff reading messages", N641 "Shipping model between EndShipper and Forge is undecided", N663 "Point-in-time recovery decision needed before production", N682 "14-day payout-setup rule 5 needs a ruling", N683 "Soak length undecided", and the retention and #101 rulings. The remediation plan's decisions table (29 rows) covers these with a recommended default for each; the executor applied five defaults it was allowed to (the 15th gate, the design-concept branch, keeping 18+ and the takedown route, private photos through signed URLs, the release configuration's explicit fields) and recorded them.

**For Neil to do (24)**: R-hosting "No hosting account or domain" (holds five items), R-stripe "Stripe test mode is not set up on a real domain", R-sentry "No Sentry or alert webhook", R-monitor "The independent monitor has never run", R-devices "Wallet and email tests are not done", R-gates "The 15-gate release packet is unsigned", R-prod "Production and one real transaction", R-a11y "Manual screen-reader and device passes are not done", R86 "Repository clean-up" (#103), N441 "Supabase's sign-in limit could lock everyone out on launch day", N451 "Supabase minimum password is 6 while the app requires 8", N662 "Supabase Auth dashboard settings are not hardened", N533 "No uptime monitoring or paging", N596 "Contact mailboxes not confirmed", N619 "Remaining processors unnamed", N620 "No processor agreements signed", N625 "Zero data retention not arranged with the model provider", N628 "Test-mode paragraphs must go via the live key", N637 "No production Anthropic API key", N640 "No EasyPost account and no wallet float", N645 "Radar 3-D Secure rule and negative-balances script not set", N668 "Anthropic console spend limit not set", N687 "DMCA designated agent not registered and details are placeholders", and R-password (done, see above). Each has a dated row waiting in `docs/release-evidence/infrastructure.md`.

**For counsel (19)**: R-counsel "Terms and privacy are unreviewed drafts", R-retention "Retention schedule is unapproved", R-merchant "Tax and merchant role are undecided", N597 "No supervisory authority named", N600 "Business sellers are not identified", N603 "Held-funds wording unconfirmed", N604 "Clawback from seller bank accounts may be under-disclosed", N609 "Offer binding language unconfirmed", N610 "Connected Account Agreement not referenced", N611 "No liability cap", N612 "Dispute decision wording unconfirmed", N613 "Business sellers' consumer cancellation rights undefined", N614 "Standard contract clauses missing", N617 "Lawful bases unconfirmed", N618 "International transfer mechanism undecided", N623 "Analytics consent model unconfirmed", N624 "Agent binding-counter terms unconfirmed", N626 "Untracked auto-confirm notice unconfirmed", N688 "Content licence scope and counter-notice wording unreviewed". The packet for counsel is `docs/owner/counsel-packet.md`; it needs the entity (R-entity) first.

---

## 7. What stands between this codebase and a real product

Everything here is outside the bug list. Status is read from the documents and code named; nothing hosted was inspected beyond the two database probes. Changes since report three are marked.

### Environments and hosting

| Item | Status | Who |
|---|---|---|
| Supabase org on Pro; `drvn-staging` created, Postgres 17, us-east-1 | Done 7 Nov | Owner |
| Staging schema level with `main` | **Done 8 Nov** (284 rows); `job_config` rows other than `media_storage_origin` not confirmed | Engineer |
| Deploy pipeline | **Exists** (#175): staging on every green push to `main`, production on a reviewed `rc-` tag, both refusing on a missing migration. Never run: needs the GitHub `staging` and `production` environments, the hosting projects, the secrets and variables in the workflow header and `docs/staging-setup.md` §11.4, then `DRVN_DEPLOY_STAGING = true` | Owner creates, engineer configures |
| Hosting account and project (the code assumes Vercel-style `VERCEL_*` fallbacks) | Not started | Owner |
| Domain and mailboxes (pages print `hello@drvn.app` and `privacy@drvn.app`; ownership unconfirmed) | Not started | Owner |
| Production Supabase project (added to `supabase/migration-targets.json` by a reviewed PR first; plan B4 is prepared) | Not started | Owner and engineer |
| Staging steps 3–13: Auth URLs and SMTP, Stripe test webhooks, EasyPost, Sentry, alerts, monitor, first admin, 15-gate packet | Not started; most wait on hosting and a domain | Owner creates, engineer configures |
| Infrastructure evidence file (`docs/release-evidence/infrastructure.md`) | **Exists** (#175); one row filled | Owner fills as each account is made |
| Branch protection with `release-gate` on an up-to-date branch; repository public; gitleaks over every ref clean | **Done 8 Nov** | Done |

### Configuration production needs

Unchanged from report three section 7 (`src/lib/env.ts`, `docs/production-runbook.md` §4): Supabase keys; Stripe live keys and both webhook secrets with `PAYMENTS_MODE=stripe` and never the stub override (#173 now refuses it on any hosted deployment); site URL, `CRON_SECRET`, `GUEST_RECEIPT_SECRET`, `TRUST_PROXY_HEADERS` only behind a verified proxy; `job_config` rows for the worker URL, secret and `media_storage_origin`; `SENTRY_DSN` and `ADMIN_ALERT_WEBHOOK_URL`; the agent's key, model, flag and `AGENT_WORKER_DATABASE_URL`; EasyPost; SMTP in Supabase Auth; optional Typesense and PostHog. None of it exists yet.

### Money

| Item | Status | Who |
|---|---|---|
| Live-mode guards, API version pin, fail-closed stub refusal on hosted deployments | Done (#173 added the hosted refusal) | Done |
| Stripe account: Connect Express, platform profile, test then live keys | Not started | Owner |
| Platform and Connect webhook endpoints per environment (`scripts/owner/stripe-webhooks.mjs`) | Not started | Owner runs it |
| Seller payout setup, eBay-style, 14 days, with deadline fences (#123, #134) | Done in code; rule 5 needs a ruling (N682) | Engineer then owner |
| Transfer crash recovery (N499) | **Done 8 Nov** (#176) | Done |
| Radar 3-D Secure rule; negative-balances script | Not started | Owner |
| Apple Pay and Google Pay domain registration, real-device check | Not started | Owner |
| 21 pg_cron jobs calling `/api/jobs/*` once `job_config` has URL and secret | Done in schema; the inventory is now guarded (#168); nothing hosted | Engineer |
| Independent worker monitor (`worker-monitor.yml`, every 15 minutes) | Has never run: skipped until the repository variables are set | Owner |
| Uptime monitoring and paging | None | Owner |
| Sales tax or VAT; Stripe Tax | Not collected anywhere; decision needed | Owner and counsel |
| Who absorbs Stripe and chargeback fees and written-off reversals | Decision needed | Owner and counsel |
| One live purchase, refund, dispute, chargeback and payout with a real card | Not started | Owner and engineer |

### Legal and privacy

| Item | Status | Who |
|---|---|---|
| Terms and privacy: accurate to the code, still headed as working drafts; no entity, governing law, liability cap, indemnity | Partly | Counsel and engineer |
| Counsel engagement (`docs/owner/counsel-packet.md` Q1–Q16) | Not started; the longest item | Owner |
| 18+ declaration at sign-up, onboarding and guest checkout; earlier members asked once (#174) | **Done in code 8 Nov**; Neil's default ruling recorded as "keep" | Done |
| Copyright takedown route and admin queue | Done in code; `src/lib/legal/copyright-agent.ts` holds `confirmed: false` placeholders until an agent is registered | Owner (needs the entity) |
| Retention periods | Decision needed; the deletion scrub runs on the plan's six-year default | Owner and counsel |
| Deletion of former traders (B7) | **Done in code 8 Nov** (#149, #157, #164, #166, #181); live proof on staging owed (plan C1) | Engineer after D3 |
| Private member photos (N455) | **Done 8 Nov** (#178) | Done |
| Cookie and analytics consent (opt-in in Settings, no banner) | Done as built; whether it satisfies the jurisdiction is counsel's | Counsel |
| Processor list and DPAs | Not started; depends on providers | Owner |
| Agent clauses and the model provider's commercial terms with zero data retention | Not started; blocks opening the agent | Owner then counsel |
| Supabase Auth hardening in the hosted dashboard (secure email change, minimum length 8, raised rate limits, bot protection) | Not started; rows ready in the evidence file (plan C6) | Owner, engineer drives |

### Operations

| Item | Status | Who |
|---|---|---|
| Backups: Pro daily backups on staging; PITR declined for now | Decision needed before production (N663) | Owner |
| Restore drill: local rehearsals on 6 Sep and 24 Oct; the plan now covers storage and Stripe (#148); hosted restore not run | Partly | Engineer, owner accepts |
| Sentry project; alert webhook; status page; on-call | Not started | Owner |
| Admin MFA enrolment for the first admin on staging and production | Not started (code done) | Engineer and owner |
| Production data: vehicle catalogue import, `job_config` rows, no member seeding | Not started | Engineer |
| Anthropic console spend limit above the code caps | Not started | Owner |
| Codex review debt | 31 owed (#102) | Engineer |

### Only provable on staging or live

Unchanged from report three: 3-D Secure and wallet checkouts in a browser; a Connect payout and a provider dispute end to end; the day-14 payout-setup refund; CSP against Stripe's current frames; the Supabase sign-in limit under launch load; real SMTP templates (including the guest-link-with-confirm-email gap); HEIC decoding on the deployment runtime; a run against a real Anthropic model; hosted restore RPO and RTO; monitor failure to alert to recovery; the 15-gate release-candidate packet; and now a live account deletion of a former trader.

---

## 8. Suggested order of work

**Neil, in this order (each step unblocks the next)**

1. Rule on #101 (the twelve shared-dev history rows): attested-row mode, or close by hand. Five minutes; it unblocks any whole-tree work on shared dev.
2. Clear the 82 untracked design files from the shared checkout (#103); they are safe on `design/concepts-2026-10`.
3. Hosting account, domain and the GitHub `staging` and `production` environments; then the secrets and variables at the top of `.github/workflows/deploy.yml`, and `DRVN_DEPLOY_STAGING = true`. The first staging deploy follows on the next green push.
4. Email provider (`docs/owner/email-provider.md`), then SMTP in Supabase Auth.
5. Supabase Auth settings (plan C6), Stripe account with Connect and test mode on the real domain, Sentry and the alert webhook, the monitor's repository variables. Fill each row of `docs/release-evidence/infrastructure.md` as it is done.
6. Legal entity, launch market and currency, counsel engagement with the packet, the tax decision.
7. The decisions table in `docs/plans/2026-11-remediation-plan.md` (29 rows): confirm or reverse each default; the five already applied are listed in the record.

**Engineer, now (none of it waits on Neil)**

8. Work the Codex queue down (#102), money, migration and auth PRs first.
9. Delete the 115 merged remote branches (#103); fix `package.json`'s `next` range to the installed major.
10. Split #53's brand assets into a small PR; leave the rest for a design session (R53-pr).

**Engineer, once step 3 is done**

11. Staging steps 3–13 in `docs/staging-setup.md`; staging `job_config` rows; first admin MFA (N666); SMTP templates and the guest-link gap (N675).
12. Staging soak: one real test-mode purchase, refund, dispute, chargeback, payout and a former trader's deletion (plan C1), with 3-D Secure and a wallet, on real devices.
13. Hosted restore drill including storage and Stripe reconciliation; then the production project (plan B4, D3, D4), the 15-gate packet (R-gates), counsel sign-off, one real transaction before opening the doors.

---

## 9. Method and sources

- Code and migrations read on `main` at `cf7109e`; pull request, run and artifact data from GitHub at 02:30–03:10 UTC on 9 November. The JUnit, browser-summary and release-gate artifacts of run 42538297662 were downloaded and counted.
- Read-only probes: shared dev through `node scripts/apply-migration.mjs --target shared-dev --status`; staging through the `os_reader` role (`supabase_migrations.schema_migrations` only; `job_config` is not readable by that role).
- `npm audit --omit=dev` on the shared checkout's installed tree (lockfile identical to `cf7109e`).
- The remediation record `docs/plans/2026-11-remediation-record.md` for the executor's judgement calls, defaults applied and migration cells; each "fixed by" line above was re-traced in the code named, not taken from the record.
- The Intelligence OS Blockers API at 02:55 UTC for the 76 open and 171 resolved items.
- `docs/review-evidence/codex-queue.md` for the review debt.
- Nothing in the project was modified other than adding this file.

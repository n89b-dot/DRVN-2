# Remediation plan 1 of 2: finish and fix what the 10 November review found

Written 10 November 2026 from `main` at `3a2ddc5` (merge of PR #200). It takes every finding in `docs/work-review-2026-11-10.md` (findings `#124` to `#163`) and the Intelligence OS findings in the review's reading copy, and says for each what to do, in what order, and what finished looks like. Its companion is `docs/plans/2026-11-architecture-remediation-plan.md` (plan 2). **This plan runs first.** The section "How the two plans fit together" says why, and where plan 2 starts.

This file lives under `docs/plans/`, so the OS does not read it as a report. The OS closes items through merged pull requests that name the item id (`docs/ids.md`); each item below names the OS id it works under where one exists. Where none exists, the OS session assigns one before the pull request is written.

---

## In plain words

On 9 November twelve changes merged and fourteen more were written the same evening. The fourteen were written faster than they could be reviewed. Review found faults in seven, three database changes were applied to the shared databases before their code was approved, and for four hours on 10 November `main` failed a test while GitHub showed a tick.

This plan does four things, in this order:

1. **Change how the work is run**, starting now, so the same thing cannot happen again. These are seven short rules. They cost nothing.
2. **Finish the thirteen changes that are still in review**, one at a time, fixing the fault review found in each before it merges. Two of them are set aside until after launch because nothing can use them before then.
3. **Fix what the review found in code that has already merged.** These are grouped into three small changes that do not touch the database, so they can be built alongside step 2.
4. **Fix the Intelligence OS's three rules that can close or reopen an item wrongly.** This is in the OS's own repository and is done by the OS session.

Neil has six decisions to make (about half an hour in all, each with a recommended default) and two changes to merge in the browser. Nothing here waits on the hosting account, and nothing here delays it.

**The end result** is a `main` with no change waiting in review, both shared databases level with `main` with no stray history, private photos that are actually private, and an OS that does not mis-close items. That is the "quiet point" at which plan 2 begins.

Working time: about seven to nine days of session work with review, most of it waiting for checks.

---

## How the two plans fit together

| | Plan 1: finish and fix (this file) | Plan 2: simplify the architecture |
|---|---|---|
| Purpose | Repair and complete work already in flight | Make the code simpler to read and safer to change |
| Urgency | Some findings are High: they must be fixed before anything is hosted | Preventive: nothing is broken today because of it |
| Touches the database | Yes: eight changes in review carry a migration | Yes: its first three items change how database code is stored and guarded |
| Runs | First | Second, from the quiet point |

**Why plan 1 goes first.** Plan 2's first item stores a copy of the database as it stands and checks it on every change. Doing that while eight database changes are in review would mean redoing the copy for each of them, and every one would collide with the next. Finishing the queue first costs nothing; doing it the other way round would cost each change a second pass.

**The quiet point.** Plan 2 starts when no pull request that changes the database is in review (workstream 2 of this plan is complete). The first thing done at that point is plan 2 item A1.

**Three things from plan 2 do not wait**, because they do not touch the database and they speed this plan up: skipping browser tests on documents-only pull requests (plan 2 item A0), the launch-configuration test lane (A4), and keeping DRVN Shipping switched off (A5).

**One builder at a time on the database.** At no point in either plan are more than three database pull requests in review.

---

## Workstream 1: working rules (in force from 10 November)

These apply to every session working in this repository, in both plans.

| Rule | Why (finding) |
|---|---|
| R1. At most three pull requests that carry a migration are in review at once. | `#128`: nine at once forced a rebase of all the rest on every merge. |
| R2. A migration is applied to shared dev or staging only after the reviewing session has approved its pull request. | `#125`: three were applied to both databases first. |
| R3. A migration file is dated when its pull request is next to merge, not when it is written. | `#126`: timestamps fixed the merge order in advance. |
| R4. Merge only when every check is green on the current head and the last run on `main` is green. | `#130`, and the standing rule. |
| R5. A pull request based on another pull request is a draft until its base merges and it is re-pointed at `main`. | `#127`: PR #207 and PR #209 showed as mergeable. |
| R6. A new test is shown failing once before it is trusted, and the pull request says how. No test uses a fixed calendar date. | `#124`, `#163`. |
| R7. No new feature work starts until workstream 2 is complete. | The review's main finding: writing outran review. |

**Done when:** the reviewing session and the building session have both acknowledged the rules, and they are added to `supabase/MIGRATIONS.md` (R2, R3) and the pull-request template (R5, R6).

---

## Workstream 2: clear the queue, one at a time

Thirteen pull requests were in review at 14:00 UTC on 10 November. They are taken in this order. Each merges only with the listed fix in it.

| Step | Pull request | Fix required before it merges | Finding | OS id |
|---|---|---|---|---|
| 2.1 | PR #198, deletion runbook and Resume | Keep the file name `20261110110000` and add one named exception to `tests/ci/migration-order.test.ts` (file, date, pull request, reason), with a test that any unlisted back-dated file is still refused (decision D6). The applied file is not edited; any further change goes in a new migration. Add the three states that still need SQL to the runbook. Replace the guard's `exception when others then null`. It merges after step 2.2. | `#126`, `#154`, `#157` | N944, N734 |
| 2.2 | PR #201, 18+ on long sessions | Sign the skip cookie. Enforce the confirmation on the actions that matter (message, offer, checkout, list), not only on page loads. Remove the prefetch exemption that never fires. | `#152` | N662 |
| 2.3 | PR #203, upload size | Add a second shrink method for browsers where the first fails, and a test of the server's 413. | `#158` | N955 |
| 2.4 | PR #188, staging out of search | One definition of "hosted". The deploy's version step also checks `/robots.txt` and `X-Robots-Tag`. The sitemap answers 404 when the site is not indexable. | `#156` | N958, N961 |
| 2.5 | PR #190, set-up order | Split the owner README's row 6 into before and after the first deploy; say exactly how to create the Vercel project without a deploy; restrict environments to `main` and `rc-*`. | `#156` | N952 |
| 2.6 | PR #195, protection watch | **Neil merges in the browser** (it edits a workflow). A follow-up adds: verify the merged pull request's `release-gate`, send failures to the alert channel, and assert the `production` environment has required reviewers. | `#156`, `#139` | N949, N950 |
| 2.7 | PR #210, photo signing rules | Keep the last known "ready" answer on a timeout. Count the rows the clean-up would remove on staging and get Neil's yes or no. Apply `20261110190000` before the code deploys. | `#131`, `#146` | N940 |
| 2.8 | PR #199, 1,000-row limits | Fix the four reads still on `main`. Add a ratchet test for unbounded reads used as counts. The two heavy loops (blocklist reload, audit-log walk) become database lookups. | `#155` | N718 |
| 2.9 | PR #206, a deleted member's words | Scrub or skip `saved_search_email_digests.items`. Give each notification kind a "carries member text" flag with a guard on unclassified kinds. | `#153` | new |
| 2.10 | PR #208, chargeback retry | Run the basket check on a replayed first event. Do the reopen and the replay in one transaction. Reopen the case when a later event holds it again. | `#148` | N944 |
| 2.11 | PR #204, order emails | Retry on 401, 403 and sender-side 422 and alert; make failed rows visible to an operator; let the time budget set the batch; add partial-refund, cancelled-order and dispatch-reminder messages; do not tell a buyer a refund is coming after a lost chargeback; prune sent rows. It merges inert, because no provider is chosen. | `#147` | new |
| 2.12 | PR #207, chargeback write-off | **Set aside until after launch (decision D1).** Convert to a draft. When it returns: base it on `main`, refuse an entry held from `lost`, count the 90 days as Neil rules, alert on a later bank event, and go through `settle_refund_operation`. | `#149` | N944 |
| 2.13 | PR #209, copyright counter-notice | **Set aside until after launch (decision D2).** Convert to a draft and add a runbook entry for reinstating by hand. When it returns: key the blocklist by object and notice, count business days from a checked date, and restore photos as well as the listing. | `#150` | new |

PR #211 duplicates the test fix that merged with PR #200 and is closed. PR #53 stays as the earlier plan left it.

**Done when:** no pull request that carries a migration is in review; `apply-migration.mjs --status` on shared dev and on staging reports no file missing and no extra beyond the documented ones; `main` is green.

---

## Workstream 3: fixes to code already on `main`

None of these adds a migration, so they are built alongside workstream 2, in three pull requests.

**3.1 Photos (after step 2.7 merges, because both edit the signer).**
- The listing page's share image becomes a generated `opengraph-image` route, as cars have (`#132`).
- The signer becomes an object that is given its clock and its client; tests build a fresh one (`#135`).
- The signing call gets a 2 to 3 second budget and the same back-off as the shared memo (`#136`).
- A ratchet test covers `createAdminClient()` call sites that select photo columns, and an unsigned member photo reaching a page is reported (`#137`).
- The runbook states how long an old link works after a photo goes private, a ban, and for export links.
- **Done when:** a listing link pasted into a chat keeps its picture after two hours on staging; the signer's tests pass in any order and at any date.

**3.2 The deploy path.**
- The status check uses a read-only database login (`#138`).
- The boot check tests the shape of each key and refuses a secret key in a public variable (`#140`).
- The rollback procedure states that a rollback runs the old tag's scripts and today's host settings (`#142`).
- One helper each for the commit sha and for "hosted"; `undici` and `zod` ranges raised to the floors the test names (`#144`).
- The proxy's admin gate covers image-suffixed paths and both early exits, and its matcher has a unit test (`#143`).
- **Done when:** the deploy workflow holds no owner password for a read; a wrong-kind key fails the boot test.

**3.3 Data set-up.**
- Run the vehicle catalogue import on staging (dry run, then apply) and fill the evidence row; the import prints matched against curated rows and lists the misses (`#141`).
- The agent-id audit matches a marker with a hex digit on either side, is run on staging, and the runbook's statement about staging is corrected (`#145`).
- **Done when:** staging's catalogue has makes, models and generations, with the counts recorded.

**3.4 Codex reviews** of the ten merges of 9 November, rationed as before, findings filed against the pull request that introduced them (`#129`, OS id N725).

---

## Workstream 4: the Intelligence OS

Done in the OS repository by the OS session, in this order. These are from the review's reading copy, section 5.

| Step | Fix | Why |
|---|---|---|
| 4.1 | The report reader detects sleep and does not count it as a run, backs off after a failure, clears a dead lock, and shows "reader failed" with the reason. | It has never run for real and can spend the day's budget reading nothing. |
| 4.2 | A recheck opened by "fixed by" excerpts the code around the stored line, not lines 1 to 40. | 72 queued checks can reopen items that are fixed. |
| 4.3 | A pull-request "moment" requires the state word next to the number. | "The open redirect survived #162" would settle when #162 merged. |
| 4.4 | Confirm on the Decisions screen is idempotent. | Pressing "Confirm all" twice un-confirms everything. Do this before Neil's sitting. |
| 4.5 | A recorded row needs a date and a name at the start of the cell, and is shown as "recorded", not "proven". | Any past date in the cell counts today. |
| 4.6 | A ruling made on Review is committed, and the rulings script never reverses one that is missing from the file. | A ruling made in the screen lasts only until the next script run. |
| 4.7 | "Last full read" is stamped only when every source read; each probe shows its age. A model's verdict alone never removes an item from the Blockers count. | Stale data can read as fresh. |
| 4.8 | Reports carry a small table the OS reads exactly (item id, state, pull request); prose is for the owner. | The current approach adds a rule a day to correct the previous day's misreadings. |

**Done when:** steps 4.1 to 4.4 are merged and each has run once on the live OS; the OS's open count is reconciled against `docs/work-review-2026-11-10.md`.

---

## The decisions, in one table

| # | Decision | Recommended default | If undecided |
|---|---|---|---|
| D1 | Set PR #207 (chargeback write-off) aside until after launch? | Yes. It cannot be used until 90 days after a first chargeback. | It stays a draft; nothing is lost. |
| D2 | Set PR #209 (copyright counter-notice) aside until after launch, with a runbook entry for doing it by hand? | Yes. | It stays a draft. |
| D3 | PR #210's one-time clean-up of photo rows that fail the new rule. | Yes, after the count on staging is shown to you and is small. | PR #210 cannot merge, and private photos rest on the weaker rule. |
| D4 | Chargeback write-offs: DRVN absorbs the loss, and the 90 days count from the bank's decision. | Yes to both. | Recorded for when PR #207 returns. |
| D5 | Should published photos have permanent public addresses, with signing kept for drafts and private builds? | Yes, built after launch as plan 2 item B7. Until then the current design stays and PR #210 still merges. | The current design stays. |
| D6 | PR #198's migration is dated before one already on `main`, and both shared databases already hold it. Keep its name with a named exception in the order test, or rename it and rewrite the history row on both databases? | Keep the name. Both databases applied it before `20261110120000`, which is the order a new database will apply by name, so nothing is out of step; renaming would mean writing to the migration history of two shared databases to cure a problem that exists only in merge order. The reviewing session proposed this and the reviewer of 10 November agrees. | The exception is used. It is temporary: plan 2 item A6 replaces the migration history with one baseline and the exception goes with it. |

Two owner steps are not decisions: merge PR #195 in the browser (or run `gh auth refresh -s workflow` once), and the hosting account (OS id R-hosting), which no item in this plan waits on.

---

## Sequence

| When | Builder session | Reviewer session | OS session | Neil |
|---|---|---|---|---|
| Day 1 | Rules acknowledged. Steps 2.1 to 2.3. | Approves before any database apply. | Steps 4.1 to 4.4. | D1 to D4; merge PR #195. |
| Days 2 to 3 | Steps 2.4 to 2.8. Workstream 3.2 and 3.3 alongside. | Reviews each; runs owed Codex reviews (3.4). | Steps 4.5 to 4.7. | D3's count, when shown. |
| Days 4 to 6 | Steps 2.9 to 2.11. Workstream 3.1. | As above. | Step 4.8. | D5. |
| Day 7 | Check the quiet point; hand over to plan 2. | Signs off the record. | | |

The owner path in `docs/plans/2026-11-remediation-plan.md` (hosting, entity, email, Stripe) runs in parallel throughout and is not changed by this plan.

---

## What "done" looks like

1. No pull request from 9 November is in review except the two set aside as drafts.
2. Shared dev and staging are level with `main`, with every history row explained.
3. `main` has been green for three consecutive days under rules R1 to R7.
4. Every finding `#124` to `#158` is fixed by a merged pull request, set aside by a recorded decision, or handed to plan 2 (`#159` to `#163`).
5. The OS's first four fixes have each run once on the live OS.

## Tracking

The building session keeps the running record under a new heading in `docs/plans/2026-11-remediation-record.md`: one row per step, with the pull request, the merge commit and where it stands. Each pull request's title carries the OS ids named in its row and a `Resolves:` line.

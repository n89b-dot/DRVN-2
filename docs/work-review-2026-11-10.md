# DRVN work review: the work of 9 November 2026

A review of everything done on Monday 9 November 2026 (US Eastern): the twelve pull requests merged into `main` between `aee656d` and `0076272`, the fourteen written that day and still in review, and the day's Intelligence OS commits. Written on 10 November 2026 from `main` at `0076272`. It is not a readiness report and gives no score. The reading copy for the owner is the Claude Doc "DRVN: 9 November work review".

**How to read this**

- **Severity:** High (before anything is hosted) · Medium (before real members) · Low (when convenient).
- **Confidence:** Checked (read in code, on GitHub or in a database by the reviewer on 10 November) · Reported (a session or an independent review said so and the main claim was spot-checked) · Unconfirmed.
- Ids: `N###` and `R-…` are the Intelligence OS's ids, written as "OS id X" so the OS matches the line to the item it already holds. `#104`–`#123` are report five's findings. New findings here are `#124` onward. Pull requests are written "PR #N".
- A finding about a pull request still in review describes that pull request as written on 10 November. It is settled by the code that merges, not by the merge itself.
- Nothing in the project was modified other than adding this file.

---

## 1. The short version

The small fixes of 9 November are sound and the first-deploy blocker is fixed, but more code was written than could be reviewed. Twelve pull requests merged (65 files, 2,298 lines added, one migration). Fourteen more, about 8,300 lines with nine migrations, were written the same evening; review sent seven of them back.

- The deploy's migration check can now reach staging from GitHub, proven with a real sign-in (PR #189, PR #202).
- `main` failed one unit test from 10:00 UTC on 10 November while GitHub's last run showed a pass; the test fix merged at 13:39 UTC (#124).
- Shared dev and staging each hold three migrations that are ahead of `main` (#125).
- Member photos are the weakest code: three changes in three days, and the privacy rule rests on PR #210 (#128).
- The chargeback write-off, the chargeback retry, the order emails and the copyright counter-notice each carry a fault that should be fixed before they merge (section 6).
- The remediation plan is 15 of 44 items done; every remaining item is the owner's, counsel's, or waits on a hosting account (section 3).

---

## 2. What merged on 9 November

| What is now true | Pull request | OS id |
|---|---|---|
| Report five is in the repository | PR #186 | |
| Browser-test accounts take a random password each | PR #185 | OS id R-password |
| The deploy's migration check reaches staging through the session pooler; every write mode refuses that route | PR #189, PR #202 | OS id N951 |
| `/api/version` and monitoring treat an empty commit sha as unset | PR #187 | OS id N957 |
| A hosted boot refuses to start without its database keys; a hosted rollback procedure is written; the uptime service is named the primary worker monitor | PR #192 | OS id N959, OS id N962, OS id N963 |
| A signed-out request for the admin console gets the ordinary not-found page | PR #194 | OS id N715 |
| `package.json` declares the patched Next.js range | PR #193 | OS id N714 |
| A pinned, ordered step can fill the vehicle catalogue on a new database | PR #191 | OS id N667 |
| Every server shows the same signed link for a member photo, and a refused link shows a placeholder | PR #196 | OS id N954 |
| A read-only audit query for agent ids damaged before PR #158 exists | PR #197 | OS id N943 |
| Two decisions carry a recommended default; four owed Codex reviews were run | PR #205 | OS id N717 |

One migration was added: `20261110100000_photo_signatures_shared.sql`, applied to shared dev and staging.

---

## 3. The remediation plan: 15 of 44 items done

`docs/plans/2026-11-remediation-plan.md` has 44 items. Fifteen are finished, two are partly done, one is held for a ruling, and twenty-six have not started. The engineering was done on 8 November; none of the twenty-six can be done by an engineer alone.

| Workstream | Items | Done | Where it stands |
|---|---|---|---|
| A. Settle `main` | 8 | 6, and 2 partly | A7: PR #53 left for a design session. A8: the design files are on `design/concepts-2026-10` and still in the shared checkout (OS id R86) |
| B. Migration record and release script | 4 | 2 | B1 is held for the owner's ruling (OS id N786); B4 waits for the production database |
| C. Remaining code items | 8 | 6 | C1 (OS id N734) and C6 (OS id N451) need hosted staging |
| D. Environments and operations | 8 | 1 | Only the deploy pipeline is built and it has never run (OS id R-hosting) |
| E. Money on hosted systems | 7 | 0 | OS id R-stripe, OS id R-unproven |
| F. Legal, privacy, entity | 6 | 0 | OS id R-entity, OS id R-counsel |
| G. The agent | 2 | 0 | OS id R-agent-decision |
| H. Product decisions | 1 | 0 | |

GitHub has no `staging` or `production` environment and no deploy variable (checked 10 November). None of the plan's eight conditions for "done" is met.

Four plan items merged on 8 November and were found unfinished by report five: private member photos (PR #178, continued in PR #196 and PR #210), the 18+ confirmation (PR #174, continued in PR #201), the deploy pipeline (PR #175, continued in PR #189, PR #192, PR #188, PR #190 and PR #195), and account deletion (PR #149 and PR #181, continued in PR #198 and PR #206).

---

## 4. Findings on `main` and on how the day was run

**#124 `main` fails a unit test that GitHub shows as passing (High, Checked).** `src/lib/supabase/photo-signing.test.ts` fixes the clock at `Date.UTC(2026, 10, 10, 10, 0)` (line 205), while `src/lib/supabase/photo-signing.ts` keeps `sharedRetryAt` in a module-level variable that an earlier test sets from the real clock. Once the real time passed 10:00 UTC on 10 November the test fails: run at 13:22 UTC, 1 of 29 failed at line 215. GitHub's last run on `main` was at 03:53 UTC. Every pull request's `verify` job failed on it for those hours. The test fix merged with PR #200 at 13:39 UTC on 10 November; the cause, timing state no test can reset, stands as #135. The production code has no date assumption.

**#125 Shared dev and staging hold three migrations that are not on `main` (Medium, Checked).** `20261110110000` (PR #198), `20261110120000` (PR #200) and `20261110130000` (PR #201) are recorded on both databases (shared dev through `apply-migration.mjs --status`, staging through the read-only role, 13:25 UTC on 10 November). `supabase/MIGRATIONS.md` says a migration is applied by the session that merges it. Apply a migration only after its pull request is approved.

**#126 The merge order forces a rename of an applied migration (Medium, Checked).** `tests/ci/migration-order.test.ts` refuses a file dated at or before the newest on the base. PR #200 (`20261110120000`) merged at 13:39 UTC on 10 November, so PR #198's `20261110110000` file must now be re-dated. Shared dev and staging already record it under the old name, which leaves a history row for a file that will not exist on `main`, the fault report four recorded as #101. Re-date the file, then repair or document that row on both databases before PR #198 merges.

**#127 Two pull requests that show as mergeable are not based on `main` (Low, Checked).** PR #207's base is `feat/r5-dispute-retry` and PR #209's base is `fix/r5-takedown-findings`. Their passing checks are against those branches.

**#128 The merge process cannot keep up with the writing (Medium, Checked).** Nine migrations were given timestamps when written, so their merge order is fixed in advance; `main` requires each branch to be level with it; a CI run takes 17 to 46 minutes; and the Mac that runs the sessions slept from 03:53 to 13:19 UTC on 10 November with nothing merged. Keep at most three database pull requests in review, and date a migration when it is next to merge.

**#129 None of the ten code merges of 9 November has had its Codex review (Medium, Reported).** They are owed in `docs/review-evidence/codex-queue.md` on top of the earlier debt. OS id N725.

**#130 PR #192 merged while the previous run on `main` had failed on a runner fault (Low, Reported).** The standing rule is to merge only when every check is green on the current head.

---

## 5. Findings in merged code

**#131 The server unlocks a member photo by the name of the field it sits in (High, Reported and read in code).** On `main`, `src/lib/photo-urls.ts` signs any whole canonical photo address under a photo-named key, with the all-access key, and `ownedBy` returns true when the owner is unknown. Review of PR #196 closed three routes by which a member could have another member's private photo signed, and found the test meant to prove the rule has gaps. PR #210 replaces the rule with a list of columns the database guards and must merge before anything is hosted. OS id N940.

**#132 A listing's share image is a signed link that stops working within two hours (High for a marketplace, Checked).** `src/app/(discover)/listings/[id]/page.tsx:118` puts the signed photo link in `openGraph.images`. A listing pasted into a chat loses its picture when the preview is fetched again. Cars use a generated `opengraph-image` route; listings should too.

**#133 Every photo is private and signed, including photos on public listings (Medium, Checked; a design decision for the owner).** Most of the photo findings follow from this: links that change hourly, a shared-link table, share previews that expire (#132), and a server deciding whose photo it may unlock (#131). The remediation record names the alternative and defers it: published photos at permanent public addresses, with signing kept for drafts and private builds.

**#134 Each photo is re-processed every hour for every size (Medium, Checked in code; cost not measured).** `SIGNING_WINDOW_SECONDS = 3600` in `src/lib/photo-urls.ts` and `minimumCacheTTL: 3600` in `next.config.ts`. Measure against the host's image quota on staging before choosing the window.

**#135 The photo signer keeps timing state that tests cannot reset, and reads two clocks (Medium, Checked).** `signedPhotoUrls` takes `nowMs` and also calls `Date.now()` in six places; `sharedRetryAt`, `sharedReportedAt` and the memo are module-level. This is the cause of #124. Make the signer an object given its clock and client.

**#136 A slow photo store holds every page with photos for ten seconds (Medium, Checked).** `src/lib/supabase/photo-signing.ts:55` gives the signing call a 10-second timeout and no pause after a failure; the shared-memo call beside it has a 1.5-second budget and a 30-second back-off.

**#137 Nothing catches a new page that shows member photos unsigned (Medium, Reported).** No test covers `createAdminClient()` call sites that select photo columns, and the placeholder hides the mistake.

**#138 The deploy's status check signs in with the database owner's password (Medium, Checked).** `scripts/lib/supabase-db.mjs:131` connects as `postgres.<ref>` to read one history table on every push. Use a read-only login, as the OS already does on staging.

**#139 The `production` GitHub environment does not exist, and GitHub creates an unprotected one on first use (Medium, Checked).** `.github/workflows/deploy.yml:110` relies on that environment's required reviewer. Add a first step that asserts required reviewers, restrict both environments to `main` and `rc-*` tags, and move `VERCEL_TOKEN` into the environments.

**#140 The boot check confirms the database keys exist, not that they are the right kind (Medium, Checked).** `src/lib/env.ts:224` is a presence check; a secret key pasted into a `NEXT_PUBLIC_` variable would be shipped to browsers.

**#141 The vehicle catalogue import has never been applied (Medium, Checked).** The evidence row in `docs/release-evidence/infrastructure.md` is blank, and `scripts/import-vehiclesdb.mjs:151` warns only when the total is zero, so curated rows that match nothing are dropped silently. OS id N667.

**#142 The hosted rollback procedure omits two facts (Medium, Reported).** `docs/production-runbook.md` §7a: a rollback runs the old tag's scripts and target file, and rebuilds with the host's current settings, so a bad settings change is not undone.

**#143 The admin gate in the proxy has small holes the layout still covers (Low, Checked).** `src/proxy.ts:63` skips any path ending in an image extension, so `/admin/users/x.png` bypasses the proxy; the gate is absent on both early exits in `src/lib/supabase/proxy.ts`; the browser test passes with the gate removed. OS id N715.

**#144 Three rules are each written twice (Low, Checked).** The commit sha rule (`src/app/api/version/route.ts:38`, `src/lib/monitoring.ts:47`), the meaning of "hosted" (`src/lib/env.ts` and PR #188's `src/lib/deployment.ts`), and the dependency floors (`undici` and `zod` in `package.json` are below the floors `tests/ci/dependency-advisories.test.ts` names).

**#145 The audit for damaged agent ids misses about one in five (Low, Reported).** `supabase/audits/agent_mangled_ids.sql` needs a hex digit on both sides of the marker, and the runbook's statement that staging was created after the fix is wrong. Both databases hold test data only. OS id N943.

---

## 6. Findings on pull requests still in review

Each line describes the pull request as written on 10 November.

**#146 PR #210, photo signing rules (Medium, Reported).** A timed-out readiness check counts as "not ready" for 30 seconds and blanks every member photo on that instance; its code deployed before migration `20261110190000` blanks them all; the migration deletes gallery rows and clears covers that fail the rule, which needs the owner's sign-off after a count on staging. OS id N940.

**#147 PR #204, order emails (High, Reported).** `src/lib/email/resend.ts:47` treats every 4xx except 409 and 429 as a permanent rejection, so a rotated key or a lapsed domain drops every receipt and refund email with no alert. Failed rows are invisible to an operator; the job sends at most 60 an hour and drops anything a day old; there is no email for a partial refund, a cancelled order or the dispatch deadline; a lost chargeback emails the buyer that a refund is coming. Report five #116.

**#148 PR #208, chargeback retry (Medium, Reported).** `20261110170000_chargeback_retry.sql:133`: replaying the first event returns `committed` before any basket check, so Retry reports success with nothing validated. The reopen and the replay are separate transactions, so a crash between them leaves the entry with no working control. OS id N944.

**#149 PR #207, chargeback write-off (Medium, Reported and read in code).** `20261110180000_chargeback_write_off.sql`: the 90 days run from the recovery case's creation, not from the bank's decision; an entry held from `lost` can be written off, recording the loss twice; a later bank event on a written-off entry is ignored with no alert; the order is set to `refunded` directly, not through `settle_refund_operation`; and two functions from PR #208 are restated, so a fix there must be repeated here. Who bears the loss is the owner's ruling. OS id N944.

**#150 PR #209, copyright counter-notice (High, Reported).** `20261110200000_copyright_counter_notice.sql:123`: the blocklist is keyed by object alone, so reinstating one notice unblocks a photo a second notice still covers. The waiting period starts from an admin-typed date checked only as not in the future, and is 14 calendar days. Reinstating restores the listing but not its photos, and the clean-up queue still deletes the files. Report five #109.

**#151 PR #200, takedown findings (Medium, Reported).** Its header says the 1,000-row blocklist read is fixed, but that fix is in PR #199. The block is by storage path, so the same file can be uploaded again. Report five #109.

**#152 PR #201, 18+ on long sessions (Medium, Reported).** `src/lib/supabase/proxy.ts:58` exempts server actions, API calls and anything that is not a page load, so a member with a tab already loaded keeps messaging and offering; the skip cookie is unsigned. Report five #110, OS id N662.

**#153 PR #206, a deleted member's words (Medium, Reported).** `saved_search_email_digests.items` still holds the leaver's listing titles, and the scrub lists notification kinds by hand, so a new kind carrying member text is kept with no test failing. It is the third full copy of `scrub_deleted_account` in four days.

**#154 PR #198, deletion operator runbook (Medium, Reported).** The runbook says no state needs SQL; three still do: a chargeback held for review, a failed job whose Stripe customer names someone else, and a request with no job row. OS id N734, OS id N944.

**#155 PR #199, 1,000-row limits (Medium, Reported).** Most fixes fetch every page in app code; the copyright blocklist reloads in full every 15 seconds per instance; four reads on `main` still have the fault (`selling/page.tsx:61`, `recommendations.ts:60`, `listings/page.tsx:185`, `offers/page.tsx:200`); no ratchet test stops the next one. OS id N718.

**#156 PR #188, PR #190 and PR #195, first-deploy set-up (Medium, Reported).** PR #188: the noindex setting is fixed at build and nothing checks the served `/robots.txt` or `X-Robots-Tag`; the sitemap still lists staging pages (OS id N958). PR #190: `docs/owner/README.md` row 5 says deploy after row 6, which contains post-deploy steps (OS id N952). PR #195: the protection check reads the rules after the merge, and a failure only sends GitHub's own email (OS id N949).

**#157 Three new SQL guards pass on any error (Medium, Checked).** The guards added by PR #198, PR #200 and PR #209 use `exception when others then null`.

**#158 PR #203, upload size (Medium, Reported).** `src/lib/media-upload.ts:56`: where the browser cannot shrink a photo, every phone photo over 4 MB is refused with advice to resize by hand. OS id N955.

---

## 7. Findings about the codebase as a whole

**#159 There is no single place to read the current database (Medium, Checked).** 285 migrations and about 60,000 lines of SQL define 513 functions; 53 are defined three or more times (`request_account_export` 12 times, `worker_health_snapshot` 10, `purchase_begin` 8). A one-line change copies the whole function, the reviewer cannot see the changed line, and a copy from an older version drops a later fix. Check in a generated schema snapshot that CI rebuilds and compares.

**#160 The same list is written in several SQL functions (Medium, Checked).** What holds an account deletion is spelled out in `account_deletion_blockers` and again in `account_deletion_hold_order`, and the two differ by one condition. The settled dispute states are literal in several functions.

**#161 The dispute function is the hardest code in the project to read (Medium, Checked).** `apply_stripe_dispute_event` takes nine positional arguments, returns strings, and runs to lines over 200 characters. Reformat it and add one test listing every state and event pair with its result.

**#162 Several things have never run anywhere (Medium, Checked).** The public data cache is switched off in development and in the browser tests; the deploy workflow and the order emails have never executed. Their first run is staging. OS id R-unproven.

**#163 Some tests cannot fail (Medium, Checked).** Nineteen test files read source code as text and assert on its wording or order; the browser test for the admin gate passes with the gate removed (#143); two tests used fixed dates (#124).

---

## 8. Suggested order of work

**Engineer.**

1. Make the signer's timing state resettable so the clock fault cannot return (#135); PR #211 duplicates the test fix that merged with PR #200 and can be closed.
2. Re-date PR #198's migration and settle its history row on shared dev and staging (#126), then PR #201. Apply no further migration before approval (#125).
3. PR #203, PR #188 and PR #190 with section 6's gaps closed; run the catalogue import on staging (#141).
4. PR #210 before anything is hosted, and a generated share image for listings (#131, #132).
5. PR #208, then PR #207 based on `main`, then PR #204 (#147, #148, #149).
6. PR #209 reworked, PR #199 with a ratchet test, PR #206 (#150, #153, #155).
7. The Codex reviews owed (#129).

**Neil.**

8. Merge PR #195 in the browser, or run `gh auth refresh -s workflow` once (report five #111).
9. Yes or no on PR #210's one-time clean-up, after a count on staging (#146).
10. Rule on chargeback write-offs: who bears the loss, and from when the 90 days run (#149).
11. Decide whether published photos return to permanent public addresses (#133).
12. The hosting account and domain: twenty-six plan items wait behind it. OS id R-hosting.

---

## For the Intelligence OS

One row per finding in this review, read exactly by the Intelligence OS. Where a row and the prose differ, the row is right.

| OS id | Finding | State | Pull request | For | Note |
|---|---|---|---|---|---|
| new | #124 | fixed | #200 | engineer | `main` failed a photo-signing test that GitHub showed as passing |
| new | #125 | open | #198 | engineer | Shared dev and staging hold a migration that is not on `main` |
| new | #126 | open | #198 | engineer | An applied migration is dated before one that has already merged |
| new | #127 | fixed | #213 | engineer | Two stacked pull requests showed as mergeable though not based on `main` |
| new | #128 | fixed | #213 | engineer | The merge process could not keep up with the writing |
| N725 | #129 | open | #214 | engineer | Per-change Codex reviews are waived by ruling; one review of the whole work remains |
| new | #130 | fixed | #213 | engineer | A change merged while the previous run on `main` had failed |
| N940 | #131 | open | #210 | engineer | The server unlocks a member photo by the name of the field it sits in |
| new | #132 | open |  | engineer | A listing's share image stops working within two hours |
| new | #133 | after launch |  | decide | Every photo is private and signed, including photos on public listings (decision D5) |
| new | #134 | open |  | engineer | Each photo is re-processed every hour for every size |
| new | #135 | open |  | engineer | The photo signer keeps timing state that tests cannot reset |
| new | #136 | open |  | engineer | A slow photo store holds every page with photos for ten seconds |
| new | #137 | open |  | engineer | Nothing catches a new page that shows member photos unsigned |
| new | #138 | open | #219 | engineer | The deploy's status check signs in with the database owner's password |
| new | #139 | open | #195 | engineer | The production environment does not exist and would be created unprotected |
| new | #140 | open | #218 | engineer | The boot check does not test that each database key is the right kind |
| N667 | #141 | open | #220 | engineer | The vehicle catalogue import has never been applied and drops misses silently |
| new | #142 | open | #218 | engineer | The hosted rollback procedure omits two facts |
| new | #143 | open | #218 | engineer | The admin gate in the proxy has small holes the layout still covers |
| new | #144 | open | #218 | engineer | Three rules are each written twice |
| new | #145 | open | #220 | engineer | The audit for damaged agent ids misses about one in five |
| new | #146 | open | #210 | engineer | The photo rules change can blank every photo, and its migration deletes rows |
| new | #147 | open | #204 | engineer | Order emails are dropped for good if the provider's key lapses |
| new | #148 | open | #208 | engineer | Chargeback Retry reports success without checking anything |
| new | #149 | after launch | #207 | engineer | The chargeback write-off can record the same loss twice (decision D1) |
| new | #150 | after launch | #209 | engineer | A counter-notice can unblock a photo another notice still covers (decision D2) |
| new | #151 | open | #199 | engineer | After a takedown the blocklist read still stops at 1,000 rows and the same file can be uploaded again |
| new | #152 | open | #217 | engineer | The 18+ confirmation asks on a page load but holds no action |
| new | #153 | open | #206 | engineer | A deleted member's listing titles remain in saved-search emails |
| new | #154 | open | #198 | engineer | The deletion runbook says no state needs SQL, and three do |
| N718 | #155 | open | #199 | engineer | Counts that stop at 1,000 rows: four reads remain and nothing stops the next |
| new | #156 | open | #188, #190, #195 | engineer | First-deploy set-up gaps in three pull requests |
| new | #157 | open | #198 | engineer | Three new SQL guards pass on any error |
| new | #158 | open | #203 | engineer | Some browsers will refuse every phone photo over 4 MB |
| new | #159 | open |  | engineer | There is no single place to read the current database (plan 2 A1, then A6) |
| new | #160 | after launch |  | engineer | The same list is written in several SQL functions (plan 2 Part B, B5) |
| new | #161 | after launch |  | engineer | The dispute function is the hardest code in the project to read (plan 2 Part B, B5) |
| new | #162 | open |  | engineer | The configuration that will launch is not the one the browser tests run (plan 2 A4) |
| new | #163 | after launch |  | engineer | Some tests cannot fail (plan 2 Part B, B8) |

---

## 9. Method and sources

- Read by the reviewer: every merged pull request's description; `photo-signing.ts`, `photo-urls.ts`, migration `20261110100000`, `public-cache.ts`, `public.ts`, `deploy.yml`, the write-off migration on its branch, `tests/ci/migration-order.test.ts`, report five, the remediation plan and its record.
- Run by the reviewer, read-only: the photo-signing unit tests on `main`; migration status on shared dev and staging; GitHub pull request, check, run, environment and variable data.
- Six independent reviews of the diffs, one per subject, reading code only. Their main claims were spot-checked against the code; what could not be confirmed is marked.
- Four sessions answered in writing: the session that wrote report five and three Intelligence OS sessions. The session building the DRVN fixes had not replied. Their statements are marked Reported.
- The Intelligence OS's own code was reviewed too; those findings are in the reading copy, not here, because they are not DRVN items.
- No full test suite or build was run, and nothing was run on a host.

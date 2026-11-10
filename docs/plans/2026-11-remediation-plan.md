# DRVN remediation plan: from report three to a real product

Written 8 November 2026 from `main` at `0a25cc6` (merge of PR #149). It takes every problem in `docs/production-readiness-2026-11-07.md` (report three), the nine 3 November blockers, and the 85 items the Intelligence OS still lists as open, and for each says what is wrong, how to fix it, and what the finished state looks like. Items are grouped into eight workstreams and then sequenced. Each item has a line **in plain words** for a reader who does not work in the code.

This file lives under `docs/plans/`, so the OS does not read it as a report. The OS closes items through merged pull requests that name the item id, so every engineering item below carries its OS id and the PR that fixes it must put that id in its title or a `Resolves:` line (`docs/ids.md`).

---

## In plain words

DRVN's code is now close to good enough to take real customers and real money. In one day, 7 November, sixty-two changes landed that fixed almost everything the reviews found in the code: payouts, refunds, disputes, who can see what, account deletion, the admin console, sign-in security. Since then another twenty-five changes have landed, and the last of the code blockers, deleting a former trader's personal data, is fixed too.

What stands between the code and a product is now mostly things that only Neil, or a lawyer, can do. The site has nowhere to run: no hosting account, no domain, no email provider, no production database. Stripe has never been connected on a real address, so nobody has ever bought anything with a real card, even in test mode. The terms and privacy pages are honest drafts that a lawyer has not read. There is no legal entity named, no decision on sales tax, no decision on which country and currency to launch in.

The plan below does three things in parallel:

1. **The engineering team settles the code.** About a week: make two unreliable tests reliable, stop merges from landing on a stale base, finish the bookkeeping on migrations, review the unreviewed changes, and close the last small code items.
2. **Neil opens the accounts and makes the decisions.** The accounts take about a day of hands-on time spread over a week: hosting, domain, email, Stripe, Sentry, an alert channel, Anthropic. The decisions are listed in one table with a recommended default for each, so that each one is a yes or a no rather than research.
3. **Counsel reviews the legal pages.** This is the longest item and cannot be shortened by anyone here, so it starts first.

When those three are done, the team runs the full set of real-world tests on staging (a real purchase, refund, dispute, chargeback and payout; a restore from backup; a week of soak), produces the signed release packet, creates the production project, and does one real transaction with a real card before opening the doors.

**The end result** is a site at a real domain where a member can sign up with a verified email, list a part with photos, sell it to a buyer who pays by card or wallet, ship it with tracking, be paid two days after delivery into their bank account, and dispute or refund when something goes wrong, with every one of those steps proven on staging and recorded in an evidence file; where terms and privacy pages a lawyer has approved describe exactly what the code does; where backups are tested, errors are reported to a dashboard, and a failure pages someone; and where deleting your account actually deletes your data. The agent opens to members only once its own legal clauses and data-retention terms are in place.

If everything starts this week: code settled by 15 November, staging fully configured by 22 November, soak and release packet done by 29 November, production ready in the first week of December. Launch itself waits on counsel.

---

## How to read the workstreams

Each item has five parts: **Problem** (with its ids), **Fix** (steps, files, who), **Done when** (the end state, as something you can check), **Plain words**, and an estimate of hands-on time. Severity follows report three: Blocker (before any real member or payment), High (before public launch), Medium (soon after, or before scale), Low (polish).

Ids: `B1`–`B9` are the 3 November blockers; `#88`–`#100` are report three's new findings; `N…` and `R-…` are the OS's ids; `OS-W…` are the batches from `docs/plans/2026-11-blockers-resolution.md`.

**Already fixed since report three was written** (no work left, listed so nobody repeats it): `#88` main went green at `f51afb7` (8 Nov 06:17 UTC) and has stayed green through `0a25cc6`; `#89` the three P1 follow-ups #132, #133 and #134 are merged; `#90` the flaky copyright test is fixed by #150 (the cache ages from the caller's clock); `#92` staging is level with main at 277 files (#162); `#93` the privacy page's saved-cards sentence is now true because #149's worker deletes the Stripe customer before finalising a trader's deletion; `B7`, `N418`, `N439` and `N442` are fixed in code by #149 (`20261107220510_account_deletion_scrub.sql`, `20261107220500_username_rules.sql`) and #157; `N627` old photo metadata is stripped by #148 (`20261108120010`); `N232`'s recovery plan now covers storage and Stripe on paper (#148). The OS still shows `N676` and some of these as open because their fixing PRs predate the ids; the next readiness report states each as fixed so the OS reopens its checks.

---

## Workstream A: settle `main` (engineer, this week)

### A1. The agent approval SQL guard is non-deterministic (`#100`, `N677`; High)

**Problem.** `supabase/tests/agent_approval_outcomes_guard.sql` failed once on `main` with "FAIL 8: a refused accept was recorded as refused /" when nothing touching approvals had merged, then passed on the next runs. The refused branch (case 3, a part sold before the owner answered) depends on an ordering the test does not pin: the `pg_temp.answers()` log read in FAIL 8 can be empty when `agent_approval_decide` takes the replay branch. FAIL 7 (line 136) checks outcome, status and order but not `replayed`, so the fault surfaces one assertion late with a message that hides the cause. A flaky guard on the required `release-gate` turns every merge into a coin toss.

**Fix.**
1. Add `or (r->>'replayed')::boolean` to the FAIL 7 condition so the replay branch fails where it happens and the message says so.
2. Find the race: run the guard 30 times on a throwaway Postgres (the `supabase/postgres:17` image CI uses, on a spare port) with `\set VERBOSITY verbose`, capturing `r` on each pass. The candidates are `now()` versus `clock_timestamp()` in the approval's expiry comparison (two statements in one transaction share `now()`), and `pg_temp.reset()` clearing the answers log before `answers(ac)` is read. Pin whichever it is: give case 3 its own approval row with an expiry well in the future, and read the answers log before any reset.
3. Rerun 30 times locally, then rerun CI's `sql-guard` three times on the PR.

**Done when** 30 consecutive local passes and 3 consecutive CI passes; FAIL 7 asserts `replayed`; the PR title or `Resolves:` line carries `N677`.

**Plain words.** One of the automatic checks that guards every merge sometimes fails for no reason. Make it fail only when something is actually wrong. Half a day.

### A2. Merges land on a base that is no longer `main` (`#88` pattern, repeated 8 Nov; High)

**Problem.** Twice in 24 hours a PR that was green against an older `main` merged after another PR changed the rules it was tested under: #123's guard against #126's dropped table (red from 02:37 to 06:17 UTC), then #148, #152, #154, #156 and #158 merging migrations after #143 and #145 added the MIGRATIONS.md and build-info checks (red from 05:36 to 06:17 UTC, repaired by #160's path). GitHub's concurrency model cannot catch this: a started `main` run is never cancelled and only the pending head changes.

**Fix.** Turn on **"Require branches to be up to date before merging"** (strict status checks) on `main`'s protection rule. Every PR must then contain current `main` before its checks count, so a PR is always tested against the rules it will land on. Cost: a PR that falls behind needs one `Update branch` click and a rerun, about 15 minutes of CI. Owner setting (repository admin); record it in `docs/owner/branch-protection.md`. Alternative if the rerun cost bites once many sessions merge at once: GitHub's merge queue, which tests PRs in merge order automatically.

**Done when** `gh api repos/:owner/:repo/branches/main/protection` shows `required_status_checks.strict: true`, and the branch-protection doc says so.

**Plain words.** Two changes that were each fine on their own broke the site's checks when they met. Make GitHub refuse to merge anything that has not been retested against the latest code. Ten minutes for Neil.

### A3. Twelve merged PRs and three follow-ups owe a Codex review, and the queue is on one laptop (`#95`; Medium)

**Problem.** Full reviews owed: #95, #125, #126, #129, #130, and the proof sweeps #98, #100, #101, #103 once merged. Fix-checks owed: #132, #133, #134. The queue lives at `~/drvn-worktrees/_plan/gpt-postmerge-queue.md`, not in the repository, so the OS and other sessions cannot see it. Neil ruled Codex never blocks a merge, so this is a debt, not a stop.

**Fix.** Commit the queue as `docs/review-evidence/codex-queue.md` with one row per merged PR since #61: PR, reviewed on, verdict link or "docs-only, skipped". Work it down at the rationed rate (`feedback-gpt-review-before-merge`), one Codex session per PR, findings filed as OS ids. Add a one-line CI test that every PR merged after a dated cut appears in the queue file (the `pr-resolves` test already parses PR metadata; extend it or add `tests/ci/codex-queue.test.ts`).

**Done when** every merged code PR since #61 has a row with a review date or an explicit skip reason, and no row is older than seven days without a date.

**Plain words.** A second reviewer, GPT, is meant to read every change after it lands. Twelve changes have not been read. Put the list in the shared repo where everyone can see it, and work through it. Two to three days of rationed review time.

### A4. The job inventory can lose a family silently (`#96`, `N680`; Medium)

**Problem.** `private.scheduled_job_inventory` was restated four times on 7 November and `invoke_remediation_worker` several times. Spot checks showed every restatement kept all three families (`saved-search-digests`, `ledger-reconciliation`, `payoutDeadlines`), but nothing asserts it. `supabase/tests/job_inventory_health_guard.sql` checks that families are distinct and that the snapshot lists every job, by design with "no fixed row count anywhere", so a restatement that drops a family passes.

**Fix.** Add a FAIL to `job_inventory_health_guard.sql` asserting that the set of families equals the documented list in `docs/production-runbook.md` §4 (read the list from a `values` clause in the test, not from a count), and that `invoke_remediation_worker` accepts each family name without raising. Prove it by temporarily deleting one family on the throwaway database and watching the guard fail.

**Done when** the guard fails when a family is removed, passes on `main`, and the test's family list matches the runbook.

**Plain words.** The list of background jobs was rewritten four times in one day. Add a check that the list is always complete, so the next rewrite cannot quietly lose one. Two hours.

### A5. The readiness crosswalk cites a test that does not exist (`#98`; Low)

**Problem.** `docs/plans/2026-11-readiness-crosswalk.json` lines 1653 and 1657 name `tests/ci/dependency-advisories.test.ts` as B1's proof. `tests/ci/` holds no such file. `tests/ci/crosswalk-json.test.ts` checks the JSON's shape, not that cited files exist.

**Fix.** Write the missing test: assert `package-lock.json` resolves `next` ≥ 16.4.3, `undici` ≥ 8.12.3 and `zod` ≥ 4.6.7, and that `ci.yml`'s audit step uses `--audit-level=high`. Then make `crosswalk-json.test.ts` assert every `file` the crosswalk cites exists on disk, so the crosswalk can never cite vapour again.

**Done when** both tests pass and the crosswalk test fails if a cited path is removed.

**Plain words.** The document that says "here is the proof for each fix" points at a proof file that was never written. Write it, and make the document check its own links. One hour.

### A6. Migration filenames do not match apply order (`#97`; Low)

**Problem.** Three migrations were renamed after rebase, so a file dated 26 October was written on 7 November and one is dated after the day it merged. Apply order on dev, staging and (later) production is the merge order, found by `git diff --diff-filter=A`, never by name. Nothing stops the next rename.

**Fix.** Add to `tests/ci/migration-objects.test.ts` (or a new `migration-order.test.ts`) an assertion that every migration file added in the PR has a timestamp later than every file already on the base branch, and that no file on the base was renamed or removed. Write the rule into `supabase/MIGRATIONS.md`: a merged migration is never renamed.

**Done when** a PR adding a back-dated migration fails CI with a message naming the file.

**Plain words.** Database change files are supposed to run in date order, but three were given wrong dates. Add a check that new files are always dated after the old ones. One hour.

### A7. Stale pull requests (`R53-pr`, #67, the four proof sweeps; Low)

**Problem.** Six PRs are open. #98, #100, #101 and #103 are cloud proof sweeps that add tests for items already fixed; they predate #138's `Resolves` enforcement and A2's rule. #67 is the 3 November report, which is already on `main` as `docs/production-readiness-2026-11-03.md` (commit `006d4b1`). #53 reconciles the design docs and has conflicted for a month.

**Fix.** Update each proof sweep to current `main`, rerun, merge when green with its ids in the title (they already are). Close #67 as superseded. For #53, resolve the conflicts in one sitting or split it: the brand assets and retirements that still apply, then close the rest; the memory note `drvn-design-docs-reconcile` records what it contained.

**Done when** `gh pr list` shows no PR older than seven days.

**Plain words.** Six half-finished changes are sitting open. Finish or close each one. Half a day.

### A8. Eighty-five uncommitted design files on the shared checkout (`#99`, `R86`; Low)

**Problem.** `design-mockups/` assets, the ledger, `index.html`, `serve.json` and `.claude/launch.json` have been modified or untracked on the shared `main` checkout for weeks. A dirty shared checkout hides real changes and makes "is this on main?" a question.

**Fix.** Neil rules keep or discard. If keep: commit them to a branch `design/concepts-2026-10` (not `main`; they are concept assets, 30 MB of images and video) and push it, so the checkout is clean and the work is safe. If discard: `git stash` to a named stash first, then clean. Either way, add `design-mockups/assets/*.mp4` and the `.bin` files to a size-conscious review before anything from that branch comes to `main`.

**Done when** `git status` on the shared checkout is clean and the concept assets are on a pushed branch or deliberately gone.

**Plain words.** Dozens of design picture files are sitting in the working folder, neither saved to the project history nor thrown away. Decide, then do it. Fifteen minutes.

---

## Workstream B: the migration record and release script (engineer)

### B1. Shared dev's migration history still has 12 gaps (`#91`, `R-migrations`; Medium)

**Problem.** Shared dev has run every migration but its `supabase_migrations.schema_migrations` table only records some of them. `--record-only` (#147, #151) wrote rows for the files whose objects it could verify read-only and refused 12 whose SQL it cannot parse (dynamic SQL) or whose objects a later migration replaced. Shared dev also has 5 rows from the 13 September files under their pre-rename timestamps. Until the history is complete, the runner's "skip recorded files" safety does not cover those 12, and a whole-tree apply remains forbidden on dev.

**Fix.** For each of the 12, write one line in `supabase/MIGRATIONS.md` saying why record-only refused it and what evidence shows it ran (a table, function or policy fingerprint matched on staging, which was seeded from the same files). Then extend the runner with `--record-only --attest <file> --reason "<text>"` that writes the row with the reason in `migration_provenance` (#146's table), allowed only for files listed in MIGRATIONS.md with a reason. Do not force rows without a written reason. Shared dev is a development database; the goal is a complete, honest record, not a perfect one.

**Done when** `node scripts/apply-migration.mjs --target shared-dev --status` reports none missing, every attested row has a reason in `migration_provenance`, and the 5 pre-rename rows are documented as kept.

**Plain words.** The development database has run every change but its logbook is missing twelve entries. Write the twelve entries by hand with a note on why each is known to have run. Two hours.

### B2. Keep staging level with `main` from now on (`R-staging-behind`, closed by #162; rule)

**Problem.** Staging fell 30 files behind in a day because applying to staging was nobody's step. #162 caught it up. Nothing prevents the next drift.

**Fix.** Rule in `supabase/MIGRATIONS.md`: a migration PR is applied to shared dev *and* staging before merge, by the same session, with both cells filled. Extend `tests/ci/migrations-md.test.ts` so a row may say `shared-dev` without `staging` only when the file is less than two days old. Later, D2's deploy pipeline applies to staging automatically.

**Done when** the test exists and `--status` on staging reports none missing at each report.

**Plain words.** The test site's database must get every change the development one gets, the same day. Make that a rule the checks enforce. One hour.

### B3. The release-candidate script still requires the removed beta (`#94`, `R-rcconfig`, `R-gates`; Medium)

**Problem.** `scripts/release-candidate.mjs:16` throws unless `betaRequired: true`, and `docs/staging-setup.md` §2.5 (lines 116–121) and §12 still say to turn the invited-beta gate on and check "Admin → Invitations". #126 removed the invitation machinery and dropped `public.beta_access_config`. The 15-gate packet cannot be produced as written.

**Fix.** Re-rule the gate list with Neil (one decision: the "invitation boundaries" gate is replaced by a "guest hold caps" gate that proves 2 live holds per device and per network and 1 per listing, `20261107220800`). Update the script: drop `betaRequired`, add `guestCheckout: "capped"`, keep the explicit `analyticsEnabled`, `searchEnabled` and shipping decisions. Rewrite §2.5, §12 and §13 of `docs/staging-setup.md` and the gate table in `docs/production-runbook.md`. Keep 15 gates so the packet's shape and the owner checklist row 13 stay true.

**Done when** `node scripts/release-candidate.mjs` accepts a config with no beta field, the docs mention no invitation gate, and the gate list names guest hold caps.

**Plain words.** The checklist for signing off a release still has a step for an invite-only mode that was removed. Replace that step with the guest-buyer limits that replaced it. Two hours plus one decision.

### B4. Production target added by a reviewed PR before its first migration (prep for D4)

**Problem.** `supabase/migration-targets.json` names shared dev and staging. The runner refuses an unlisted target, which is right. Production must be added before the first apply, by a PR, not by hand.

**Fix.** When D4 creates the project, a one-line PR adds `production` with its ref and region; the runner's TLS and `--target` rules then cover it. `docs/production-runbook.md` §1 already says this.

**Done when** the target exists in the file on `main` and a dry run against production prints the full missing list.

**Plain words.** The tool that applies database changes only works on databases it has been told about. Tell it about production, through a reviewed change, before touching production. Fifteen minutes.

---

## Workstream C: the remaining code items (engineer)

### C1. Prove account deletion end to end on staging (`B7`, `N418`, `N439`, `N442`; was Blocker, now verification)

**Problem.** #149 and #157 fixed the code: `20261107220510` scrubs email, addresses, order party labels, message and comment bodies and exports with a keyed digest, keeps transaction keys six years, and `account-deletion-worker.ts:195–202` deletes the Stripe customer for traders before finalising. None of it has run on a hosted project.

**Fix.** On staging once D3 is done: create a member, buy and sell once in test mode, request deletion, run the worker, then check as `os_reader`: no row in `auth.users`, the profile's email is a digest, the order's party label is anonymised, the Stripe customer is deleted in the test dashboard, and the deletion request says completed. Record the run in `docs/release-evidence/`. Add the same scenario to the export-and-deletion gate of the packet.

**Done when** the evidence file exists and the gate passes on staging.

**Plain words.** Deleting your account now really deletes your personal data, even if you have bought or sold. Prove it once on the test site and keep the proof. Two hours, after staging exists.

### C2. Transfer crash recovery searches only 1,000 transfers (`N499`; Medium)

**Problem.** When the transfer worker crashes between creating a Stripe transfer and recording it, recovery lists recent transfers to find the orphan. The listing stops at 1,000, so at volume an orphan older than 1,000 transfers is never found and the seller may be paid twice or never.

**Fix.** Recovery should not search at all: every transfer is created with an idempotency key derived from the transfer intent id, so recovery re-issues the same create call with the same key and Stripe returns the existing transfer. Where the key is not yet stored, add it to `transfer_intents`. Keep the list as a fallback bounded by `created[gte]` = the intent's `due_at` minus a day, auto-paginated. Test: a unit test where the orphan is the 1,001st transfer.

**Done when** the test passes and `transfer-worker.ts` recovers by idempotency key first.

**Plain words.** If the payout program crashes halfway through paying a seller, it looks back through the last thousand payments to find the one it lost. Make it ask Stripe directly for that exact payment instead. Half a day.

### C3. Deploys don't wait for CI or check migrations (`N528`; closes with D2)

**Problem.** True because no deployment exists. When one does, a bad merge must not reach staging or production.

**Fix.** Part of D2: the deploy job runs only on `release-gate` success and refuses when `apply-migration --status` on the target reports a missing file.

**Done when** D2 is done.

### C4. Private cars' and draft listings' photos are publicly readable (`N455`; decision, then code)

**Problem.** Photos are served from a public bucket. A private car's or a draft listing's photo is reachable by anyone who has or guesses its URL, even though the page is not.

**Fix.** Neil decides: accept (document it in the privacy page as "photos you upload are served from public addresses even for private cars") or fix. The fix: a second, private bucket for private cars and drafts, read through signed URLs with a one-hour life from `src/lib/media-upload.ts`'s read path, moved when the car or listing becomes public. Recommended: fix, because the privacy page should not need a caveat about private cars.

**Done when** a logged-out `GET` of a private car's photo URL returns 403 and the e2e suite has the case.

**Plain words.** Pictures of a car you marked private can still be opened by anyone with the link. Decide whether that is acceptable; if not, lock those pictures behind short-lived links. One day.

### C5. Keep or revert the 18+ confirmation and the copyright takedown (`R69-age`, `R69-dmca`, `N686`; decision)

**Problem.** PR #117 shipped both after Neil ruled "not now". Both are built, migrated on dev and staging, and reversible. Earlier members have no age record.

**Fix.** Neil rules. Recommended: keep both. eBay requires 18+ in its User Agreement, and a takedown route is required anyway once there is a legal entity to register a DMCA agent for (F4). If kept: backfill earlier members with a one-time age declaration at next sign-in (a short migration adding a `needs_age_confirmation` flag read by the sign-in flow). If reverted: one PR removing the three `20261107231001–3` migrations' objects forward and the two routes.

**Done when** the ruling is in `docs/decisions/` and either the backfill prompt or the removal PR is merged.

**Plain words.** Two things were built that Neil had said to leave for later: asking members to confirm they are 18, and a way for copyright owners to ask for content to be removed. Decide whether they stay. Ten minutes to decide, half a day either way.

### C6. Supabase's minimum password is 6 while the app requires 8, and sign-in limits could lock everyone out (`N451`, `N441`, `N662`; owner dashboard, engineer drives)

**Problem.** The app enforces 8 characters and its own throttles, but Supabase Auth's hosted settings (minimum length 6, default per-IP sign-in limits, secure email change off) can be reached directly with the public key, and the per-IP limit counts the app server's few addresses as one client, so launch traffic could trip it.

**Fix.** Owner checklist row 3a, on staging now and production later: minimum length 8, secure password change and secure email change on, sign-in and sign-up rate limits raised above expected peak, token verifications in step, emails per hour matched to the SMTP provider. Decide bot protection (Turnstile or hCaptcha) separately: off today, needs a widget on three forms.

**Done when** a screenshot of each setting is in `docs/release-evidence/` for staging, and again for production.

**Plain words.** Some sign-in safety settings live in the database provider's dashboard, not in the code, and they are still at defaults. Set them. Twenty minutes.

### C7. The sandbox payment override must be absent in production (`N540`)

**Problem.** `PAYMENTS_ALLOW_STUB_IN_PRODUCTION` exists for tests. If set in production the app would take fake payments.

**Fix.** The app already refuses to boot in live mode without Stripe keys. Add to the release-candidate `verify` step a check that the production environment has no variable of that name, read through the hosting provider's CLI, and a runtime assertion at boot that throws if `NODE_ENV=production` and the override is set, regardless of payment mode.

**Done when** the boot assertion has a unit test and the packet's operations gate lists the check.

**Plain words.** There is a switch that lets the test site pretend to take payments. Make sure it can never be on for the real site. One hour.

### C8. Infrastructure readiness has no dated evidence (`N224`)

**Problem.** The runbook says what production needs; nothing records that each thing was done, when, by whom.

**Fix.** `docs/release-evidence/infrastructure.md`: one row per runbook §4 variable and §1 setting, with a date and the person, filled as D1–D7 complete. The packet's operations gate reads it.

**Done when** every row has a date.

**Plain words.** Keep a dated checklist of every piece of infrastructure as it is set up, so the release sign-off can point at it. Ongoing, minutes each.

---

## Workstream D: environments, deployment and operations (Neil creates, engineer configures)

This is the critical path. Nothing in E or the soak can start until D1 and D3 are done.

### D1. Hosting account and domain (`R-hosting`, holds 5 items; Blocker)

**Problem.** There is nowhere to run the site. The code assumes a Vercel-style host (`VERCEL_*` fallbacks in `src/lib/env.ts`); there is no `vercel.json`, no project, no domain, and the legal pages already print `hello@drvn.app` and `privacy@drvn.app`.

**Fix.** Neil: create the hosting account with 2FA, register or confirm the domain, create a `staging` project pointed at the repository's `main` with automatic deploys off until D2, and add the engineer as a member. Engineer: `vercel.json` (or the host's equivalent) with the Node version, the `build-info` step, and headers; DNS records for `staging.<domain>` and the apex; the environment variables from `docs/production-runbook.md` §4, entered by Neil from the password manager.

**Done when** `https://staging.<domain>/api/version` returns the current `main` commit.

**Plain words.** Rent the server space and point the web address at it. One hour for Neil, two for the engineer.

### D2. A deploy pipeline (`N634`, `N528`; Blocker)

**Problem.** `.github/workflows/` has `ci.yml` and `worker-monitor.yml` only. Nothing has ever deployed.

**Fix.** A `deploy.yml` workflow with two jobs. **Staging:** on `release-gate` success for a `main` commit, run `apply-migration --status --target staging`; refuse if any file is missing; apply the missing files with the runner (its dry-run and confirm steps become a job step with the confirm code computed from the dry run); then trigger the host's deploy for that exact commit and wait for `/api/version` to report it. **Production:** `workflow_dispatch` only, requiring a tag `rc-YYYYMMDD` that the release packet signed, the same migration check, and a manual approval environment in GitHub. Both post to the alert webhook. The `gh` token needs the `workflow` scope (`gh auth refresh -s workflow`) before this workflow file can be merged by the CLI.

**Done when** a merge to `main` appears on staging within fifteen minutes without a human step, and a production deploy is impossible without an approved tag.

**Plain words.** Build the conveyor belt that moves tested code onto the test site automatically and onto the real site only when a person approves. One day.

### D3. Configure staging, steps 3–13 of `docs/staging-setup.md` (Blocker)

**Problem.** Staging's database is level with `main`, but `job_config` is empty (so every photo upload fails closed until `media_storage_origin` exists), Auth URLs and SMTP are unset, there are no Stripe webhooks, no Sentry DSN, no alert webhook, no first admin, and the 21 pg_cron jobs call a worker URL that does not exist.

**Fix.** In order, once D1 gives a URL: Auth site URL and redirect list; SMTP from the provider chosen in D-mail; `job_config` rows for worker URL, secret and `media_storage_origin = https://zubstjuviwourzgrziqc.supabase.co`; Stripe test webhooks with `scripts/owner/stripe-webhooks.mjs --origin https://staging.<domain> --apply` (Neil runs it with the test key in his shell); EasyPost test key only if shipping is on (E7); Sentry DSN and alert webhook; first admin enrolled with MFA (`N666`); check `select jobname from cron.job` lists 21 jobs and that `/api/jobs/*` answers the monitor.

**Done when** on staging: a new member uploads a photo, receives a sign-up email, a test card purchase completes, `select count(*) from cron.job where jobname like 'drvn-%'` returns 21, and a forced error appears in Sentry.

**Plain words.** Fill in all the settings the test site needs to behave like the real one: email, payments, photo storage, error reporting, background jobs. Half a day of engineer time once the accounts exist.

### D-mail. Email provider (`R-email`; Blocker)

**Problem.** No provider. Sign-up, password reset, guest order links and email change all send through Supabase Auth SMTP, which has no sender. `docs/owner/email-provider.md` compares three providers.

**Fix.** Neil picks one (the doc's recommendation stands unless he objects), verifies the sending domain (DKIM, return-path, DMARC: DNS can take a day), enters SMTP in Supabase, pastes the four templates. Engineer runs the §6 test checklist (`N675`): sign-up, reset, guest link, email change, headers pass, and the guest-link-with-confirm-email gap.

**Done when** the five test emails arrive with passing authentication headers, on staging and later production.

**Plain words.** Choose who sends the site's emails and prove the emails arrive and are not marked as spam. Two hours plus a day waiting for DNS.

### D4. Production Supabase project and the point-in-time-recovery decision (`B6`, `N663`, `N667`; Blocker)

**Problem.** No production database. PITR was declined for staging; for production it must be decided. Production needs the vehicle catalogue import and `job_config` rows, and no seeded members.

**Fix.** Neil: create `drvn-production` on the Pro org, same region, enable PITR (recommended: yes; it is the only way to restore to a minute rather than to last night, and a marketplace with money in flight needs that). Engineer: B4's PR, then apply all migrations with the runner, `job_config` rows, catalogue import by the documented script, Auth settings (C6), no members.

**Done when** `--status --target production` reports none missing, PITR shows enabled, and the catalogue row count matches staging.

**Plain words.** Create the real database, switch on minute-by-minute recovery, and load the car catalogue but no people. One hour for Neil, two for the engineer.

### D5. Error reporting, alerts and uptime (`R-sentry`, `N533`, `R-monitor`; Blocker for live money)

**Problem.** `SENTRY_DSN` and `ADMIN_ALERT_WEBHOOK_URL` are required in live mode and neither project exists. The independent worker monitor has never run: it is skipped until repository variables `DRVN_MONITOR_ENABLED`, `DRVN_MONITOR_ORIGIN` and secret `DRVN_MONITOR_SECRET` are set. Nothing watches whether the site is up.

**Fix.** Neil: Sentry project with 2FA, a Slack (or equivalent) incoming webhook for alerts, an uptime checker hitting `/api/version` every minute with paging to his phone, and the three monitor variables. Engineer: prove the loop by forcing a job failure on staging and watching the alert arrive, then the recovery alert.

**Done when** a forced failure and its recovery both reach the alert channel, Sentry shows a test event from staging, and the uptime check has paged once in a test.

**Plain words.** Set up the dashboards and alarms so that when something breaks, someone's phone rings. One hour for Neil, one for the engineer.

### D6. A hosted restore drill including storage and Stripe (`B6`, `N232`; High)

**Problem.** Restore has been rehearsed locally twice (6 Sep, 24 Oct) and never on a hosted project. The recovery plan now covers storage files and Stripe state on paper (#148) but has not been run.

**Fix.** Restore staging's last backup (or a PITR point) into a scratch project, measure recovery point and time, run the storage reference report (`20261108120020`) against it to list missing files, run the ledger reconciliation against Stripe test mode, and write the result as the packet's restore gate. Delete the scratch project.

**Done when** `docs/release-evidence/restore-drill-<date>.md` records RPO, RTO, the storage diff and the Stripe diff, and Neil has read it.

**Plain words.** Practise recovering the whole site from backup, including the photos and the payment records, and write down how long it took. Half a day.

### D7. Supabase Auth hardening on production (`N662`) and the first admin (`N666`)

Covered by C6 and D3, repeated for production in the owner checklist row 15.

---

## Workstream E: money on hosted systems (Neil's account, engineer proves)

### E1. Stripe account, Connect, test mode on the real domain (`R-stripe`; Blocker)

**Problem.** The code's Stripe integration has run only against unit tests and the stub. No account is configured with Connect Express, no platform profile, no webhooks on a real address.

**Fix.** Neil: enable Connect (Express), complete the platform profile and branding, create restricted test keys, run `scripts/owner/stripe-webhooks.mjs` for staging (D3), register the staging domain for Apple Pay and Google Pay. Keys go into the hosting environment from the password manager.

**Done when** a test event to each webhook endpoint returns 200 from staging and `account.updated` from a test connected account is recorded.

**Plain words.** Connect the real Stripe account to the test site so money can be taken and paid out in test mode. Forty-five minutes.

### E2. Radar 3-D Secure rule and the negative-balances script (`N645`)

**Fix.** Dashboard → Radar → Rules: *Request 3D Secure if `:risk_level: = 'elevated'`*. Run the negative-balances script from `docs/owner/README.md` in test mode, later in live mode.

**Done when** both are screenshotted into `docs/release-evidence/`.

**Plain words.** Two risk settings in Stripe that take ten minutes.

### E3. Wallet device check (`R-devices`)

**Fix.** `docs/owner/wallet-device-check.md`: buy on staging on a real iPhone in Safari and a real Android phone in Chrome.

**Done when** both receipts exist in test mode.

**Plain words.** Prove Apple Pay and Google Pay work on real phones. Forty-five minutes.

### E4. Prove every money path on staging (`R-unproven`, `B2`, `B9`; Blocker)

**Problem.** Settlement, the chargeback freeze, reconciliation, payout setup, the not-received dispute and the 2-day hold are all built and unit-tested and have never run against Stripe.

**Fix.** A scripted scenario list, each producing an evidence file: (1) purchase with a 3-D Secure test card; (2) full refund; (3) partial refund then full; (4) "item never arrived" dispute from the frozen delivery date through seller deadline, escalation and `begin_not_received_refund`; (5) a provider chargeback with test card `4000 0000 0000 0259`, proving `order_has_unresolved_chargeback` freezes the payout; (6) a Connect payout two days after a delivery scan (shorten the clock with `job_config` on staging, never on production); (7) a seller who never completes payout setup, refunded on day 14; (8) a restricted seller account; (9) the daily ledger reconciliation reporting zero difference. These are the packet's purchase, refund, dispute and payout gates.

**Done when** nine evidence files exist and the reconciliation job reports no difference for the week.

**Plain words.** Act out every way money can move, on the test site with Stripe's test cards, and keep a record of each. Two days.

### E5. Money decisions (`N501`, `N607`, `N608`, `R-credits`, `N682`, `R84`; decisions)

See the decisions table. Each has a recommended default so it is a yes or a no.

### E6. Sales tax (`B3` half, `R-merchant`; Blocker for the chosen market)

**Problem.** No tax is calculated anywhere. Whether DRVN must collect depends on the entity, the market and the merchant role (F1), which is why it has waited.

**Fix.** Once F1 settles the market: if the US, enable Stripe Tax on the platform account, pass the buyer's address and the seller's location into the Checkout session, record the tax line in `order_ledger`, and show it on the order and receipt; marketplace facilitator rules then make DRVN the collector in most states. If the UK or EU, counsel confirms the VAT position of a facilitator for private sellers before anything is built. Engineer: half a day for Stripe Tax; a unit test that the ledger's tax line equals Stripe's.

**Done when** a staging checkout in a taxed jurisdiction shows tax, the ledger records it, and counsel has confirmed the role.

**Plain words.** Decide which country you are selling in, then let Stripe work out the tax at checkout. Half a day after the decision.

### E7. Shipping: EasyPost, wallet float, EndShipper versus Forge (`N640`, `N641`; decision)

**Problem.** Integrated shipping is behind `FLAG_INTEGRATED_SHIPPING_V1`. No EasyPost account, no float, and the account model is undecided.

**Fix.** Recommended: launch with the flag off. Since N110 sellers can always dispatch with their own tracking, which is registered with the tracker when available and auto-confirms untracked at 21 days. Turn integrated labels on after launch when volume justifies the float. If Neil wants labels at launch: EasyPost account, test key and webhook in D3, decide EndShipper (DRVN is the shipper of record) versus Forge (sub-accounts per seller), fund the float.

**Done when** the decision is recorded and either the flag is documented off for launch or the account exists.

**Plain words.** Buying shipping labels inside DRVN can wait; sellers can post parts themselves and paste the tracking number. Decide now, build nothing yet.

---

## Workstream F: legal, privacy and the entity (Neil and counsel)

### F1. Entity, jurisdiction, market and currency (`R-entity`, `R-market`, `R-niche`; Blocker, holds 10 items)

**Problem.** The terms have no entity, governing law or address; tax, the Stripe account's country, the DMCA registration and the supervisory authority all depend on it. Launch market and currency are undecided; the code is USD-first with one currency per environment.

**Fix.** Neil decides and records in `docs/decisions/entity-and-market.md`: the entity (name, registration, address), its country, the launch country and currency, and the one car platform the first beta targets (the PRD's non-goal list already rules out multi-market at launch). Engineer then fills the entity fields in `/terms` and `/privacy` and sets the environment currency.

**Done when** the decision file exists and the legal pages name the entity.

**Plain words.** Say which company runs DRVN, in which country, selling in which currency, to owners of which cars first. One decision, everything legal hangs off it.

### F2. Counsel review of terms and privacy (`R-counsel`, `B3` half, and the 15 counsel items; Blocker, longest lead)

**Problem.** Both pages are dated and accurate to the code but headed "NOT LEGAL ADVICE, working draft" (`src/app/(legal)/terms/page.tsx:35`). Counsel has not been engaged. The OS lists fifteen wording items for counsel: held-funds wording (N603), clawback disclosure (N604), offer binding language (N609), the Connected Account Agreement reference (N610), liability cap (N611), dispute decision wording (N612), business sellers' consumer cancellation rights (N613), standard contract clauses (N614), lawful bases (N617), international transfer mechanism (N618), analytics consent model (N623), agent binding-counter terms (N624), the untracked auto-confirm notice (N626), supervisory authority (N597), content licence scope and counter-notice wording (N688), business seller identification (N600).

**Fix.** Neil sends `docs/owner/counsel-packet.md` (Q1–Q16) and `docs/owner/retention-proposal.md` this week; the fifteen items above are already questions in the packet or get added as one appendix. Counsel returns answers; the engineer edits both pages in one PR per return, removing the draft banner last.

**Done when** both pages carry the entity, governing law, liability cap, processors, retention periods and the `UPDATED` date, the draft banner is gone, and counsel's sign-off is filed under `docs/review-evidence/`.

**Plain words.** Send the lawyer the question list and the draft pages now, because this is the slowest step; when the answers come back, update the pages. Thirty minutes to send, weeks to return.

### F3. Retention schedule (`R-retention`; High)

**Problem.** The privacy page says retention periods are "still being set"; twelve data classes in `docs/owner/retention-proposal.md` are unapproved. The deletion scrub's six-year financial clock assumed one of them.

**Fix.** Neil approves the proposal (or amends); counsel confirms; the engineer writes the periods into the privacy page and sets the purge jobs' intervals in `job_config` to match.

**Done when** every data class has a period on the privacy page and a matching purge job or a documented "kept until deletion".

**Plain words.** Decide how long each kind of data is kept, then make the site delete it on that schedule. One hour to approve, two to implement.

### F4. DMCA designated agent and the copyright route's placeholders (`N687`; High if C5 keeps the route)

**Problem.** `src/lib/legal/copyright-agent.ts` holds `confirmed: false` placeholders. Registration with the US Copyright Office needs the entity (F1).

**Fix.** Neil registers the agent once F1 is done, pays the fee, and gives the engineer the registered name and address; one PR sets the fields and `confirmed: true`.

**Done when** the takedown page shows the registered agent and the Copyright Office directory lists DRVN.

**Plain words.** Register the official contact for copyright complaints, then put the real details on the page. Thirty minutes plus the fee.

### F5. Processors, DPAs, mailboxes, provider copies, staff access (`N619`, `N620`, `N596`, `N621`, `N622`)

**Fix.** Once D1, D-mail, D5 and E1 pick the providers: list every processor on the privacy page (hosting, Supabase, Stripe, SMTP, Sentry, alerts, EasyPost if on, Anthropic if the agent is on, Typesense and PostHog if on), accept each one's DPA, and file the acceptances. Confirm `hello@` and `privacy@` mailboxes exist and are read. Write the one-page internal policy on when staff may read messages (recommended: only on a report or dispute, logged through the admin audit that #148 added). Decide the wording for provider copies after deletion (recommended: "providers delete within their stated windows; backups expire within 35 days").

**Done when** the privacy page's processor list matches the environment variables in use and the DPA files exist.

**Plain words.** Name every company that touches member data, sign their data agreements, and write down the rule for when staff may read a message. Two hours spread across the setup.

### F6. "Download my data" (`R-download`) and beta-specific terms (`N599`)

**Fix.** Recommended: keep the export (it is built, paged and gated since #87 and #119; removing a right that exists is worse than keeping one) and no beta-specific terms (the guest caps and normal terms cover a small launch; an invitation-only beta no longer exists). Record both.

**Plain words.** Keep the data download feature; write no special beta rules. Two decisions, ten minutes.

---

## Workstream G: the agent (decision first)

### G1. Is the agent in the first beta? (`R-agent-decision`; holds 6 items)

**Problem.** The agent is built, kill switch seeded on, pages hidden without `AGENTS_BETA`. Opening it needs a production Anthropic key (N637), zero data retention arranged (N625), a console spend limit (N668), the `agent_worker` login and `AGENT_WORKER_DATABASE_URL`, counsel's agent clauses (N624), the agent terms on the live pages (N689), and a run against a real model on record (R75).

**Fix.** Recommended: launch the marketplace without the agent, and open the agent two to four weeks later once N625 and N624 return. The product direction is agent-native, but every task works without it by design (`docs/decisions/agent-foundations.md`), and the six items above are the ones with external lead times. If Neil wants it at launch, G2 joins the critical path.

**Done when** the decision is in `docs/decisions/` and `AGENTS_BETA` is set or left unset accordingly.

**Plain words.** The AI assistant works, but switching it on for the public needs a paid API account, a data-retention agreement with Anthropic and a lawyer's wording. Launch without it and switch it on a few weeks later. One decision.

### G2. If yes, or when the time comes: key, retention, spend limit, worker login, real-model run, terms (`N637`, `N625`, `N668`, `R75`, `N689`, `N624`)

**Fix.** Neil: production key through the password manager, zero data retention on the Anthropic account, console spend limit above the code's caps ($2 per member per day, $50 a day overall). Engineer: `alter role agent_worker with login password` on staging, pooler URL in `AGENT_WORKER_DATABASE_URL`, `AGENTS_BETA=on`, open the steps from `/admin/agent`, run the eval set against the real model and file the result as R75's evidence, put counsel's agent clauses on the pages.

**Done when** an agent task completes on staging against the real model with its audit record, and the pages carry the clauses.

**Plain words.** Pay for the AI, agree that Anthropic keeps none of the data, cap the spend, and prove one real task works. Two hours for Neil, half a day for the engineer.

---

## Workstream H: product decisions still open (`R-ux`, `R-m5`, `R-n4`, `R-explore2m`, `N432`, `R-rcconfig`)

These are not readiness blockers. Each gets a recommended default in the table so it stops appearing in the open list.

- **R-ux** which section-audit changes matter: pick the P0s from `drvn-section-audit-oct` only; the rest after launch.
- **R-m5** the marketplace card lost grade, summary and "N for sale": restore grade and "N for sale"; leave the summary off (density).
- **R-n4** the phone top bar has no Messages or avatar: the bottom bar carries Home and Agent; add an unread-messages dot to Home. No avatar.
- **R-explore2m** Explore text search times out at 2M parts: Postgres search is fine for launch volume; Typesense is the scale answer and is already optional in the config. Decide "Postgres at launch, Typesense at 200k parts".
- **N432** no page can be cached at the edge: accept for launch; the public pages that could be cached (car, listing, profile) depend on viewer state. Revisit with the host's cache API after launch.
- **R-rcconfig** release configuration: shipping off (E7), search Postgres, analytics off (PostHog is a no-op today).

**Plain words.** Six product questions that have waited for a ruling. Each has a sensible default; say yes or change it.

---

## The decisions, in one table

Every item above that is a decision rather than work. Each has a recommended default so that it can be settled in one sitting. "If undecided" says what happens if nothing is said.

| Decision | OS id | Recommended default | If undecided |
|---|---|---|---|
| Legal entity, country, address | R-entity | The entity Neil already operates through, if any; otherwise form one in the launch country first | Terms stay drafts; no Stripe live account; no DMCA agent |
| Launch market and currency | R-market | One country, one currency, the one the entity sits in | Tax (E6) cannot start |
| One car platform and one country for the first beta | R-niche | The platform with the most seeded cars and parts today | Marketing has no target; no effect on code |
| Agent in the first beta | R-agent-decision | No; open it 2–4 weeks after launch | Six items sit on the critical path |
| The twelve shared-dev migration-history rows the runner can't verify | N786 | Document the gaps (done in `supabase/MIGRATIONS.md`) and close by hand; no attested-row runner mode | R-migrations stays open; no effect on staging or production, which are built by the runner |
| How long financial records are kept | R-retention | Six years for financial records, as the deletion scrub already runs (`account_deletion_requests.retain_until`); counsel confirms | The retention proposal stays a draft; the scrub keeps its six-year clock |
| Email provider | R-email | The provider `docs/owner/email-provider.md` recommends | No sign-up emails; staging cannot be used |
| Point-in-time recovery on production | N663 | Yes | Restore is to last night only |
| Who funds chargebacks up front | N501 | DRVN funds, recovers from the seller's next payout, writes off after 90 days | Code already does this; the terms must say it |
| Stripe and chargeback fees | N607 | DRVN absorbs Stripe's fee inside its commission; the seller bears the chargeback fee when the chargeback is upheld | Terms silent |
| Written-off transfer reversals | N608 | Write off after 90 days of failed recovery, logged | Ledger rows never close |
| Credit payout choices (two) | R-credits | Credits are refunds to the original payment method only; no cash-out of credit | Credits code path stays as built (refund only) |
| 14-day payout-setup rule 5 | N682 | A seller who never completes setup is refunded on day 14 and the listing relists; no extension | Code already does this |
| Buyer acceptance ends the mandate before payment | R84 | Keep: acceptance inside the ceiling is PRD AG-3; copy says so | Copy is already fixed |
| Keep 18+ confirmation and copyright takedown | R69-age, R69-dmca | Keep both; backfill earlier members at next sign-in | Both stay live, earlier members unrecorded |
| Private-car and draft photos public | N455 | Fix: private bucket with signed URLs | Privacy page needs a caveat |
| Download my data | R-download | Keep | Stays |
| Beta-specific terms | N599 | None | None |
| Staff reading messages | N622 | Only on a report or dispute, through the audited admin path | No written policy |
| Provider copies after deletion | N621 | State providers' windows; backups expire in 35 days | Privacy page silent |
| Shipping model | N641 | Integrated shipping off at launch | Flag stays off |
| Release configuration | R-rcconfig | Shipping off, Postgres search, analytics off | Packet cannot be written |
| Soak length | N683 | 7 days on staging with the scenario list repeated daily | Packet's soak gate undefined |
| Bot protection at sign-up | (C6) | Off at launch; turn on if sign-up abuse appears | App throttle only |
| Edge caching | N432 | Accept none at launch | None |
| Section-audit changes | R-ux | P0s only | Nothing changes |
| Marketplace card fields | R-m5 | Restore grade and "N for sale" | Card stays as is |
| Phone top bar | R-n4 | Unread dot on Home, no avatar | Stays |
| Explore search at 2M | R-explore2m | Postgres now, Typesense at 200k parts | Stays Postgres |
| Design-concept files | #99 | Commit to `design/concepts-2026-10` | Checkout stays dirty |
| The 15th gate | #94 | Guest hold caps replaces invitation boundaries | Packet script fails |

---

## Sequence

Hands-on time, not calendar time, is given per item above. The calendar below assumes the engineer works it in order, Neil does his items within the week they are listed, and counsel is engaged in week 1.

**Week 1 (8–14 November): settle the code, open the accounts, send to counsel**

| Who | Items |
|---|---|
| Engineer | A1 approval guard · A4 inventory families · A5 crosswalk test · A6 migration order test · A7 stale PRs · B1 history gaps · B2 staging rule · B3 release script (after Neil's gate ruling) · C2 transfer recovery · C7 stub assertion · A3 queue file committed and first reviews |
| Neil | A2 strict status checks · A8 design files ruling · the decisions table in one sitting · D1 hosting and domain · D-mail provider and DNS · E1 Stripe Connect and test keys · D5 Sentry, alert webhook, uptime, monitor variables · F1 entity and market · F2 send the counsel packet · G1 agent ruling |
| Counsel | Receives the packet |

**Week 2 (15–21 November): staging becomes the real thing in test mode**

| Who | Items |
|---|---|
| Engineer | D2 deploy pipeline · D3 staging configured · C6 Auth settings on staging · C1 deletion proof · E4 money scenarios begin · C4 private photos (if ruled fix) · C5 age backfill or removal · F3 retention periods on the page · C8 evidence file started |
| Neil | E2 Radar and negative balances · E3 wallet device check · D-mail §6 email tests with the engineer · F4 DMCA registration (needs F1) · F5 DPAs as providers are chosen |

**Week 3 (22–28 November): soak, restore, packet**

| Who | Items |
|---|---|
| Engineer | E4 finished · D6 restore drill · soak (N683) running daily · the 15-gate packet built · E6 Stripe Tax if the market is ruled · remaining A3 reviews |
| Neil | Reads each gate's evidence as it lands · signs the packet · D4 creates the production project and turns on PITR |

**Week 4 (29 November–5 December): production**

| Who | Items |
|---|---|
| Engineer | B4 target PR · D4 schema and catalogue · D7 Auth on production · webhooks with `--live` · one live purchase, refund, dispute and payout with Neil's card · the `rc-` tag and the approved production deploy |
| Neil | Live Stripe keys from the password manager · the live Radar rule and negative-balances run · wallet domains in live mode · the real transaction |
| Counsel | Returns (if not earlier); the engineer updates the pages and removes the draft banner. **Launch waits for this step.** |

**After launch:** G2 the agent (two to four weeks), E7 integrated shipping when volume justifies the float, H's deferred product items, Typesense at 200k parts.

**The critical path** is F2 (counsel) in calendar time and D1 → D3 → E4 → packet → D4 in engineering time. Everything in A, B and C can be done in parallel with D and does not block it.

---

## What "done" looks like

The project is a real product when all of the following are true and each has a dated evidence file under `docs/release-evidence/`:

1. **The 15 gates pass on staging and the packet is signed** (owner checklist row 13): purchase, refund, dispute and payout; guest hold caps; export and deletion; accessibility; operations; hosted restore and rollback; soak; and `scripts/release-candidate.mjs verify` green on a clean build.
2. **`main` has been green for seven consecutive days** with strict status checks on, no flaky job, and the Codex queue has no row older than seven days.
3. **Every migration is recorded** on shared dev, staging and production with none missing, and no file has been renamed since the order test landed.
4. **Production exists**: hosting, domain, database with PITR, email, Stripe live with both webhooks, Sentry, alerts, uptime paging, the monitor running every 15 minutes, 21 cron jobs, `job_config` complete, Auth hardened, first admin on MFA, no stub override.
5. **One real transaction has completed end to end** with a real card: purchase, delivery, payout two days later into a real bank account, and a refund.
6. **The legal pages are final**: entity, governing law, liability cap, processors, retention periods, the entity's DMCA agent, no draft banner, counsel's sign-off on file, the 18+ record for every member.
7. **Every decision in the table has a line in `docs/decisions/`** or a ruling recorded in this file's successor.
8. **The OS lists no open item owned by an engineer**, and every owner and counsel item is either done or deliberately deferred with a date.

In plain words: a member can find a part, buy it, get it, and the seller gets paid, on a real website with real money, and every piece of that has been tested and written down; the pages that promise things to members are true and a lawyer agrees; when something breaks, someone finds out within a minute and can restore the site from backup; and nothing is running on defaults or on trust.

---

## Tracking

- Engineering items close in the OS when a merged, CI-green PR names the id in its title or a `Resolves:` line (#138's enforcement). The PR template should carry the line.
- Owner and counsel items close when the OS's next ingested report states them done with a date; the next readiness report (report four) is the place for that, written when the packet is signed.
- This plan is a `docs/plans/` file and is not ingested. Its successor record, like `docs/plans/2026-10-release-r4-record.md`, is written as the work lands.
- Items already fixed since report three (listed in "How to read") need their ids stated as fixed in report four so the OS reopens its checks; in the meantime a `Resolves: N676` line on A1's PR closes the flaky-test item alongside its sibling.

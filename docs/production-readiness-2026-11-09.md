# DRVN production-readiness review: 9 November 2026

A whole-codebase readiness review of `main` at `aee656d` (merge of PR #185, 9 Nov 08:11 UTC), written on the evening of Monday 9 November 2026 (US Eastern). It is report five. It covers the work of 5 to 9 November as a whole, everything merged since report four (`docs/production-readiness-2026-11-08.md`, written at `cf7109e`), what six working sessions reported when asked, a fresh review of what the first hosted deploy will meet, and a reconciliation of the Intelligence OS's open list against GitHub and the databases.

**How to read this**

- **Severity:** Blocker (fix before any real member or payment) · High (before public launch) · Medium (soon after, or before scale) · Low (polish).
- **Confidence:** Checked (re-traced in code, on GitHub or in a database today) · Reported (a session said so and it was not re-traced) · Needs a live test.
- Ids: `N###` and `R-…` are the Intelligence OS's ids, written as "OS id X" so the OS matches the line to the item it already holds. `#88`–`#103` are findings of reports three and four. New findings here are `#104` onward. Pull requests are written "PR #N" where a finding number could be confused with one.
- "Is fixed by #N" means that pull request is merged on `main`. Writing it asks the Intelligence OS to run the item's check again; the code decides.
- Nothing in the project was modified other than adding this file.

---

## 1. The short version

**Verdict: 80 out of 100, down two, and still no-go for real members or real money. Nothing broke: a fresh read of the deploy path found that the first hosted deploy cannot work as documented and that the app sends no order email (section 5). Nothing hosted exists, and none of the owner steps has started.** One pull request merged since report four (PR #185, test fixtures). `main` is green on all eight CI jobs, staging is level with `main`, the dependency audit is clean. GitHub has no `staging` or `production` environment, no repository variable is set, and `docs/release-evidence/infrastructure.md` still has two filled rows, both from 7 November.

The score is a code score. It cannot rise until something runs on a host: every remaining point is in "Environments and operations", "Money on hosted systems" and "Legal and privacy", and all three wait on the owner.

| Area | 3 Nov | 7 Nov | 8 Nov | Today | Why |
|---|---|---|---|---|---|
| Code correctness and safety | 55 | 85 | 90 | 88 | No code change; no order emails (#116), per-process photo signing (#117) |
| Tests and CI | 60 | 75 | 85 | 85 | Green; 31 Codex reviews still owed |
| Environments and operations | 20 | 35 | 45 | 40 | No hosting, domain, production project, Sentry or alerts; the deploy workflow cannot reach the database (#114), the set-up order cannot boot (#115), the monitor's schedule is not what it claims (#104) |
| Money on hosted systems | 40 | 50 | 50 | 50 | Nothing has run against Stripe on a hosted deployment |
| Legal and privacy | 30 | 40 | 50 | 50 | Terms still a draft; no entity, tax or counsel |
| Agent | 55 | 70 | 72 | 72 | No real-model run on record |
| **Overall** | **69** | **78** | **82** | **80** | Owner path has not started; first-deploy findings |

**The five days in numbers (5 to 9 November)**

| Measure | Value |
|---|---|
| Merge commits on `main`, 7 Nov / 8 Nov / 9 Nov | 94 / 89 / 1 |
| Pull requests merged in the project to date | 180 |
| Files changed since the 3 November baseline (`ce19681`) | 901 (+87,245 / −5,850 lines) |
| Files changed since report four (`cf7109e`) | 4 (+376 / −14 lines) |
| Migrations on `main` | 284 (none added since report four) |
| Staging | 284 rows, newest `20261108180000`: level with `main` (probed 22:20 UTC) |
| Shared dev | 277 rows recorded, 12 explained gaps, 5 extra rows from before a rename |
| Open pull requests | 1 (PR #53) |
| Remote branches | 123, of which 120 are merged into `main` |
| Intelligence OS | 110 open, 172 resolved (report four: 76 open). The rise is the OS reading reports three and four, not new problems: see section 6 |

**What matters most today**

1. **The owner path is the whole critical path, and it has not started.** OS id R-hosting holds five other items and every hosted proof; OS id R-entity holds counsel, the Stripe account's country, the copyright agent and tax. Section 8 gives the order.
2. **Nothing has ever been deployed, and the first deploy would fail as documented.** The workflow's database check cannot reach Supabase from GitHub without the IPv4 add-on (#114), and the set-up guide deploys before the secrets the app needs to boot exist (#115).
3. **The app sends no order email (#116).** A seller is not told by email that a part sold.
4. **The independent monitor is not independent enough (#104).** GitHub starts the "every 15 minutes" workflow about every four to eight hours.
5. **Three places are the likeliest first incidents**, by the account of the sessions that built them: photo signing (#105), the account-deletion state machine (#106), and the never-run deploy workflow (section 4).
6. **The Intelligence OS's count overstates the work.** About 24 of its 110 open items are fixed or duplicates; section 6 names each one so they close.

---

## 2. What landed, 5 to 9 November

Reports three and four list every pull request; this is the shape of the five days.

- **7 November, 94 merges.** The blockers plan: admin read gates (B4), evidence that cannot be deleted (B5), the chargeback hold on payouts (B9), the buyer's own route to a refund (B2), the agent worker's schedule (B8), the dependency fix (B1), the 18+ confirmation and copyright takedown route, the invite-only beta removed in favour of capped guest checkout, the eBay-style 14-day payout setup, and `drvn-staging` created on the Pro organisation.
- **8 November, 89 merges.** The remediation plan: account deletion that scrubs former traders (B7), private member photos through signed links, crash recovery for transfers, the deploy workflow, the release script's 15th gate, the staging-level rule, the signals the Intelligence OS reads (`Resolves:` lines, per-lane test results, migration status, `/api/version`), branch protection requiring an up-to-date branch, and reports three and four.
- **9 November, 1 merge.** PR #185: browser-test fixtures take a random password per account, and `docs/owner/seed-password.md` records the 7 November rotation. OS id R-password closed on it.

No migration was applied on 9 November. No ruling and no owner step is on record for 9 November.

One correction to report four: it said PR #135 was closed as a duplicate of #136. Both merged, a minute apart, on 8 November; the result on `main` is the same.

---

## 3. Health checks

From CI's run on `main` at `aee656d` (run 42584172289, first attempt) and probes made today.

| Check | Result |
|---|---|
| CI on `main` | **Green on all eight jobs**: verify, secrets, secrets-full, sql-guard, e2e, stripe-integration, summary, release-gate |
| Unit tests | **2,836 passed, 0 failed** |
| SQL guards | **154 passed** on a fresh PostgreSQL 17 with all 284 migrations |
| Browser suite | **328 selected, 326 passed, 0 flaky, 2 excluded** on three browsers; first attempt |
| Operations suite / Stripe integration | 20 passed / 10 passed |
| Release-gate record | `result: success`, every requirement `ok` |
| Production dependency audit | **0 vulnerabilities** |
| Staging migration history (read-only role) | 284 rows, newest `20261108180000` |
| Shared dev (`--status`) | 277 applied, 12 missing, 5 extra, newest `20261108180000` |
| Deploy workflow | Skipped on every push: no `DRVN_DEPLOY_STAGING` variable, no GitHub environments |
| Worker monitor | Skipped on every run; 30 runs in the last 7 days against a schedule of 672 (#104) |
| Codex review queue | 31 rows owed, oldest from 24 October; none ran on 9 November |

The five extra shared-dev rows are the 13 September marketplace files recorded under their timestamps from before a rename (`supabase/MIGRATIONS.md`, "known extras"); they are harmless and stay.

---

## 4. New findings

**#104 The independent worker monitor runs about every four to eight hours, not every fifteen minutes (High, Checked).** `.github/workflows/worker-monitor.yml` is scheduled `*/15 * * * *`. GitHub's own run history shows 30 runs between 2 and 9 November, three or four a day, with gaps of up to eight hours; GitHub delays and drops scheduled runs on repositories with little activity, and says so in its documentation. The monitor exists so that something outside the host notices when the payout, deletion and digest workers stop. At this cadence a stalled payout worker could go unnoticed for most of a day. The fix is an owner account, not code: an uptime service that calls the monitor's endpoint every few minutes and pages a phone (the same service already needed for uptime, OS id N533), with the GitHub workflow kept as a second line. OS id R-monitor.

**#105 Photo signing is the newest unreviewed path and fails to a broken image (Medium, Reported).** PR #178 made member photos private and signs their links once at the database boundary. The session that built it reports: no Codex review yet; any loader that uses the all-access client without the signing wrapper shows a broken photo (three were fixed by hand, others may exist); when signing fails or is slow the fallback is the unsigned link, which the storage layer now refuses; the image cache was cut from 31 days to one hour, so images are re-encoded hourly; and the browser test was weakened from "the private car page is a 404" to "the page does not contain the photo or the name". Review PR #178 first in the Codex queue and prove it on staging with a second server instance.

**#106 Account deletion has been restated four times in three days and has no operator runbook (Medium, Reported; needs a live test).** Migrations `20261107220510`, `20261108130400`, `20261108140000` and `20261108180000` each rewrote part of the hold, scrub and requeue logic. Three known limits stand: a requeued case stays banned until the worker's next pass (one-hour backoff); a paused member stays suspended for messaging and listing; a hold found after the scrub goes to an operator, and the only instruction is the `next_action` text on the row. The scrub writes `auth.users` and `auth.identities` as a definer function, and nobody has confirmed a hosted Supabase project allows the migration role to do that; if it does not, deletion fails loudly and retries. Write the runbook section, then run the live deletion on staging. OS id N734.

**#107 Agent event rows written before the redaction fix may hold corrupted ids (Low, Reported).** Until PR #158, card-number redaction mangled about 0.3% of UUIDs in `agent_events`. The fix stopped new damage; no audit or backfill of existing rows was run. Shared dev and staging hold only test data, so this is a note for the record unless either database is promoted.

**#108 Three stuck states can only be cleared in SQL (Medium, Reported).** A chargeback journal entry stuck in `recovery` freezes the seller's payout and any deletion until an operator edits it; a deletion in `operator_attention` has no admin action; the twelve refused shared-dev history rows need a person. The first two need an admin control or a runbook entry before real money.

**#109 Open second-priority Codex findings on two merged features (Medium, Reported).** Saved-search digests (PR #84): a publication race can lose matches, the 800-a-day cap drops admitted matches, and restarting an alert resends the old digest. Copyright takedown (PR #117): a reserved listing can return after a takedown, media can be reattached before clean-up, the blocklist read truncates at 1,000 rows, and no browser test proves a cached image is intercepted. The guest-checkout findings from PR #111 are fixed by #141 and #152.

**#110 Members with a long-lived session are never asked to confirm 18+ (Low, Reported).** PR #174 asks earlier members once at their next sign-in. A member who stays signed in is not asked until their session ends. Session length is a hosted Supabase Auth setting, still at its default. OS id N662.

**#111 The GitHub command-line token cannot change workflow files (Low, Checked by two sessions).** Any pull request that edits `.github/workflows` has to be stacked or merged in the browser. One command by the owner fixes it: `gh auth refresh -s workflow`.

**#112 Nothing notices if branch protection is removed (Low, Reported).** On 8 November `main` had no ruleset for nine minutes and six pull requests merged before their checks finished. Protection is back; no check or alert watches for the ruleset's absence.

**#113 The production deploy accepts an annotated tag, not a signed one (Low, Reported).** `deploy.yml` checks that the `rc-` tag is annotated. The workflow's own header says the tag is "signed off in the release packet". The required reviewer on the `production` environment is the real control; say which is intended.

---

## 5. What the first hosted deploy will meet

A separate read of the deploy workflow, the environment handling, the job wiring and the Stripe and Supabase configuration, looking only for what reports three and four do not already say.

**#114 The deploy workflow's migration check probably cannot reach the database from GitHub (Blocker for the first deploy, Checked in code; the network half is a platform fact, not run).** Both deploy jobs run `apply-migration.mjs --status` first (`.github/workflows/deploy.yml:77,154`). The runner connects only to the direct host `db.<ref>.supabase.co:5432` (`scripts/lib/supabase-db.mjs:100`), which is IPv6-only unless the project has Supabase's IPv4 add-on, and GitHub's hosted runners have no IPv6. The first staging deploy would stop before the build, on every push. Either buy the IPv4 add-on on staging and production (an owner step, a few dollars a month each) or teach the runner the session pooler. `docs/staging-setup.md` warns only about the engineer's own network.

**#115 The documented set-up order cannot produce a working first deploy (High, Checked).** A hosted deployment refuses the payment stub (PR #173), so staging runs in Stripe mode, and in that mode `src/lib/env.ts:214-236` refuses to boot without both webhook secrets, the publishable key, a valid `SENTRY_DSN`, an https `ADMIN_ALERT_WEBHOOK_URL`, `CRON_SECRET` and `GUEST_RECEIPT_SECRET`. `docs/staging-setup.md` deploys in §4 and creates the webhooks, Sentry and the alert channel in §5, §8 and §9. Followed in order, the build succeeds, every request errors, and the workflow polls `/api/version` for fifteen minutes before reporting that it "still reports nothing". Do Stripe, Sentry and the alert webhook before the first deploy, and have the version step print the response it got. Related: `NEXT_PUBLIC_*` values are fixed when the runner builds, so changing one means re-running the workflow, not redeploying from the host's dashboard.

**#116 The app sends no email of its own (High, Checked).** `src/lib/email/send.ts:47` holds an empty list of providers, and the only caller of the mailer is the saved-search digest job. A seller is not emailed when a part sells; a buyer gets no receipt, dispatch, dispute or refund email. The seller's three-business-day dispatch deadline and the day-14 payout-setup refund run on in-app notices alone. Guests receive only Supabase Auth's access link. `docs/owner/email-provider.md` says the transport is empty until a provider is chosen; reports three and four did not carry it. Choosing the provider (OS id R-email) unblocks one transport and the order-lifecycle messages, which should exist before real money.

**#117 Signed photo links are remembered per server process (High for cost and speed, Checked in code; billing effect suspected).** `src/lib/supabase/photo-signing.ts:29,37` keeps its memo in process memory. On a serverless host each instance signs its own link for the same photo, so the image optimiser sees a new source per instance, per width, per hour: cache misses, billed transformations, and browser caches that miss between pages. Make the signature deterministic per time window or share the memo, and check the host plan's image quota before inviting anyone. Same subject as #105.

**#118 Photo uploads above about 4.5 MB will be refused on a serverless host (Medium, Checked in code; the limit is the platform's).** `src/app/api/media/public-photo/route.ts:29` accepts 11 MB through a function. The browser normally shrinks a photo first, but each fallback in `src/lib/media-upload.ts` sends the original, which Vercel rejects. Cap at 4 MB with clear copy, or upload direct to storage and normalise there.

**#119 A new database gets an empty vehicle catalogue and no generations, and no set-up step fills them (Medium, Checked in code; staging's rows not inspected).** The catalogue migration seeds from cache tables that are empty on a new project, and the generations migration joins to that catalogue, so it inserts nothing. `scripts/import-vehiclesdb.mjs` is not in `docs/staging-setup.md`, reads only `.env.local`, and pulls an unpinned third-party branch. Add an ordered step and pin the dataset. OS id N667.

**#120 The post-deploy version check can fail on a good deploy (Medium, Suspected).** `src/app/api/version/route.ts:36` reads `VERCEL_GIT_COMMIT_SHA ?? GIT_COMMIT_SHA`. If the host sets the first to an empty string on a command-line deploy, `??` does not fall through and the sha is empty. Use `||`; the same pattern is in `src/lib/monitoring.ts:47`.

**#121 Staging will be public, indexable and open to sign-up (Medium, Checked).** `src/app/robots.ts` allows `/` in every environment and the invite-only gate is gone. Add an environment-driven `Disallow: /` and `X-Robots-Tag` outside production; the host's own deployment protection would also block the scheduled jobs and Stripe's webhooks.

**#122 There is no rollback procedure for a hosted deploy (Medium, Checked in docs).** The runbook covers the local rehearsal only. Migrations are applied before a merge, so the previous code runs on the new schema for the length of a CI run on every merge. Document "dispatch the previous `rc-` tag"; a rollback from the host's dashboard bypasses the release gate.

**#123 Smaller items for the first deploy (Low, Checked).** `PRODUCTION_SUPABASE_DB_PASSWORD` is documented as a repository secret, readable by any workflow on any branch; make it a `production` environment secret. Sentry's environment is `NODE_ENV`, so staging and production are indistinguishable. `SUPABASE_SECRET_KEY` is not validated at boot. `src/app/(product)/profile/page.tsx:132` hard-codes `drvn.app/u/`. `docs/staging-setup.md` §7 says 19 scheduled jobs; there are 21. The public data cache is off in the browser-test stack, so staging is its first real run.

**Checked and found sound:** scheduled jobs return quietly while `job_config` is empty; the Stripe webhook reads the raw body, accepts either secret and reprocesses an event whose first pass died; the API version is pinned; payments mode fails closed; no project reference or storage host is hard-coded in `src/`; storage buckets come from migrations; the rate limiter is database-backed; there are no TODO or FIXME markers in `src/`; the agent is off by default.

---

## 6. The Intelligence OS's open list, reconciled

The OS showed 110 open items at 22:20 UTC: 33 to decide, 27 for Neil to do, 19 for counsel, 31 for an engineer. Report four counted 76. The difference is not new work. On 9 November the OS read reports three and four; findings it could not match to an item it already held became new items, including problems report three described on 7 November that were fixed on 8 November before the OS read it. Each is named here so the OS runs its check again.

**Fixed, with the pull request that fixed it**

- OS id N695 "Main has no finished green run" is fixed by #136; `main` is green at `aee656d`.
- OS id N711 "CI on main is red because of the dropped beta table" is fixed by #136.
- OS id N698 "Three merged PRs carry P1 defects fixed only in open follow-ups" is fixed by #134, #132 and #133.
- OS id N720 "Three merged PRs carry P1 defects" (the same finding read twice) is fixed by #134, #132 and #133.
- OS id N704 "Agent tool contracts sit in an open PR" is fixed by #94, merged 8 November.
- OS id N731 "Four green-pending PRs await merge" is fixed by #132, #133, #107 and #94, all merged.
- OS id N705 "Staging is 30 migrations behind main" is fixed by #162 and #167.
- OS id N722 "Staging is 30 migrations behind main" (read twice) is fixed by #162 and #167.
- OS id N713 "Staging is 30 migrations behind main and lacks job configuration" is fixed by #162 for the migrations; the job configuration half is OS id N716 and stays open there.
- OS id N729 "Staging schema is 30 migrations behind main and job_config is empty" is fixed by #162 for the schema; the `job_config` half is OS id N716.
- OS id N724 "The release-candidate script still requires the invite-only beta" is fixed by #172.
- OS id N733 "Codex queue is not committed" is fixed by #171.
- OS id N726 "Renamed migrations mean filename order is not apply order" is fixed by #169.
- OS id N727 "The crosswalk cites a test that is not on main" is fixed by #170 and #103.
- OS id N719 "Stale-green pull requests are merged without rerunning checks on current main" is fixed by #179: the ruleset requires a branch level with `main`.
- OS id N908 "Duplicate guard-fix pull request should be closed" is fixed by #135 itself merging on 8 November.
- OS id N909 "Review docs PR marking B1 fixed is unmerged" is fixed: PR #67 was closed as superseded on 8 November.
- OS id R-guest "The beta gate refuses guest buyers" is fixed by #126.
- OS id R-protect "Choose public repo or GitHub Pro, then protect main" is fixed by #179: the repository is public and the `protect-main` ruleset is live. The OS reads the older branch-protection address, which answers 404 for a ruleset.

**The same thing held twice**

- OS id N846 is the same item as OS id N735 (the remediation plan's defaults await confirmation).
- OS id N756 and OS id N823 are the same item as OS id N734 (a live account deletion on staging).
- OS id N728 is the same item as OS id R86 (the design files in the shared checkout).
- OS id N707 is part of OS id N735: keeping the 18+ confirmation and the takedown route is one of the applied defaults (`docs/decisions/age-confirmation-and-takedown.md`).
- OS id N803 is part of OS id R-stripe (webhook endpoints are a step of the Stripe set-up).

**Still true, and small**

- OS id N725: the Codex queue is in the repository now; the debt it tracks is 31 owed reviews.
- OS id N714: `package.json` declares `next ^16.3.8` while the lockfile pins 16.4.3. A one-line change.
- OS id N694: by design; close as accepted.
- OS id N706 "Code needs about a week of stabilisation": `main` has been green for two days with one merge; the remaining stabilisation is the staging soak, OS id R-unproven.
- OS id N715, OS id N717 and OS id N718 were not re-traced today.

With those settled the OS's list is about 86 items: roughly 31 decisions, 26 owner set-up steps, 19 for counsel and 10 for an engineer, and eight of the engineer's ten wait on a hosted environment.

---

## 7. What stands between this codebase and a real product

Unchanged from report four section 7 in every row; nothing in it was started on 9 November. The short form, by the item that holds each group:

| Holds | OS id | What waits behind it |
|---|---|---|
| Hosting account, domain, GitHub environments | OS id R-hosting | The first deploy, Auth URLs, both Stripe webhooks, wallet registration, the monitor, every staging proof |
| Legal entity, market and currency | OS id R-entity, OS id R-market | Counsel's packet, the Stripe account's country, the copyright agent, tax (OS id R-merchant), the 19 counsel items |
| Email provider | OS id R-email | Sign-up and reset email, the email test run (OS id N675) |
| Stripe in test mode on the real domain | OS id R-stripe | The nine money scenarios (OS id R-unproven), wallets (OS id R-devices) |
| Sentry, alert webhook, uptime check | OS id R-sentry, OS id N533 | The alerts loop, the monitor (#104) |
| Production database with point-in-time recovery | OS id R-prod, OS id N663 | The restore drill, the 15-gate packet (OS id R-gates), one real transaction |
| Whether the agent is in the first beta | OS id R-agent-decision | The Anthropic key, zero data retention, counsel's agent clauses, OS id R75 |
| Counsel | OS id R-counsel | Terms and privacy leaving draft; the retention schedule (OS id R-retention) |

---

## 8. Suggested order of work

**Neil. Each step unblocks the next; times are hands-on time.**

1. **One sitting of decisions, about 45 minutes.** The twelve shared-dev history rows (OS id N786; recommended: document and close by hand). The remediation plan's decisions table, where "yes to all defaults" is a valid answer (OS id N735). Whether the agent is in the first beta (OS id R-agent-decision; recommended: no, open it two to four weeks after launch). Which email provider (OS id R-email).
2. **Entity, market and currency, then send counsel the packet** (OS id R-entity, OS id R-market, OS id R-counsel). Thirty minutes to send, weeks to return: it is the longest wait, so it goes first among the real-world steps.
3. **Hosting account, domain, and the two GitHub environments** (OS id R-hosting). About two hours. Turn on Supabase's IPv4 add-on for staging (#114). Run `gh auth refresh -s workflow` once (#111). Do not switch `DRVN_DEPLOY_STAGING` on yet: the app cannot boot until step 5's secrets exist (#115).
4. **Email provider's DNS records** (a day to settle), then SMTP and the four templates in Supabase Auth, and the Auth security settings (OS id N662, OS id N451, OS id N441).
5. **Stripe test mode with Connect, Sentry, an alert webhook, and an uptime service that pages a phone and calls the worker monitor** (OS id R-stripe, OS id R-sentry, OS id N533, #104). About three hours. Then the secrets and variables at the top of `.github/workflows/deploy.yml`, and `DRVN_DEPLOY_STAGING = true`: the first deploy follows on the next green push.
6. **Production database with point-in-time recovery** (OS id R-prod, OS id N663). One hour.
7. **Clear the design files from the shared checkout** (OS id R86); they are safe on `design/concepts-2026-10`.

**Engineer, now.**

8. Before the first deploy: the pooler or add-on route for the migration check (#114), the set-up guide's order (#115), the version check (#120), staging kept out of search engines (#121), the catalogue step (#119). Then the order emails once the provider is chosen (#116), and photo signing shared across instances (#117).
9. Codex reviews of PR #178, #181, #175 and #176 first, then the rest of the 31 (OS id N725, #105).
10. The deletion operator runbook and an admin control for a stuck chargeback entry (#106, #108).
11. The saved-search and takedown findings (#109); `package.json`'s `next` range (OS id N714); delete the 120 merged remote branches.

**Engineer, once step 3 is done.**

12. First staging deploy and the items in section 5; staging `job_config` rows (OS id N716); first admin enrolment (OS id N666).
13. The nine money scenarios, the live deletion (OS id N734), wallets on real phones, the alerts loop, then the seven-day soak (OS id R-unproven).
14. Hosted restore drill, production data (OS id N667), the 15-gate packet (OS id R-gates), counsel's edits, one real transaction (OS id R-prod).

---

## 9. Method and sources

- Code and migrations on `main` at `aee656d`; GitHub pull request, run, artifact, environment and variable data at 22:00–22:40 UTC on 9 November. The test-result, browser-summary and release-gate artifacts of run 42584172289 were downloaded and counted.
- Read-only probes: shared dev through the migration runner's `--status`; staging through the read-only role; `npm audit --omit=dev`.
- Six sessions were asked what they know and answered in writing: the session that wrote report four, the remediation executor, the blockers and CI session, and three Intelligence OS sessions. Their statements are marked Reported unless re-traced.
- The Intelligence OS Blockers list at 22:20 UTC, each suspect item checked against GitHub.
- A separate read of the deploy path (section 5).
- The owner outline of 8 November and `docs/owner/README.md` for section 8.

# Remediation record: November 2026

The running record of `docs/plans/2026-11-remediation-plan.md` (the plan). Started 8 November 2026 from `main` at `e0e696c`. One row per plan item: the PR that did it, its merge commit, and where it stands. Under the table: the defaults applied from the plan's decisions table, judgement calls, what needs Neil, and what is blocked and why. This file is a `docs/plans/` file, so the Intelligence OS does not read it as a report. The OS credits work through the ids in merged PR titles and `Resolves:` lines.

**Needs Neil stays current.** The Intelligence OS shows every bullet under a "Needs Neil" heading in this file to Neil on Today. Whenever this file is edited, every such bullet is checked again, and one that is done or no longer true is removed in that same edit.

Status words: **merged** (on `main`, CI green) · **open** (PR up, merged by hand once every check is green on a branch level with `main`) · **owner** (Neil's to do; prepared work listed) · **on hold** (waiting on a ruling).

## Items

| Item | Ids | PR | Merge commit | Status |
|---|---|---|---|---|
| Staging and shared dev catch-up | R-staging-behind | #167 | `72ec871` | merged: `20261107220500`–`220520` (#149) applied to both, `20261108140000` (#166) to staging |
| A1 approval guard | OS-W36 N677 (N676) | #168, #180 | `1b8080c`, `f22754f` | merged; #180 is Codex's FAIL 7 null-safety fix and a fixed mangled id in FAIL 0. Cause: card redaction mangled ~0.3% of random UUIDs (fixed by #158), not ordering. FAIL 0 now sweeps 5,000 ids; sql-guard passed 3 times on the PR |
| A2 strict status checks | (owner) | — | — | done by the orchestrator at Neil's go-ahead: `protect-main` ruleset id `26808907`, strict on; `docs/owner/branch-protection.md` records it |
| A3 Codex queue file | #95 | #171 | `2f68c91` | merged: 106 rows. Reviews run rationed: #149, #159, #162, #166, #168, #172 done 8 Nov (findings in `docs/review-evidence/2026-11-08-codex-post-merge-review.md`, OS N690–N694); the rest stay owed in the queue |
| A4 inventory families | OS-W36 N680 | #168 | `1b8080c` | merged |
| A5 crosswalk test | #98 | #170 | `4a53c25` | merged (the missing test arrived with #103) |
| A6 migration order test | #97 | #169 | `d2c09f8` | merged |
| A7 stale PRs | R53-pr, #67, #98 #100 #101 #103 | #98 #100 #101 #103 | `5dc3ec6` `3f575d7` `6ae3d46` `224fd7b` | merged; #67 closed as superseded; #53 left open (see Blocked) |
| A8 design files | #99, R86 | branch `design/concepts-2026-10` | `ea105f7` | pushed (251 files, 226 MB); the shared checkout is untouched (see Needs Neil) |
| B1 shared-dev history gaps | #91, R-migrations | #167 | `72ec871` | on hold: per-file reasons and evidence written in `supabase/MIGRATIONS.md`; no `--attest` mode while Neil rules |
| B2 staging-level rule | OS-W37 R-staging-behind | #172 | `1ffd7bc` | merged |
| B3 release-candidate script | OS-W37 R-rcconfig | #172 | `1ffd7bc` | merged |
| B4 production target | (prep for D4) | — | — | owner: waits for the production project |
| C1 deletion proof on staging | B7 N418 N439 N442 | — | — | owner: waits for D3 |
| Codex findings on #149 (deletion scrub) | OS-W34 N418 N690 N691 N692 N693 | #181 | `7b71ce5` | merged: a scrubbed member is never reinstated (late holds go to an operator), other members' notifications lose a deleted member's words, a per-handle lock closes the tombstone race, and retained cases from before #149 were requeued once. `20261108180000` applied to shared dev and staging before merge |
| C2 transfer recovery | N499 | #176 | `c7dad28` | merged: already fixed by #91; adds N499 tests, corrects the crosswalk |
| C3 deploy gating | N528 | #175 | `c55bf60` | merged, with D2 |
| C4 private-car and draft photos | OS-W38 N455 | #178 (#177 closed, branch deleted) | `3698591` | merged; `20261108160000` applied after the merge to shared dev then staging (below); the account export links photos for seven days |
| C5 18+ backfill prompt | OS-W38 N686 | #174 | `7e9ed2c` | merged; `20261108150000` applied to shared dev and staging |
| C6 Supabase Auth settings | N451 N441 N662 | — | — | owner (rows ready in `docs/release-evidence/infrastructure.md`, #175) |
| C7 stub-override boot assertion | OS-W38 N540 | #173 | `80dbc11` | merged |
| C8 infrastructure evidence file | OS-W39 N224 | #175 | `c55bf60` | merged |
| D2 deploy pipeline | OS-W39 N634 N528 | #175 | `c55bf60` | merged (the workflow file merged without extra token scope) |
| D1, D3–D7, D-mail | | | | owner |
| E1–E7 | | | | owner |
| F1–F6 | | | | owner and counsel |
| G1–G2 | | | | owner |
| H | | | | owner (decisions) |

### Migrations applied by this work

| File | PR | Shared dev | Staging |
|---|---|---|---|
| `20261107220500_username_rules.sql` | #149 | 2026-11-08 (runner, `--pr 149`) | 2026-11-08 (runner, `--pr 149`) |
| `20261107220510_account_deletion_scrub.sql` | #149 | 2026-11-08 | 2026-11-08 |
| `20261107220520_deletion_storage_message_photos.sql` | #149 | 2026-11-08 | 2026-11-08 |
| `20261108140000_chargeback_holds_deletion.sql` | #166 | already applied | 2026-11-08 (runner, `--pr 166`) |
| `20261108150000_age_confirmation_returning_members.sql` | #174 | 2026-11-08 (runner, `--pr 174`) | 2026-11-08 (runner, `--pr 174`) |
| `20261108160000_member_photos_private.sql` | #178 | 2026-11-08, after the merge (runner, `--pr 178`) | 2026-11-08 (runner, `--pr 178`) |
| `20261108180000_deletion_late_holds_and_previews.sql` | #181 | 2026-11-08 (runner, `--pr 181`) | 2026-11-08 (runner, `--pr 181`) |

`private.username_audit` holds no rows on either project after `220500`.

**C4's order was the reverse of the usual rule, and was followed:** #178 merged (`3698591`); then the shared checkout, whose `main` had two local commits (#67's, preserved on `origin/docs/readiness-2026-11-03`; its HEAD before was `a99ee54`) and was 436 commits behind, was moved with `git reset --keep origin/main` (local modifications kept). One untracked file in the way, an older draft of `docs/plans/2026-11-blockers-resolution.md` identical to commit `d5a7b78`'s copy, was moved aside to the executor's scratchpad. `npm ci` ran, the :3005 dev server was restarted (`cc.drvn2.dev`), and a public car page was checked to carry `/object/sign/car-images/` URLs. Only then was `20261108160000` applied to shared dev; a signed photo loaded (200), and an uncached object's public URL answered 400. A previously cached one still answered 200 from Supabase's CDN, the known TTL caveat. Staging came next; its `--status` lists nothing missing.

### Early merges while `main` had no protection

On 8 November, from about 18:45 to 18:54 UTC, `main` had no ruleset, so `gh pr merge --auto` merged at once: #167, #98, #100, #101, #103 (verify, sql-guard and secrets had passed; e2e had not finished) and #169 (nothing had finished). All were docs or tests, green locally. The main run that proves them is **42512274085** on `d2c09f8`, which finished green on every job. Since then every merge is by hand, after every check is green on a branch level with `main`.

### A stray branch can turn every history scan red

CI's `secrets-full` lane scans every reachable ref (`git log --all`), not just `main` and the PR. On 8 November, #177's first commit carried a JWT-shaped test fixture that gitleaks' generic-api-key rule flags. #177 was closed and replaced by #178 (one clean commit), but its branch `fix/os-w38-private-photos` stayed on the remote. That turned `secrets-full` red on every PR and on `main` at `1b8080c` until the branch was deleted. **Rule:** when a closed PR's history holds a false positive, delete its branch. Main's failed jobs were rerun rather than fixed forward.

**Follow-up, considered and not built:** scoping the history lane to `main` plus the PR head would stop a stray branch failing every run. But in a public repository every pushed branch is public, so a real secret on any branch is exposed, and `--all` is the right coverage. The safe variant is a narrow `.gitleaks.toml` allowlist for `token=` fixtures in `src/**/*.test.ts`. The executor recommends neither for now: test fixtures should use plainly fake tokens (`not-a-real-token`), and a closed PR whose history holds a false positive gets its branch deleted.

## Defaults applied

From the plan's decisions table, applied by the executor without asking (Neil asked for the work to go ahead on the recommended defaults):

- **The 15th gate (#94):** "guest hold caps" replaces "invitation boundaries" (#172).
- **Design-concept files (#99):** committed to `design/concepts-2026-10` (pushed, `ea105f7`).
- **Keep 18+ confirmation and copyright takedown (R69-age, R69-dmca):** kept, with earlier members asked once at next sign-in (#174, `docs/decisions/age-confirmation-and-takedown.md`).
- **Private-car and draft photos (N455):** fix: private buckets with signed URLs (#178), using the cheaper sign-at-read design the orchestrator chose. Move-on-publish is deferred as the scale answer.
- **Release configuration (R-rcconfig):** the candidate config declares `guestCheckout: "capped"`; shipping, search and analytics stay explicit decisions in the config (#172).

## Judgement calls (recorded so they can be reversed)

- **A1:** the plan suspected an ordering race; the cause was card-number redaction corrupting ids (fixed by #158). The guard now proves the fix on 5,000 random ids instead of rerunning 30 times.
- **A8:** the brief's temp-index recipe would have committed a tree holding only `design-mockups/`, which reads as deleting everything else. The index was seeded from `origin/main` (`git read-tree`) first, and `design-mockups/README.md` kept `main`'s newer copy.
- **B1:** the per-file lines are written; `--attest` is not built (on hold for Neil).
- **B2:** a session that cannot reach staging lists the file in `supabase/migrations-staging-pending.json` with a reason, rather than CI failing outright.
- **C2:** the plan's "replay the create with the same idempotency key" is not built. Stripe keeps a key for about 24 hours, so a replay after a longer outage would pay the seller twice; the scoped complete search (#91) is safe at any age.
- **C4:** signing happens once at the database boundary (where row policies have already filtered), not at about 60 render sites; the orchestrator accepted it. The account export now links photos for seven days. The Supabase CDN may serve a cached public copy of a photo for up to its TTL after the flip. The signing memo is per process, so a multi-instance host mints its own URL per instance, which is harmless.
- **C5:** "earlier members" means accounts created before #117 merged (2026-11-08 02:03:15 UTC), so service-made accounts (e2e fixtures) are never asked.
- **C7:** the boot check refuses the override on any hosted deployment (Vercel, a public https site URL or a live key), whatever the payment mode, while CI's loopback browser suite keeps it.
- **D2:** both deploy jobs refuse and name a missing migration instead of applying it. Since #143 the merging session applies migrations before merge, and a deploy job holding a DDL-capable password widens the blast radius.

## Needs Neil

One line each: what to do and where.

- **Shared checkout clean-up (A8):** the concept files are safe on `design/concepts-2026-10`. When you're happy, remove the untracked `design-mockups/` files from the shared checkout (or tell a session to); nothing was deleted there. Before anything from that branch reaches `main`, review the 226 MB of mp4, glb and bin files.
- **B1 ruling:** choose between an attested-row runner mode and documenting the twelve gaps and closing R-migrations by hand. The per-file reasons and evidence are in `supabase/MIGRATIONS.md`.
- **D2 setup:** create the GitHub environments `staging` and `production` before the first run, staging restricted to branch `main` and production to `main` plus the tag pattern `rc-*` (production with you as required reviewer); put the secrets in as environment secrets, not repository secrets (`docs/staging-setup.md` §11.4); make the hosting projects from the terminal without importing the repository, with automatic Git deploys off (§4.1); add the variables listed at the top of `.github/workflows/deploy.yml`. Then set `DRVN_DEPLOY_STAGING = true`.
- **The rest of workstreams D–H:** as the plan lists them: hosting and domain, email provider, Stripe Connect, Sentry, alerts, uptime and monitor variables, the production project with PITR, the entity and market, counsel, and the agent ruling. Each has a row to date in `docs/release-evidence/infrastructure.md`.

## Blocked

- **N694 (#172's Codex finding):** older prose rows sit outside the two-day staging rule. Recorded only, by design: all 120 are in the frozen baseline and on staging.
- **#53 design docs reconcile (A7):** 82 files, conflicting with `main` since October, touching components that have changed since. Resolving it is a design session of its own; the brand assets (favicon, icons, manifest, OG cards in `src/lib/og/card.tsx`) are the part worth splitting out. Left open.

---

# Plan 1 record: finish and fix (work review of 10 November 2026)

The running record of `docs/plans/2026-11-work-review-remediation-plan.md`, kept by the plan 1 building session. Started 10 November 2026 from `main` at `58b4ad7` (merge of #201). Neil approved the plan and decisions D1 to D6 on 10 November. Every pull request here is reviewed by the orchestrating session before it merges and before its migration reaches shared dev or staging (rules R1 to R7 in the plan). The plain-language work log is https://claude.ai/artifact/LAtUiGKYfLQnvCj5doebFU.

Status words: **merged** (on `main`, CI green) · **in review** (PR up, waiting for the orchestrator or for checks) · **set aside** (a recorded decision) · **not started**.

## Plan 1 items

| Step | Findings | Ids | PR | Merge commit | Status |
|---|---|---|---|---|---|
| 0 / 3.4 Codex reviews waived | `#129` | N725 | #214 | `029c29e` | merged 10 Nov: every owed row waived by Neil's ruling; `tests/ci/codex-queue.test.ts` accepts `waived` and refuses `owed` |
| 1 Working rules written down | `#125` to `#128`, `#163` | N1038, N1039, N1040, N1042, N1079 | #221 | `5ada2e0` | merged 10 Nov: R1 to R3 in `supabase/MIGRATIONS.md`, R5 and R6 in the pull-request template |
| 2.1 Deletion runbook and Resume | `#125`, `#126`, `#154`, `#157` | N944, N734, N1038, N1039, N1070, N1073 | #198; #246 | `ac81388` (batch 2, #230); `6d12b0f` (#246, batch 8, #248) | merged 10 Nov: the D6 named exception in `tests/ci/migration-order.test.ts`, two guards that no longer pass on any error, runbook §5d "What the console cannot finish". Its migration `20261110110000` was already on both databases. **Follow-up #246, merged 10 Nov (batch 8):** `public.admin_resume_account_deletion` takes the acting admin and calls `assert_admin_actor` before it reads anything; the two-argument function is dropped. Its migration `20261111080000` was applied to shared dev, then staging, with `--pr 246` immediately before the merge (`main`'s console called the two-argument function); each printed its PASS line, and afterwards only the three-argument function exists on either database and a member cannot execute it |
| 2.2 18+ for earlier members | `#152` | N662, N686, N1068 | #201 merged as written (`58b4ad7`); #217 closed unmerged; #222 | `ac81388` (batch 2, #230) | **removed by ruling (Neil, 10 November 2026)**; #222 merged 10 Nov. Migration `20261110131000` was applied to shared dev, then staging, at 16:54 UTC, immediately before the batch merged; both applies passed their self-checks |
| 2.3 Upload size | `#158` | N955, N1074 | #203; #234 | `ac81388` (#203, batch 2); `481e23d` (#234, batch 3, #235) | merged 10 Nov: a second shrink method and tests of the server's 413 (#203, N955); a profile photo is always shrunk to an avatar's size before upload (#234, N1074) |
| 2.4 Staging out of search | `#156`, `#144` | N958, N961, N1060 | #188 | `481e23d` (batch 3, #235) | merged 10 Nov: no sitemap and a no-index answer off production, checked after every deploy; one reading of "hosted" with two named questions over it |
| 2.5 Set-up order | `#156` | N952, N960, N964, N1072 | #190 | `481e23d` (batch 3, #235) | merged 10 Nov: the owner's steps in an order that can be done; the Vercel project and the GitHub environment steps written out |
| 2.6 Protection watch, and its follow-up | `#156`, `#139` | N949, N950, N1055 | #195 | `481e23d` (batch 3, #235) | merged 10 Nov: the watch judges the commit that was pushed; a production deploy is refused unless its environment is restricted. Its first run on `main`, on the batch's own merge commit, completed green. No alert is sent until `ADMIN_ALERT_WEBHOOK_URL` is set |
| 2.7 Photo signing rules | `#131`, `#146` | N940, N1062 | #210 | `ca28519` (batch 4, #237) | merged 10 Nov. Photos are signed only at places the database guards; a readiness check that could not be made leaves the last answer standing; an account export is never written while signing is off. Migration `20261110190000` applied to shared dev, then staging, at 17:56 UTC, immediately before the merge. **The one-time clean-up moved one reference on shared dev and none on staging:** `private.photo_refs_quarantined` id `1`, the cover of car `f4f7be69-f37a-451c-bb97-b698ff867fec` (it pointed at an object in another member's folder), kept until 8 February 2027; `private.restore_quarantined_photo_ref(1)` puts it back. After the merge a public car page and a listing page showed every photo signed and loading |
| 2.8 1,000-row limits | `#155` | N718 | #199 | `232be20` (batch 5, #240) | merged 10 Nov. The four reads left on `main` read every row; `tests/ci/unbounded-reads.test.ts` holds reads with no stated bound to a baseline that only goes down (144 in 62 files); the copyright blocklist is one lookup per object; the console's open operations are one database function. Migration `20261110210000` (one function, one partial index) applied to shared dev, then staging, at 18:39 UTC, immediately before the merge |
| 2.9 A deleted member's words | `#153` | N1069 | #206 | `960443d` (batch 6, #243) | merged 10 Nov. Every notification kind says whose words it carries, and an unknown kind is scrubbed as a member's; saved-search emails and saved-search notices lose a leaver's listing titles. It was sent back once in review: its new trigger on `public.notifications` was not `SECURITY DEFINER` and called a function in schema `private`, so every notification the app writes with the server key would have failed; found on a scratch Postgres, before anything was applied. Migration `20261110220000` applied to shared dev and staging on 10 Nov with `--pr 206`; its one-time repair found nothing to change on either (six zeros, as a read-only count taken first had predicted: no account has been deleted on either database) |
| 2.10 Chargeback retry | `#148` | N944, N1064 | #208 | `05ac7d0` (batch 7, #245) | merged 10 Nov. Retry replays in one transaction with the reopen, the basket is checked on every replay, a closed case opens again when the chargeback is held again, and a chargeback held from an unknown state is not retryable. Migration `20261110230000` applied to shared dev and staging on 10 Nov with `--pr 208`; no card dispute exists on either database, so it had no row to rewrite |
| 2.11 Order emails | `#147` | N1063 | #204 | `68adf30` (batch 9, #249) | merged 10 Nov, approved at `c691177e` after a second round; one merge of `main` before the batch settled only `supabase/MIGRATIONS.md` and the generated build-info file. First round: a fault with our own provider account drops nothing and alerts; a failed email is said, with its order; the time sets the batch; three new messages (cancelled, part-refunded, the dispatch date); a lost card dispute is not called a refund; settled rows are pruned. Second round, five changes in the email layer and its tests, none in the money path: every waiting row is kept 72 hours while a provider fault stands, not only the one that was tried; the seller of an order whose buyer's account is gone is still emailed; an order with no seller cannot stop the dispatch reminders; a rate limit does not count as one of an email's five attempts, and sends are spaced 550 ms apart; three tests that could not fail were rewritten. Its three new notice kinds are listed in #206's classification. Migration `20261111090000` applied to shared dev, then staging, with `--pr 204` immediately before the merge; each printed `PASS: 20261111090000 self-checks`. A read-only count taken first found no outbox table and no paid, unshipped order within a day of its dispatch date on either database, so the first dispatch-reminder run reaches no one. Without an email provider no email is sent, but its three new in-app notices are written whatever that setting is |
| 2.12 Chargeback write-off | `#149` | N944, N1065 | #207 | | set aside until after launch (decision D1): a draft since 10 Nov, with what it needs when it returns |
| 2.13 Copyright counter-notice | `#150` | N1066 | #209; #225 | `76a209a` (#225, in batch 1) | set aside until after launch (decision D2): a draft since 10 Nov; the by-hand procedure is runbook §5e, merged 10 Nov |
| Duplicate test fix | `#124` | | #211 | | closed: the fix merged with #200 |
| 3.1 Photos on `main` | `#132`, `#135`, `#136`, `#137` | N1048, N1051, N1052, N1053 | #244 | `68adf30` (batch 9, #249) | merged 10 Nov, approved at `9b79b572` after a second round, with one clean merge of `main` before the batch. No migration. A listing's share image is a generated card, as builds and posts have; the signer is an object given its clock and its client; a response waits at most 2.5 seconds for the photo store; a scan catches a service-role client reading photos unsigned, followed into the functions it is handed to, and an unsigned photo reaching a page is reported. The review sent it back with ten changes, all made: the pause after a failure is per bucket and starts at two seconds, a slow answer is kept for the next response, and links that still open stand in; an export page is written only when the store answered; the browser report sends no path and has a ceiling across visitors; the sign-in backdrop no longer uses the framework's cache, which serves a stale entry at any age when its refresh fails; a reserved listing's card is the whole card. From the review of #210: the public data cache is shown to keep only the database's own answer, and the 30 photo reads that do not carry their owner are held by a ratchet |
| 3.2 The deploy path | `#138`, `#140`, `#142`, `#143`, `#144` | N1054, N1056, N1058, N1059, N1060; N715, N962, N957, N714, N634 | #218, #219 | `76a209a` (batch 1, #228) | merged 10 Nov: admin gate on every console path, key kinds at boot, one commit-sha rule that prefers the workflow's sha, patched ranges, rollback caveats, and `--status` through a read-only login. N1060 (`#144`) closed with #188, which gives the single reading of "hosted" |
| 3.3 Data set-up | `#141`, `#145` | N667, N1061, N943 | #220; #233 | `76a209a` (batch 1, #228); `481e23d` (#233, batch 3) | merged 10 Nov. Staging import run 10 Nov 16:16 UTC from merged code: 315 makes, 5,541 models, 175 of 194 curated generations; recorded in `docs/release-evidence/infrastructure.md` |
| Fixed-date sweep | `#124`, `#163` | | none needed | | done 10 Nov: every unit test under `src` passes with the clock 400 days and five years ahead |
| The table the OS reads | plan step 4.8 | | #223 | `76a209a` (batch 1, #228) | merged 10 Nov: format in `docs/ids.md`, check in `tests/ci/os-report-table.test.ts`, on the OS's own file pattern |

## Plan 1: needs Neil

## Plan 1: judgement calls

- **Step 0:** an `owed` row is now refused by the test, not only tolerated, so a later pull request cannot quietly restart the debt the ruling ended. A docs-only pull request stays `skipped`. Thirteen merged pull requests that had no row (#182 to #205) were given one.
- **Step 2.2, Neil's ruling of 10 November 2026:** "regarding the 18+ confirmation work....all current accounts are test accounts and not real users so this work doesn't matter and addressing it seems to be adding unecessary code, decide how this should be addressed in terms of code removal and send the work to the appropriate agent". Decision taken on that instruction: keep the requirement where a new person joins (the 18+ box at sign-up, onboarding and guest checkout, the table, and the database's refusal of a handle without a record) and remove everything that chased accounts from before 8 November (the sign-in redirect of #174, the page-request check of #201, `/confirm-age`, `public.my_age_confirmation_due()`). No real member can be an earlier member: production does not exist and every new account answers on the way in. Finding `#152` is settled by #222, not by the fix the plan listed; #217, which implemented that fix, was closed unmerged.
- **Step 3.3, the three Volkswagen trims:** on a database filled only from the pinned VehiclesDB release, the curated generations for `Golf GTI`, `GTI` and `Golf R` (19 of 194) have no catalogue model to attach to, because VehiclesDB files them under `Golf`. Nothing was added to the catalogue. A GTI is entered as a Golf and resolves its generation. Revisit with real use.
- **Step 3.2, the deploy's read-only login:** `deploy_reader` was not created on staging. It is five statements in the owner's set-up guide and has no secret to live in until the GitHub environments exist; it swaps two secrets on his list for two, adding none.
- **Finding `#157`, one more guard than the plan names:** the takedown guard that merged with #200 had the same `when others then null` as #198's; both are fixed in #198's pull request, because it is one finding.
- **How changes land, from 10 November 16:00 UTC (the orchestrating session's decision):** approved pull requests merge in batches. A batch branch is cut from `main`, each member's approved head is merged with `--no-ff` (never rebased or squashed, so GitHub marks the member merged), the checks run once on the combination, and the orchestrating session verifies the batch holds exactly what it approved. At most one member with a migration to apply, merged last, applied to shared dev then staging once the batch is green and immediately before the merge. Batch 1 was #228 (`76a209a`): #225, #218, #220, #223, #219, and plan 2's #216 and #224. Batch 2 was #230 (`ac81388`): #203, #198, #222. Batch 3 was #235 (`481e23d`): #233, #234, #188, #195, #190. Batch 4 was #237 (`ca28519`): #210, with its migration. Batch 5 was #240 (`232be20`): #238 and #199, with #199's migration. Batch 6 was #243 (`960443d`): #206, with its migration. Batch 7 was #245 (`05ac7d0`): #241 and #208, with #208's migration. Batch 8 was #248 (`6d12b0f`): #246, with its migration. Batch 9 was #249 (`68adf30`): #247, #244 and #204, with #204's migration.
- **Rule R4, as clarified on 10 November:** merge when the pull request is level with `main` and every check is green on its head; do not wait for `main`'s own run of the previous merge, which tests the same tree. If any run on `main` completes red, stop merging and tell the orchestrating session.
- **Batches, what was learned on 10 November:**
  - A member whose own line is `Resolves: none` and that changes a test file cannot ride in a batch whose line names ids: the id check then asks that member's tests to name one. Batch 2 was first built with plan 2's #227 in it and failed `verify` for that; it was rebuilt without it. Plan 2's members with tests and no OS id travel in their own `Resolves: none` batch.
  - Before every batch push, `tests/ci/test-ids.test.ts` and `tests/ci/pr-resolves.test.ts` are run locally with the batch's real title and description as `PR_TITLE` and `PR_BODY`.
  - The `MIGRATIONS.md` cell for the batch's one migration is written in the batch ahead of the apply, so `main` only ever receives it after both applies succeeded. If either apply fails the batch is not merged and the cell is corrected.
  - A member changed after its approval leaves the batch until it is approved again. A pull request that no check run starts on is closed and reopened; an empty commit is never pushed to an approved head.
  - Once the orchestrating session has approved a batch at a head, and that head is green and level, either session may merge it and tells the other. A batch with a migration is merged only by the session that applies it.
  - A cancelled run on `main` is neither a red run nor proof. Merging stops if a run on `main` completes with a failure, or if no run on `main` has completed green for three merges in a row.
- **Step 2.7, how long a "ready" answer is kept:** with no upper bound. A check that cannot be made (a timeout, an outage) changes nothing; only the database saying no, or the function being gone (`PGRST202`, `42883`), stops the signing. A bound would bring the blackout back exactly when the database is slow, and the guards disappear only by a migration. Accepted in review. The other side of it: an account export fails and is retried on a database without the migration, so "migration before code" is a hard requirement for exports.
- **Step 2.8, the ratchet is broader than "reads used as counts":** it counts every read with no stated bound, because whether a read is used as a count cannot be told from the source. Most of the 144 in the baseline are bounded in practice by a parent row. They are not hand-marked; the number may only go down. A filter on `id` counts as a bound. Accepted in review.
- **Step 2.8, groups of 100 ids:** an `.in()` filter carries at most 100 ids. 200 uuids made a request of about 7,800 characters, on the 8 KB request-line limit many gateways default to, and nothing proved the hosted gateway takes it. A test holds a group's URL under 4,500 characters.
- **Step 2.9, found while classifying:** the in-app saved-search notice carries other members' listing titles with no actor and no link to the listing, which no earlier scrub rule could reach. It is fixed in #206 by matching the leaver's exact listing title. The strict check on notification kinds runs in the SQL guards only; the browser suite's database is prepared over the REST API, which cannot set a database setting.
- **A new trigger is proven as the roles that write, not only as the owner:** any new or restated trigger is proven once as `service_role` and once as a member, because a trigger function runs as the role that writes the row. The owner can reach schema `private`; the server key cannot. And the proof is the first write to that table in its own transaction: PL/pgSQL checks a called function's permission once per transaction, so a write by another role after the owner's fixtures is not checked (this is how #206's first guard case passed against the fault).
- **Reading the counts before an apply:** the migration runner's dry run does not execute the SQL, so it prints no counts and no NOTICE; nobody should expect one from it. In batch 4 The count was taken read-only immediately before each apply (one `select` that mirrors `private.photo_ref_candidates()`), and the applied result was read afterwards.
- **A conflict in a batch where both sides hold the same row (the orchestrator's rule, batch 7):** when one side's row is the newer state of the other's, the newer row is kept once and the orchestrator is told which. In batch 7 that was four rows of the table the OS reads (`#1-H1` to `#1-H4`), which plan 2's #242 and plan 1's #241 had both carried. Anything else that is not "both sides kept whole" is still a stop.
- **A migration whose drop breaks `main`'s code is applied immediately before its merge** (#222's order, used again for #246): `main`'s Resume deletion calls the two-argument function #246 drops.
- **The count before the apply is the prediction** (batches 4 to 7): the runner's dry run prints no counts, so a read-only count is taken on each database first and the migration's own NOTICE is read against it; a difference stops the apply before staging.
- **Rule R3, sharpened on 10 November:** an unapplied migration is re-dated as soon as a later-dated file reaches `main`, not only when it is next to merge. Once `20261110190000` was on `main`, `tests/ci/migration-order.test.ts` failed every branch still carrying an earlier unapplied file, so #206, #208 and #204 were re-dated at once (`…220000`, `…230000`, `20261111090000`), in the order they are expected to land. A re-date is a rename plus the mentions that follow from it, and needs no second review.
- **The trigger check, in the reviewer's words:** the role under test must make the first write to the table in its transaction, or the check proves nothing.
- **Two older items part-done by #199, and what remains of each:** N946 (the four Codex findings on the copyright takedown) had three fixed on `main` by #200 (a reserved listing cannot return; media cannot be reattached before clean-up; a browser test serves and caches the image, then sees it refused) and its fourth, the 1,000-row read, fixed by #199: nothing remains. N1067 had its 1,000-row half fixed by #199. What remains: a taken-down photo can be uploaded again as a new file, because the block is by storage path and nothing compares contents. Blocking by content needs a ruling as well as a change, since a successful counter-notice must still get through; it stays open and is reported to Neil next to decision D2.
- **N909, the old pull request #67:** its three documents were already on `main` from #68. The one edit only #67 held, marking B1 as fixed by #65 in the 3 November report, had not been carried over, so that report still told a reader B1 was open; the seven lines are carried over in the pull request that adds this line.
- **Needs Neil, format:** every line under "Plan 1: needs Neil" is a bullet of the form `- **short name:** one sentence`, which is the shape the Intelligence OS reads. The section is empty when nothing needs him.

## Plan 1: not verifiable before a host exists

- **The deploy's indexing check** (`scripts/deploy.mjs`, #188) reads the deployed site's own answers with `redirect: 'manual'`; it has only been run against a local server.
- **Image latency from the blocklist lookup** (#199): one indexed read per distinct photo per 15 seconds per instance is added to optimised-image requests. Measure it on staging once staging is hosted.
- **The request size the hosted gateway accepts** (#199): groups of 100 ids keep a request under 4,500 characters; no real request has been sent through the hosted gateway.
- **The protection watch's alert** (#195): it has nowhere to send one until `ADMIN_ALERT_WEBHOOK_URL` is set.
- **A real order email** (#204): no provider is chosen (R-email), so no send has been made. On the first one: how the provider treats a repeated idempotency key with a changed body, and what its rate limit is (the drain spaces sends 550 ms apart on the provider's published default).
- **A listing's share picture after two hours** (#244): the plan's own test for step 3.1 is a link pasted into a chat on staging. The card route has only been run in tests.

## Plan 1: after-launch findings

- **The seller's ledger reads every "unpaid" sale on each load** (#199), and that set includes captured orders that will never be paid out (fully refunded, no transfer), so it grows for a seller with many refunds. Display only; nothing that moves money reads it.
- **`public.admin_open_operations`** (#199) probes every requested row through its index when fewer operations are open than the limit, so its cost grows with the audit log. Fine for an admin page.
- **The saved-search notice scrub** (#206) reads every `saved_search` notification once per account deletion. It wants an index on the kind, or a time bound, before the table is large.
- **`public.scrub_deleted_account` is restated in full** by each change to it (three times in four days). Splitting it into smaller functions is its own piece of work.
- **A replayed lost chargeback that stops between its two booking steps** (#208) waits in `loss_pending` for Stripe's next event: a webhook is redelivered, a replay is not. Close it with the write-off work (decision D1).
- **Two or three order emails for one event** (#204): an admin's full refund sends the refund email and "an update from DRVN support"; a partial refund inside a dispute sends the partial-refund email and "the problem is resolved". Accepted for launch.

---

# Plan 2 record: simplify the architecture (Part A)

The running record of `docs/plans/2026-11-architecture-remediation-plan.md`, Part A (A0 to A6), kept by the plan 2 building session. Started 10 November 2026 from `main` at `58b4ad7` (merge of #201). Neil approved the plan and decisions DA1, DA2 and D5 on 10 November. Every pull request here is reviewed by the orchestrating session before it merges; no pull request that carries a migration is opened, and neither shared database is touched, before the orchestrator declares the quiet point (rules R1 to R7 in plan 1). The plain-language work log is https://claude.ai/artifact/FHHyhbxUXLVz45bXSDpHZw.

Status words: **merged** (on `main`, CI green) · **in review** (PR up, waiting for the orchestrator or for checks) · **draft** (PR up, waiting for the pull request it is based on) · **prepared** (built and proven on a branch, not opened for merge) · **not started**.

## Plan 2 items

| Item | Findings | Ids | PR | Merge commit | Status |
|---|---|---|---|---|---|
| A0 Documents-only pull requests skip the browser suite | | | #215, #227 (plan 2 batch 1, #236), #239 | `9103915`, `66ce0de`, `431f326` | merged 10 November: the `changes` job and `scripts/ci-change-scope.mjs`; `release-gate` accepts a skipped browser lane only on a documents-only pull request. Measured on #216: mergeable in 4m48s. #227: only a pull request aimed at the default branch can be documents-only (GitHub does not rerun CI when a base changes). #239 (finding F1): the Stripe test-mode lane is skipped on a documents-only pull request too |
| A0b The browser suite as four parts side by side (added 10 November, approved by Neil) | | | #229 (plan 2 batch 1, #236) | `66ce0de` | merged 10 November: `e2e/parts.json` splits the spec files by measured time; four jobs, each with its own database and build; the `e2e` job judges and merges them; the same 331 tests, each once, proven by listing. Its first run found a fault in the split (a whole-suite rule checked inside each part), fixed before review. Two consecutive green runs on the merged split: parts 407, 429, 464, 483 s and 519, 491, 454, 346 s, against 1,064 to 1,229 s for the single job. Main's first run with it (42866427649): 331 tests, 11 min 27 s from first job to gate, artifact names unchanged |
| A1 A checked-in copy of the database | `#159` | N1075 | branch `db/a1-schema-snapshot` | | prepared and kept level with `main`: `scripts/schema-snapshot.mjs` writes `supabase/schema/` and `sql-guard` checks it. Two builds gave identical folders, and CI's own database matched the folder made on a Mac (run 42839710828). Opens at the quiet point, with the folder regenerated from `main` as it is then; its pull request names N1075 and resolves none (A6 settles it) |
| A2 The database owns every change to an order | | | branch `db/a2-order-status-moves` | | first of two prepared, not opened (quiet point): three functions take over the four direct writes that still ran; the other two of the six were unreachable (`apply_stripe_dispute_event` has made those changes since 20261107130000) and are removed. One fix with it: closing a dispute is one statement, so a delivery recorded during it is not overwritten. The second pull request is the guard on every role; see judgement calls |
| A3 New functions closed by default | | | branch `db/a3-functions-closed-by-default` | | prepared, not opened (quiet point): two `alter default privileges` statements and a guard. Accepted in design by the orchestrator: each SQL guard that defines `pg_temp` helpers opens them with one line (42 guards), because the default can only be removed for the creating role as a whole. Confirmation on hosted Supabase is asked for at the quiet point |
| A4 Launch-configuration browser lane | `#162` | N1078, N965 | #226 | `500a21f` | merged 10 November: job `e2e-launch` runs five specs against the recorded launch configuration (Stripe test mode, public cache on, agent off, DRVN Shipping off), including a real Stripe test payment settled by the webhook; `release-gate` requires it on every change that is not documents-only. Each spec seen to fail for a deliberate fault. The boot check's one relaxation (an http site URL on the isolated loopback stack in Stripe test mode) is refused on any hosted or self-named deployment, proven by test. Main's first run with it (42872823557): 10 min 8 s, 14 gate requirements, `test-results-<sha>-e2e-launch` present |
| A5 Launch switches recorded | | R-email | #224 (batch 1, #228) | `76a209a` | merged 10 November: `docs/release-evidence/launch-configuration.md` and `.json`, proven against the app's own resolvers; the saved-search digest job leaves the health check while there is no email provider. No migration |
| A6 One baseline in place of the migration history | `#159` | N1075, N786 | #231 (plan 2 batch 1, #236); branch `db/a6-baseline-tools` | `66ce0de` (#231 only) | analysis accepted by the orchestrator with rulings (section 11 of `docs/plans/2026-11-a6-baseline-analysis.md` on the branch). #231, merged, is the manually started workflow for the stack-build comparison. The generator, the four comparisons and the fault drill are written and tried on throwaway databases (all four identical; 16 of 16 deliberate faults reported; the runner's `--record-only` reads the file). Not started on any real database: waits for `DATABASE FROZEN`. Its pull request resolves N1075 and N786 |

## Plan 2: needs Neil

Nothing in plan 2 is blocked on these. The first two are information with the default already applied; the last two are for Neil to do or decide, and each carries the key of its row in the table for the Intelligence OS.

- **Carrier tracking at launch:** off by default because no EasyPost account exists; without it an order counts as delivered when the buyer confirms or after 21 days, so a seller's payout waits on that. Turning it on is one EasyPost key.
- **Listing importer at launch:** off by default because it uses the same Anthropic key as the agent; turning it on is that key with the agent left off.
- **Stripe Link on the card form (#2-H1):** checkout shows Bank and Klarna beside Card because Link is switched on in the Stripe account. DRVN's code assumes a card-style payment; before launch, either switch Link off in the Stripe dashboard (Settings → Payments → Payment methods → Link) or make one test payment with a Link bank account so its timing and refund behaviour are known.
- **A Stripe sandbox for CI (#2-F1):** in the Stripe dashboard click the account name, choose Sandboxes and create one named DRVN CI; open its Developers → API keys; then run `gh secret set STRIPE_TEST_SECRET_KEY --repo n89b-dot/DRVN-2` and paste the sk_test_ key, and `gh variable set STRIPE_TEST_PUBLISHABLE_KEY --repo n89b-dot/DRVN-2` and paste the pk_test_ key (or use Settings → Secrets and variables → Actions). About ten minutes. It stops check runs sending their test payments to the local site and, later, to staging; until it is done the local Stripe listener stays paused. If there is no Sandboxes option, say so and the fallback is a code change.

## Plan 2: judgement calls

- **A0, what a document is:** any `.md` file, and text, data or image files under `docs/`. A script under `docs/` and anything under `.github/workflows/` is code. The Stripe lane still runs on a documents-only pull request (about two minutes); only the browser lanes are skipped.
- **A0, `main` is never documents-only:** the skip applies to pull requests alone. A push to `main` runs the whole suite, so the deploy workflow and the Intelligence OS read the same proof on `main` as before.
- **No OS ids for plan 2's items:** the pull requests have plain titles and `Resolves: none`. Tests name the OS item they bear on where one exists (R-unproven, R-email).
- **A3, the plan's statement does not work as written.** On a throwaway database, as the non-superuser `postgres` role: `alter default privileges in schema public revoke execute on functions from public` leaves a new function callable by `anon` and `authenticated`, because Supabase's own per-schema defaults grant both and a per-schema default can only add to the global one. What closes a new function is the global form (`alter default privileges revoke execute on functions from public`) together with a per-schema revoke from `anon` and `authenticated`. `postgres` may not change `supabase_admin`'s defaults, so the migration uses the current-role form: CI builds as `supabase_admin`, a hosted project as `postgres`.
- **A2, scope and shape (ruled by the orchestrator, 10 November):** the app writes `orders.status` directly in six places, not the plan's three, plus two writes of `pre_dispute_status`; all move. The guard judges UPDATEs for every role, `service_role` and `postgres` included. One override exists for repairs and backfills: a transaction-local setting honoured only for `postgres` or `supabase_admin`, with a reason, audited. The transition table lives in one place and `docs/site/domain-states.md` is checked against it; it gains `paid -> delivered` (pickup), which the document omits today.
- **A0b, browser caching left out:** installing the browsers is about 38 seconds and the system packages would still be installed on a cache hit.
- **A4, the Stripe test publishable key** was added to the repository's settings as the Actions variable `STRIPE_TEST_PUBLISHABLE_KEY` on the orchestrator's approval, from the test key already in the main checkout's `.env.local`, never printed. CI confirmed it pairs with the existing secret.
- **A4, the card is presented through Stripe's API**, not typed into Stripe's form, after the form is seen to mount. Stripe's form changed shape between two runs and Stripe asks integrators not to automate it.
- **A4, two small changes to the app** so the launch configuration can run on the loopback stack at all: `DRVN_PUBLIC_CACHE=on` switches the cache on there, and the production boot check accepts an http site URL there in Stripe test mode only.
- **A5, what the plan did not rule on and was recorded as off:** carrier tracking (no EasyPost key) and the listing importer (it shares the agent's model key). Returns and pickup codes have no switch and stay on.
- **A6, the baseline will not be made with `pg_dump` alone.** A trial rebuild from a privilege-preserving dump opened 308 functions to signed-out visitors. Permissions are written from the catalog. The curated vehicle generations are not in a fresh build and move to their own file.

## Plan 2: found along the way, not fixed

Reported to the orchestrator; none is in plan 2's scope.

- The database does not itself refuse `shipping_mode = 'drvn'` when DRVN Shipping is off; the app does. No money can move that way. **After launch:** it becomes a small database guard when DRVN Shipping is next worked on (orchestrator's ruling on #224).
- How Stripe presents a Link bank or Klarna payment to an integration that creates card-only payments (card-like, or with bank-debit timing) could not be established from Stripe's documentation. No refund, dispute or payout path reads a card-only field. One test payment with a Link bank account, by whoever sets Stripe up, would settle it.
- Stripe's card form offers Bank and Klarna (Stripe Link options) beside Card, from the Stripe account's settings.
- **After launch:** today's schema grants `all` on 27 tables to `anon`, the signed-out role, `orders` among them; row-level security is the only thing that stands between a visitor and those rows. The A6 baseline carries today's grants exactly, as it must. Narrowing them is outside plan 2 Part A and is not acted on (orchestrator's ruling, 10 November); it is listed here so that it reaches the final review.
- **After launch:** in CI the Stripe test secret key is in the whole job's environment in both `stripe-integration` and `e2e-launch`, so every step sees it, `npm ci` included. It is a test key and the two jobs are consistent; scoping it to the steps that use it, in both jobs, is the tidy-up (orchestrator's note on #226).
- **F1, every Stripe test event reaches every deployment that listens on the same sandbox (10 November).** CI, local development and (soon) staging shared one Stripe test mode, and Stripe delivers a sandbox's test events to every endpoint registered in it. One check run creates 53 events (49 from `stripe-integration`: 11 payments and 5 refunds; 4 from `e2e-launch`: one payment). The webhook stores each one in `webhook_events`, and for each payment it has no order for it opens a recovery case, which is the right behaviour in production, where that means money with no order. On each listening deployment one run leaves 53 event rows, 7 open `capture_unresolved` cases, 5 open `refund_lifecycle_unresolved` cases and about 15 `refund_provider_events` rows. On shared dev on 10 November, through the local listener: 6,929 event rows (10 MB), 890 open `capture_unresolved` cases ($37,457.00), 728 open `refund_lifecycle_unresolved` cases ($21,135.00) and 2,376 refund event rows; 6,815 recovery cases stand open there in all. It did not start that day: 15,317 of the event rows are from before 10 November, the first on 30 August, so it has been happening since the local listener and CI first shared the account. The local site's pages took 14 to 22 seconds while a run's events arrived. **The rule (orchestrator's ruling): one Stripe sandbox per deployment**: CI's own now (the line under "Plan 2: needs Neil"), staging's own when its endpoints are made (`docs/staging-setup.md` §5), local development keeps the test mode it has, production is live. Nothing in the money path changes. Done in the same pull request: `stripe-integration` no longer runs on a documents-only pull request. Not done, and not without Neil's word: clearing the false cases and event rows from shared dev.
- **F2, after launch: shared dev's scheduler asks Stripe to refund stub payments.** 53 `refund_failed` recovery cases and 53 alert rows on shared dev on 10 November, each "No such payment_intent: 'stub_…'" from the dispute auto-refund sweep. It comes from a database that has run in both stub and Stripe mode, which production never will. Recorded only.
- Under a local `next start` the app's own redirects are built on `localhost` whatever address the browser used, so a guest returning from Stripe to `127.0.0.1` loses their order cookie. It does not apply to a hosted deployment.

---

## For the Intelligence OS

One table for both plans; the OS reads it exactly (`docs/ids.md`, "The table the OS reads", and `tests/ci/os-report-table.test.ts`). Finding is the step key: `#1-2.7` is plan 1 step 2.7. A row whose State is `step` is a progress marker for the ids in its OS id cell, never a second item: the step reads finished exactly when every id it names is settled. A `new` row is the one item for something that has no id yet. Plan 1's rows come first; plan 2's session adds its own after them.

| OS id | Finding | State | Pull request | For | Note |
|---|---|---|---|---|---|
| N1038 N1039 N1040 N1042 N1079 | #1-1 | step | #221 | engineer | Working rules R1 to R7 written into MIGRATIONS.md and the pull-request template |
| N1038 N1039 N1070 N1073 | #1-2.1 | step | #198, #230, #246, #248 | engineer | Deletion runbook for every state, the audited Resume deletion, and guards that no longer pass on any error |
| N662 N686 N1068 | #1-2.2 | step | #222, #230 | engineer | The 18+ check for accounts from before 8 November removed by Neil's ruling; the box at sign-up stays |
| N955 N1074 | #1-2.3 | step | #203, #234, #230, #235 | engineer | Photo uploads kept under the host's size limit, profile photos included |
| N958 N961 N1060 | #1-2.4 | step | #188, #235 | engineer | Staging kept out of search engines and checked after every deploy; one reading of "hosted" |
| N952 N960 N964 N1072 | #1-2.5 | step | #190, #235 | engineer | The staging set-up guide in an order that can be done |
| N949 N950 N1055 | #1-2.6 | step | #195, #235 | engineer | The watch on main's protection, and a production deploy refused unless its environment is restricted |
| N940 N1062 | #1-2.7 | step | #210, #237 | engineer | Photo signing rules: signed only at places the database guards, and the one-time clean-up of references that fail the rule |
| N718 | #1-2.8 | step | #199, #240 | engineer | Counts and lists that stopped at 1,000 rows, the four reads left on main, and a ratchet on unbounded reads |
| N1069 | #1-2.9 | step | #206, #243 | engineer | A deleted member's words leave other members' notices and saved-search emails; every notification kind says whose words it carries |
| N1064 | #1-2.10 | step | #208, #245 | engineer | Retry for a chargeback held for review: one transaction, the basket checked on every replay |
| N1063 | #1-2.11 | step | #204, #249 | engineer | Order emails that are not dropped when the provider's key lapses, with failed rows visible |
| N1065 | #1-2.12 | step | #207 | engineer | Chargeback write-off: set aside until after launch (decision D1) |
| N1066 | #1-2.13 | step | #209, #225 | engineer | Copyright counter-notice: set aside until after launch (decision D2); the by-hand procedure is in the runbook |
| N1048 N1051 N1052 N1053 | #1-3.1 | step | #244, #249 | engineer | Photos on main: a generated share image, a signer that tests can drive, a signing time budget, and a ratchet on unsigned loaders |
| N1054 N1056 N1058 N1059 N1060 | #1-3.2 | step | #218, #219, #228 | engineer | The deploy path: read-only login, key kinds at boot, one commit-sha rule, rollback caveats, the admin gate on every console path |
| N667 N1061 | #1-3.3 | step | #220, #233, #228, #235 | engineer | The vehicle catalogue filled on staging with its counts recorded; the corrected audit for damaged ids |
| N725 | #1-3.4 | step | #214 | engineer | Per-change Codex reviews waived by Neil's ruling; the queue test refuses an owed row |
| new | #1-4.8 | fixed | #223 | engineer | A report carries one small table the OS reads exactly, checked before the OS meets it |
| N1036 | #1-X1 | step | #200, #211 | engineer | The duplicate test fix: closed, the fix merged with #200 |
| N1036 N1079 | #1-X2 | step |  | engineer | Fixed-date sweep: every unit test passes with the clock 400 days and five years ahead |
| N909 | #1-X3 | fixed | #68 | engineer | #67 closed as superseded on 8 Nov; its three documents are on main from #68, and its marking of B1 as fixed (by #65) in the 3 Nov report is carried over in the pull request that adds this row |
| N1067 | #1-X4 | open | #199 | engineer | The 1,000-row half is fixed by #199. What remains: a taken-down photo can be uploaded again as a new file, because the block is by storage path, not by content. Blocking by content needs a ruling as well as a change, since a successful counter-notice must still get through |
| N946 | #1-X5 | fixed | #200, #199 | engineer | The four Codex findings on the copyright takedown: a reserved listing cannot return and media cannot be reattached (#200), the cached image is proven refused in a browser test (#200), and the blocklist is one lookup per object with no 1,000-row limit (#199) |
| new | #1-AL1 | after launch |  | engineer | The seller's ledger reads every unpaid sale on each load, and that set grows with refunds that are never paid out |
| new | #1-AL2 | after launch |  | engineer | admin_open_operations probes every requested row when few operations are open, so its cost grows with the audit log |
| new | #1-AL3 | after launch |  | engineer | The deletion scrub reads every saved-search notification and every saved-search email once per deletion; it wants an index or a time bound |
| new | #1-AL4 | after launch |  | engineer | scrub_deleted_account is restated in full by each change to it; split it into smaller functions |
| new | #1-AL5 | after launch |  | engineer | A replayed lost chargeback that stops between the two booking steps waits for Stripe's next event; close it with the write-off work (D1) |
| new | #1-AL6 | after launch |  | engineer | Some events raise two or three order emails (an admin's full refund; a partial refund inside a dispute); fold each into one |
| new | #1-H1 | waiting on R-hosting |  | you | Once a host exists: run the deploy's indexing check against it (it has only run against a local server) |
| new | #1-H2 | waiting on R-hosting |  | you | Once staging is hosted: measure the latency the copyright blocklist lookup adds to image requests |
| new | #1-H3 | waiting on R-hosting |  | you | Once a host exists: send one grouped request of 100 ids through the hosted gateway to confirm it is accepted |
| new | #1-H4 | same as R-sentry |  | you | Set ADMIN_ALERT_WEBHOOK_URL so the protection watch and the money alerts have somewhere to send |
| new | #1-H5 | waiting on R-email |  | you | On the first real send: confirm how the provider treats a repeated idempotency key with a changed body, and its rate limit |
| new | #1-H6 | waiting on R-hosting |  | you | Once staging is hosted: paste a listing link into a chat and confirm its picture is still there two hours later |
| new | #2-A0 | fixed | #215, #227, #236, #239 | engineer | A documents-only pull request skips the browser suite and the Stripe test lane; only a pull request into main can be documents-only |
| new | #2-A0b | fixed | #229, #236 | engineer | The browser suite runs as four parts side by side: about ten minutes a run in place of twenty, the same 331 tests |
| new | #2-A1 | open |  | engineer | A checked-in copy of the database as it stands, kept current by CI; opens at the quiet point. Related: N1075, which A6 settles |
| new | #2-A2 | open |  | engineer | The database owns every change to an order's status, with a guard on every role; two pull requests, at the quiet point |
| new | #2-A3 | open |  | engineer | A new database function is closed unless a migration opens it; at the quiet point |
| N1078 | #2-A4 | step | #226 | engineer | The browser lane for the settings DRVN launches with |
| new | #2-A5 | fixed | #224, #228 | engineer | The launch switch settings recorded and proven against the app's own resolvers; nothing deleted. Related: R-email |
| N1075 N786 | #2-A6 | step | #231, #236 | engineer | One starting migration in place of the migration history, after A1 to A3 and before the production database exists; the manually started proof workflow is merged |
| N965 | #2-X1 | fixed | #226 | engineer | The public data cache runs in a browser test: the launch-settings lane serves the app with the cache on and proves a second read comes from the shared copy and a seller's edit shows at once |
| new | #2-F1 | open |  | you | Create a Stripe sandbox named DRVN CI and put its two test keys in the repository's Actions settings (secret STRIPE_TEST_SECRET_KEY, variable STRIPE_TEST_PUBLISHABLE_KEY): until then every check run's test payments reach the local site, and would reach staging |
| new | #2-F2 | after launch |  | engineer | Shared dev's scheduler asks Stripe to refund stub payments; it comes from a database run in both stub and Stripe mode, which production never is |
| new | #2-H1 | open |  | you | Stripe Link on the card form: switch it off in the Stripe dashboard, or make one test payment with a Link bank account so its timing and refunds are known |
| new | #2-AL1 | after launch |  | engineer | 27 tables grant all to the signed-out role, orders among them; row-level security is the only guard |
| new | #2-AL2 | after launch |  | engineer | The database does not itself refuse shipping_mode drvn when DRVN Shipping is off; the app does |
| new | #2-AL3 | after launch |  | engineer | The Stripe test key is in the whole job's environment in both Stripe CI jobs; scope it to the steps that use it |
| new | #2-AL4 | after launch |  | engineer | Under a local next start the app's redirects are built on localhost whatever address the browser used |

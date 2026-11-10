# Remediation record: November 2026

The running record of `docs/plans/2026-11-remediation-plan.md` (the plan). Started 8 November 2026 from `main` at `e0e696c`. One row per plan item: the PR that did it, its merge commit, and where it stands. Under the table: the defaults applied from the plan's decisions table, judgement calls, what needs Neil, and what is blocked and why. This file is a `docs/plans/` file, so the Intelligence OS does not read it as a report. The OS credits work through the ids in merged PR titles and `Resolves:` lines.

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
- **D2 merge (#175):** if GitHub refuses the merge because the CLI token lacks the `workflow` scope, run `gh auth refresh -s workflow` (or merge #175 in the browser once it is green).
- **D2 setup:** create the GitHub environments `staging` and `production` (production with you as required reviewer), the Vercel projects with automatic Git deploys off, and the secrets and variables listed at the top of `.github/workflows/deploy.yml` and in `docs/staging-setup.md` §11.4. Then set `DRVN_DEPLOY_STAGING = true`.
- **The rest of workstreams D–H** as the plan lists them: hosting and domain, email provider, Stripe Connect, Sentry, alerts, uptime and monitor variables, the production project with PITR, the entity and market, counsel, and the agent ruling. Each has a row to date in `docs/release-evidence/infrastructure.md`.

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
| 2.1 Deletion runbook and Resume | `#125`, `#126`, `#154`, `#157` | N944, N734, N1038, N1039, N1070, N1073 | #198 | | approved 10 Nov, in batch 2 (#230): the D6 named exception in `tests/ci/migration-order.test.ts`, two guards that no longer pass on any error, runbook §5d "What the console cannot finish". Its migration `20261110110000` was already on both databases. **Follow-up owed:** `public.admin_resume_account_deletion` takes no actor and does not call `assert_admin_actor` in SQL (service role only today, and the app checks the admin); add the check in a new migration with the next deletion change |
| 2.2 18+ for earlier members | `#152` | N662, N686, N1068 | #201 merged as written (`58b4ad7`); #217 closed unmerged; #222 | | **removed by ruling (Neil, 10 November 2026)**; #222 approved, last member of batch 2 (#230); migration `20261110131000` applied to shared dev then staging immediately before that batch merges |
| 2.3 Upload size | `#158` | N955, N1074 | #203; avatar follow-up to come | | #203 approved 10 Nov, in batch 2 (#230): a second shrink method and tests of the server's 413; resolves N955. **N1074 stays open** until the profile photo upload shrinks too (written, goes up when #203 lands) |
| 2.4 Staging out of search | `#156` | N958, N961 | #188 | | inherited, not started |
| 2.5 Set-up order | `#156` | N952 | #190 | | inherited, not started |
| 2.6 Protection watch, and its follow-up | `#156`, `#139` | N949, N950 | #195 | | inherited, not started (the orchestrator merges #195) |
| 2.7 Photo signing rules | `#131`, `#146` | N940 | #210 | | inherited, not started. Clean-up count, read-only, 10 Nov: 0 references on staging (no photo rows there), 1 on shared dev (`cars.cover_image_url`); within decision D3 |
| 2.8 1,000-row limits | `#155` | N718 | #199 | | inherited, not started |
| 2.9 A deleted member's words | `#153` | | #206 | | inherited, not started |
| 2.10 Chargeback retry | `#148` | N944 | #208 | | inherited, not started |
| 2.11 Order emails | `#147` | | #204 | | inherited, not started |
| 2.12 Chargeback write-off | `#149` | N944, N1065 | #207 | | set aside until after launch (decision D1): a draft since 10 Nov, with what it needs when it returns |
| 2.13 Copyright counter-notice | `#150` | N1066 | #209; #225 | `76a209a` (#225, in batch 1) | set aside until after launch (decision D2): a draft since 10 Nov; the by-hand procedure is runbook §5e, merged 10 Nov |
| Duplicate test fix | `#124` | | #211 | | closed: the fix merged with #200 |
| 3.1 Photos on `main` | `#132`, `#135`, `#136`, `#137` | | | | not started (after step 2.7 merges) |
| 3.2 The deploy path | `#138`, `#140`, `#142`, `#143`, `#144` | N1054, N1056, N1058, N1059, N1060; N715, N962, N957, N714, N634 | #218, #219 | `76a209a` (batch 1, #228) | merged 10 Nov: admin gate on every console path, key kinds at boot, one commit-sha rule that prefers the workflow's sha, patched ranges, rollback caveats, and `--status` through a read-only login. **N1060 (`#144`) stays open** until #188 gives the single definition of "hosted" |
| 3.3 Data set-up | `#141`, `#145` | N667, N1061, N943 | #220; this evidence PR | `76a209a` (batch 1, #228) | merged 10 Nov. Staging import run 10 Nov 16:16 UTC from merged code: 315 makes, 5,541 models, 175 of 194 curated generations; recorded in `docs/release-evidence/infrastructure.md` |
| Fixed-date sweep | `#124`, `#163` | | none needed | | done 10 Nov: every unit test under `src` passes with the clock 400 days and five years ahead |
| The table the OS reads | plan step 4.8 | | #223 | `76a209a` (batch 1, #228) | merged 10 Nov: format in `docs/ids.md`, check in `tests/ci/os-report-table.test.ts`, on the OS's own file pattern |

## Plan 1: needs Neil

## Plan 1: judgement calls

- **Step 0:** an `owed` row is now refused by the test, not only tolerated, so a later pull request cannot quietly restart the debt the ruling ended. A docs-only pull request stays `skipped`. Thirteen merged pull requests that had no row (#182 to #205) were given one.
- **Step 2.2, Neil's ruling of 10 November 2026:** "regarding the 18+ confirmation work....all current accounts are test accounts and not real users so this work doesn't matter and addressing it seems to be adding unecessary code, decide how this should be addressed in terms of code removal and send the work to the appropriate agent". Decision taken on that instruction: keep the requirement where a new person joins (the 18+ box at sign-up, onboarding and guest checkout, the table, and the database's refusal of a handle without a record) and remove everything that chased accounts from before 8 November (the sign-in redirect of #174, the page-request check of #201, `/confirm-age`, `public.my_age_confirmation_due()`). No real member can be an earlier member: production does not exist and every new account answers on the way in. Finding `#152` is settled by #222, not by the fix the plan listed; #217, which implemented that fix, was closed unmerged.
- **Step 3.3, the three Volkswagen trims:** on a database filled only from the pinned VehiclesDB release, the curated generations for `Golf GTI`, `GTI` and `Golf R` (19 of 194) have no catalogue model to attach to, because VehiclesDB files them under `Golf`. Nothing was added to the catalogue. A GTI is entered as a Golf and resolves its generation. Revisit with real use.
- **Step 3.2, the deploy's read-only login:** `deploy_reader` was not created on staging. It is five statements in the owner's set-up guide and has no secret to live in until the GitHub environments exist; it swaps two secrets on his list for two, adding none.
- **Finding `#157`, one more guard than the plan names:** the takedown guard that merged with #200 had the same `when others then null` as #198's; both are fixed in #198's pull request, because it is one finding.
- **How changes land, from 10 November 16:00 UTC (the orchestrating session's decision):** approved pull requests merge in batches. A batch branch is cut from `main`, each member's approved head is merged with `--no-ff` (never rebased or squashed, so GitHub marks the member merged), the checks run once on the combination, and the orchestrating session verifies the batch holds exactly what it approved. At most one member with a migration to apply, merged last, applied to shared dev then staging once the batch is green and immediately before the merge. Batch 1 was #228 (`76a209a`): #225, #218, #220, #223, #219, and plan 2's #216 and #224. Batch 2 is #230.
- **Rule R4, as clarified on 10 November:** merge when the pull request is level with `main` and every check is green on its head; do not wait for `main`'s own run of the previous merge, which tests the same tree. If any run on `main` completes red, stop merging and tell the orchestrating session.
- **Needs Neil, format:** every line under "Plan 1: needs Neil" is a bullet of the form `- **short name:** one sentence`, which is the shape the Intelligence OS reads. The section is empty when nothing needs him.

---

# Plan 2 record: simplify the architecture (Part A)

The running record of `docs/plans/2026-11-architecture-remediation-plan.md`, Part A (A0 to A6), kept by the plan 2 building session. Started 10 November 2026 from `main` at `58b4ad7` (merge of #201). Neil approved the plan and decisions DA1, DA2 and D5 on 10 November. Every pull request here is reviewed by the orchestrating session before it merges; no pull request that carries a migration is opened, and neither shared database is touched, before the orchestrator declares the quiet point (rules R1 to R7 in plan 1). The plain-language work log is https://claude.ai/artifact/FHHyhbxUXLVz45bXSDpHZw.

Status words: **merged** (on `main`, CI green) · **in review** (PR up, waiting for the orchestrator or for checks) · **draft** (PR up, waiting for the pull request it is based on) · **prepared** (built and proven on a branch, not opened for merge) · **not started**.

## Plan 2 items

| Item | Findings | Ids | PR | Merge commit | Status |
|---|---|---|---|---|---|
| A0 Documents-only pull requests skip the browser suite | | | #215, #227 | `9103915` | merged 10 November: the `changes` job and `scripts/ci-change-scope.mjs`; `release-gate` accepts a skipped `e2e` only on a documents-only pull request; the Stripe lane no longer waits on `e2e`. Measured on #216: mergeable in 4m48s. #227 (approved, in the plan 2 batch) closes a gap found afterwards: only a pull request into `main` can be documents-only, because a verdict worked out against another branch would survive a retarget |
| A0b The browser suite as four parts side by side (added 10 November, approved by Neil) | | | #229 | | in review: `e2e/parts.json` splits the spec files by measured time; four jobs, each with its own database and build; the `e2e` job judges and merges them; the same 331 tests, each once, proven by listing |
| A1 A checked-in copy of the database | `#159` | N1075 | branch `db/a1-schema-snapshot` | | prepared: `scripts/schema-snapshot.mjs` writes `supabase/schema/` (1,098 files) and `sql-guard` checks it. Two builds gave identical folders, and CI's own database matched the folder made on a Mac (run 42839710828). Opens at the quiet point, regenerated |
| A2 The database owns every change to an order | | | | | not started (quiet point). Pre-study done and ruled on: six direct writes, not three; the guard applies to every role; see judgement calls |
| A3 New functions closed by default | | | | | not started (quiet point). Tried on a throwaway database: see judgement calls |
| A4 Launch-configuration browser lane | `#162` | N1078 | #226 | | draft until A0b (#229) lands, since both edit `ci.yml`. Passed on GitHub on its first run there (run 42850751984, 211 seconds), including a real Stripe test payment settled by the webhook. Each spec seen to fail for a deliberate fault |
| A5 Launch switches recorded | | R-email | #224 (batch 1, #228) | `76a209a` | merged 10 November: `docs/release-evidence/launch-configuration.md` and `.json`, proven against the app's own resolvers; the saved-search digest job leaves the health check while there is no email provider. No migration |
| A6 One baseline in place of the migration history | `#159` | N1075, N786 | branch `docs/a6-baseline-analysis`; #231 | | analysis accepted by the orchestrator with rulings and four additions (section 11 of `docs/plans/2026-11-a6-baseline-analysis.md` on that branch). #231 is the manually started workflow for the stack-build comparison. The work waits for A1 to A3 and for the orchestrator to freeze the database |

## Plan 2: needs Neil

Nothing is blocked on these. Each is information with the default already applied.

- **Carrier tracking at launch:** off by default because no EasyPost account exists; without it an order counts as delivered when the buyer confirms or after 21 days, so a seller's payout waits on that. Turning it on is one EasyPost key.
- **Listing importer at launch:** off by default because it uses the same Anthropic key as the agent; turning it on is that key with the agent left off.
- **Stripe Link on the card form:** checkout shows Bank and Klarna beside Card because Link is switched on in the Stripe account. DRVN's code assumes a card-style payment; before launch, either switch Link off in the Stripe dashboard or make one test payment with a Link bank account so its timing and refund behaviour are known.

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
- Under a local `next start` the app's own redirects are built on `localhost` whatever address the browser used, so a guest returning from Stripe to `127.0.0.1` loses their order cookie. It does not apply to a hosted deployment.

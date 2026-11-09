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

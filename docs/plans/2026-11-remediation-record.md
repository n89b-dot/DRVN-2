# Remediation record: November 2026

The running record of `docs/plans/2026-11-remediation-plan.md` (the plan). Started 8 November 2026 from `main` at `e0e696c`. One row per plan item: the PR that did it, its merge commit, and where it stands. Under the table: the defaults applied from the plan's decisions table, judgement calls, what needs Neil, and what is blocked and why. This file is a `docs/plans/` file, so the Intelligence OS does not read it as a report. The OS credits work through the ids in merged PR titles and `Resolves:` lines.

Status words: **merged** (on `main`, CI green) · **open** (PR up, merged by hand once every check is green on a branch level with `main`) · **owner** (Neil's to do; prepared work listed) · **on hold** (waiting on a ruling).

## Items

| Item | Ids | PR | Merge commit | Status |
|---|---|---|---|---|
| Staging and shared dev catch-up | R-staging-behind | #167 | `72ec871` | merged: `20261107220500`–`220520` (#149) applied to both, `20261108140000` (#166) to staging |
| A1 approval guard | OS-W36 N677 (N676) | #168 | `1b8080c` | merged. Cause: card redaction mangled ~0.3% of random UUIDs (fixed by #158), not ordering. FAIL 0 now sweeps 5,000 ids; sql-guard passed 3 times on the PR |
| A2 strict status checks | (owner) | — | — | done by the orchestrator at Neil's go-ahead: `protect-main` ruleset id `26808907`, strict on; `docs/owner/branch-protection.md` records it |
| A3 Codex queue file | #95 | #171 | `2f68c91` | merged: 106 rows, 26 code PRs owe a review; reviews run rationed after the merges |
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
| C2 transfer recovery | N499 | #176 | | open: already fixed by #91; adds N499 tests, corrects the crosswalk |
| C3 deploy gating | N528 | #175 | | open, with D2 |
| C4 private-car and draft photos | OS-W38 N455 | #178 (#177 closed) | | open; migration applied after merge (order below) |
| C5 18+ backfill prompt | OS-W38 N686 | #174 | | open; `20261108150000` applied to shared dev and staging |
| C6 Supabase Auth settings | N451 N441 N662 | — | — | owner (rows ready in `docs/release-evidence/infrastructure.md`, #175) |
| C7 stub-override boot assertion | OS-W38 N540 | #173 | | open |
| C8 infrastructure evidence file | OS-W39 N224 | #175 | | open |
| D2 deploy pipeline | OS-W39 N634 N528 | #175 | | open; touches `.github/workflows/` |
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
| `20261108160000_member_photos_private.sql` | #178 | after merge (see order) | after merge |

`private.username_audit` holds no rows on either project after `220500`. **C4's order is the reverse of the usual rule:** merge #178, update the shared checkout to merged `main`, restart the :3005 dev server (`launchctl kickstart -k` its launchd agent), and only then apply `20261108160000` to shared dev and staging. Applied first, every car, listing and post photo stops loading.

### Early merges while `main` had no protection

On 8 November, from about 18:45 to 18:54 UTC, `main` had no ruleset, so `gh pr merge --auto` merged at once: #167, #98, #100, #101, #103 (verify, sql-guard and secrets had passed; e2e had not finished) and #169 (nothing had finished). All were docs or tests, green locally. The main run that proves them is **42512274085** on `d2c09f8`, which finished green on every job. Since then every merge is by hand, after every check is green on a branch level with `main`.

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

- **#53 design docs reconcile (A7):** 82 files, conflicting with `main` since October, touching components that have changed since. Resolving it is a design session of its own; the brand assets (favicon, icons, manifest, OG cards in `src/lib/og/card.tsx`) are the part worth splitting out. Left open.

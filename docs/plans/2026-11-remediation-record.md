# Remediation record: November 2026

The running record of `docs/plans/2026-11-remediation-plan.md` (the plan). Started 8 November 2026 from `main` at `e0e696c`. One row per plan item: the PR that did it, its merge commit, and where it stands. Under the table: the defaults applied from the plan's decisions table, what needs Neil, and what is blocked and why. This file is a `docs/plans/` file, so the Intelligence OS does not read it as a report. The OS credits work through the ids in merged PR titles and `Resolves:` lines.

Status words: **merged** (on `main`, CI green) · **open** (PR up) · **in progress** · **on hold** (waiting on a ruling) · **owner** (Neil's to do; prepared work listed) · **not started**.

## Items

| Item | Ids | PR | Merge commit | Status |
|---|---|---|---|---|
| Staging catch-up, 8 Nov | R-staging-behind | this record's PR | | 4 files applied to staging and 3 to shared dev with the runner (below) |
| A1 approval guard | OS-W36 N677 | | | in progress |
| A2 strict status checks | (owner) | | | owner |
| A3 Codex queue file | #95 | | | not started |
| A4 inventory families | OS-W36 N680 | | | in progress |
| A5 crosswalk test | #98 | | | not started |
| A6 migration order test | #97 | | | not started |
| A7 stale PRs | R53-pr, #67, #98 #100 #101 #103 | | | not started |
| A8 design files | #99, R86 | | | not started |
| B1 shared-dev history gaps | #91, R-migrations | this record's PR | | on hold: the per-file reasons and evidence are written in `supabase/MIGRATIONS.md`; the runner's `--attest` mode is not built while Neil chooses between it and closing the 12 by hand |
| B2 staging-level rule | OS-W37 R-staging-behind | | | not started |
| B3 release-candidate script | OS-W37 R-rcconfig | | | not started |
| B4 production target | (prep for D4) | | | owner: waits for the production project |
| C1 deletion proof on staging | B7 N418 N439 N442 | | | owner: waits for D3 |
| C2 transfer recovery by key | N499 | | | not started |
| C3 deploy gating | N528 | | | with D2 |
| C4 private-car and draft photos | OS-W38 N455 | | | not started |
| C5 18+ backfill prompt | OS-W38 N686 | | | not started |
| C6 Supabase Auth settings | N451 N441 N662 | | | owner |
| C7 stub-override boot assertion | OS-W38 N540 | | | not started |
| C8 infrastructure evidence file | OS-W39 N224 | | | not started |
| D1–D7, D-mail | | | | owner |
| D2 deploy pipeline | OS-W39 N634 N528 | | | not started |
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

After these, `--status` on staging reports none missing (281 applied). Shared dev reports only the twelve history gaps (B1). `private.username_audit` holds no rows on either project: `220500` found no username to change.

## Defaults applied

From the plan's decisions table, applied by the executor without asking (Neil asked for the work to go ahead on the recommended defaults):

- (filled in as each lands)

## Needs Neil

One line each: what to do and where.

- **A2 strict status checks:** GitHub → repository Settings → Branches → `main` rule → tick "Require branches to be up to date before merging". Then `gh api repos/n89b-dot/<repo>/branches/main/protection` shows `required_status_checks.strict: true`.
- **B1 ruling:** choose between an attested-row runner mode (`--record-only --attest <file> --reason`) and documenting the twelve gaps and closing R-migrations by hand. The per-file reasons and evidence are in `supabase/MIGRATIONS.md` under "known gaps" either way.

## Blocked

- (none yet)

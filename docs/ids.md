# Ids: how DRVN names launch work for the Intelligence OS

The DRVN Intelligence OS (a separate local app) watches this repository and closes a launch item only on evidence: a merged PR that names the item, plus a finished green CI run on main containing the merge, or an item-specific check such as a named test passing on main. This page is the contract for how work here names itself so the OS can read it. The checks that enforce it are in `tests/ci/`.

## The id families

| Family | Form | Example | What it names | Canonical? |
|---|---|---|---|---|
| OS item | `N` + number | `N410`, `N433` | One launch problem | **Yes, for items** |
| OS item, slugged | `R-` + slug | `R-staging`, `R-audit-composer` | One launch problem with no number | **Yes, for items** |
| Report item | `R` + number, optional slug | `R75`, `R69-age` | An item from release-readiness report two (R60–R87) | Yes, as the OS holds it |
| 3 Nov blocker | `B` + one digit | `B1` … `B9` | A blocker in `docs/production-readiness-2026-11-03.md` | Alias only |
| Batch | `OS-W` + number, optional letter | `OS-W12`, `OS-W20a` | A batch of work (an OS packet) | **Yes, for batches** |
| PR packet | `OS-PR` + number | `OS-PR33`, `OS-PR65` | Finishing an existing PR | Yes, for batches |
| Slugged packet | `OS-R-` + slug | `OS-R-cron`, `OS-R-pg` | A packet named for an R item | Yes, for batches |
| Commerce packet | `OS-p1-commerce` | | The p1 commerce branch | Yes, for batches |

**One N scheme, not two.** The blockers plan's `N1`–`N250` (`docs/plans/2026-11-blockers-resolution.md`) are the OS's own ids from before its 7 November re-read. The OS now numbers the same items `N4xx` and up and keeps the old numbers as aliases. Either resolves to the same item, so a PR that says `N19` and one that says `N420` close the same thing. Prefer the current `N4xx` number in new work. The OS holds the alias table; `docs/plans/2026-11-readiness-crosswalk.md` is a human copy of it, and `docs/plans/2026-11-readiness-crosswalk.json` (regenerate with `npm run docs:crosswalk`) is that copy as data.

Ids are case-sensitive and whole tokens: `N410` is an id, `n410` and `N410a` are not. The exact patterns are in `tests/ci/os-ids.ts`, whose `TASK_ID` is copied from the OS's `server/capture/types.ts`.

## Pull requests

- **Title:** starts with the batch ids the PR works under, in capitals, such as `OS-W12 OS-R-cron: sign-in security`. The OS reads ids in the title and the branch name as the PR's tasks. Work outside any batch uses a plain title.
- **`Resolves:` line:** one line in the description, `Resolves: N420 N421 OS-W12`, listing every id the PR closes, items and batches both. Write `Resolves: none` when it closes nothing. The OS reads only this line as a claim; ids elsewhere in the description are prose. It still closes an item only on evidence.
- `tests/ci/pr-resolves.test.ts` fails a PR whose title names an id but whose description has no `Resolves:` line, and any `Resolves:` line that is empty or holds something that isn't an id. The description is read when CI runs: after editing it, push a commit or rerun the verify job.

## Test names

Every test file and SQL guard a PR adds or changes names at least one canonical id, so a passing test on main can prove an item:

- **Vitest and Playwright:** in a `describe` or `it`/`test` title, anywhere in the string. Conventional forms: `describe("password reset (N421)", …)` or `it("N31: the database joins the follows", …)`.
- **SQL guards** (`supabase/tests/*_guard.sql`): in a `raise exception` message, such as `raise exception 'FAIL 6: a dispute closed during a chargeback released the payout (N416)'`.
- Canonical here means `N###`, `R-slug`, `R##` (with or without a slug) or `OS-W##`. `tests/ci/test-ids.test.ts` checks the files a PR touches against the base branch; a PR whose description says `Resolves: none` is exempt.

## Migrations

Every file in `supabase/migrations/` has a row in `supabase/MIGRATIONS.md`, and its "Applied to" cell is one of `not applied`, `shared-dev <YYYY-MM-DD>`, `staging <YYYY-MM-DD>` or `production <YYYY-MM-DD>` (several joined with `; `). Rows written before this rule are listed in `supabase/migrations-md-baseline.json` and keep their prose.

`node scripts/apply-migration.mjs --target <name> --status` prints, read-only, what a target has applied against what is on disk, as JSON. Each row the runner records in `supabase_migrations.schema_migrations` carries a provenance comment line in `statements[0]`: `-- applied_by=<user> source_sha=<sha> pr=<n>`. It is the first line of an applied file's row, and the second (after the `--record-only` marker) of a row recorded without running the file. Pass `--pr <n>` when applying a merged PR's files.

## What CI publishes per commit

All artifacts are keyed by the commit sha and kept 30 days.

| Artifact | Job | Contents |
|---|---|---|
| `test-results-<sha>-verify` | verify | `test-results/vitest.xml` (JUnit, `npm test`) |
| `test-results-<sha>-sql-guard` | sql-guard | `test-results/sql-guards.xml` (JUnit: one `<testcase>` per guard, named by the file's basename without `.sql`; a failure's body is the guard's `FAIL` lines verbatim) |
| `test-results-<sha>-e2e` | e2e | `test-results/operations.xml` (JUnit, `test:operations`), `test-results/playwright.xml` (JUnit, Playwright). The browser suite runs as four parts (`e2e/parts.json`); this file is the four parts' files merged: every `<testsuite>` (one per spec file and browser, as before) under one root whose counts are the sums |
| `test-results-<sha>-stripe-integration` | stripe-integration | `test-results/stripe.xml` (JUnit, `test:stripe`) |
| `browser-release-summary-<sha>` | e2e | `browser-release-<sha>.json`, the browser suite's counts, summed over the four parts; `releaseStatus` is `passed` only when every part's was; `parts` says how many parts reported |
| `e2e-part-<n>-<sha>` (n = 1 to 4) | e2e-parts | One part's own results before merging: `part.json` (`ran`, `first_attempt_passed`), its `playwright.xml`, its browser summary, and `operations.xml` from the one part that runs the drills. A reader that wants the whole suite uses the two merged artifacts above |
| `release-gate-<sha>` | release-gate | `release-gate-<sha>.json`: the gate's result and each requirement's outcome, written even when the gate fails. `scope` is `full`, or `documents-only` on a pull request that changed documents only and so skipped the browser suite (`docs/owner/branch-protection.md`); a run on `main` is always `full` |

To collect every JUnit file for a run, list the run's artifacts and take every name that starts with `test-results-<sha>-`.

The deployed app answers `GET /api/version` with `{sha, buildId, newestMigrationOnDisk, startedAt}`, unauthenticated and uncached.

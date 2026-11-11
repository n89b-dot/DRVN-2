# A6: steps 4 to 6, and what the baseline means for everything else

Plan 2 item A6 (N1075, N786). The method is `docs/plans/2026-11-a6-baseline-analysis.md` (section 11 holds the rulings); the proof is `docs/plans/2026-11-a6-baseline-proof.md`. This page is what is done to shared dev and staging, in what order, and how it is undone.

**Nothing on this page writes to either database before the lead sends `APPROVED A6 STEP 5`.** Until then both are read only, and read as `os_reader`.

## Step 4: shared dev and staging against the baseline (done, read only)

Read on 11 November 2026 as `os_reader` (read-only sessions, nothing widened) with `scripts/baseline/reader-capture.mjs`, which runs the snapshot's own query with every read of a table `os_reader` cannot select left out and named. Each database's folder was compared with the stack build of the baseline (`baseline-proof.yml` run 42950129754, capture `B/snapshot`: real Storage and Auth, files applied as `postgres`, as on a hosted project).

**Identical on both:** all 563 functions with their bodies and permissions, all 143 policies, every table but the two below, every trigger on staging, every index, sequence, view, publication, schema and default privilege, `agent_worker`'s grants. The five functions the 10 November review said were overwritten on shared dev are no longer different.

**Differences, every one:**

| # | Where | Difference | What it is | Proposed |
|---|---|---|---|---|
| 1 | both | `os_reader` (role, two settings, `grant os_reader to postgres`) | Made by hand for the Intelligence OS (7 and 8 Nov, Neil approved) | Written down; kept |
| 2 | both | `public.account_deletion_requests`: `hold_order_id` sits before `retain_until` | Column order only: the hosted databases ran two files in merge order, not file-name order (#97) | Written down; nothing reads columns by position |
| 3 | shared dev | `public.mod_items`: `origin` sits after `brand_key` | Column order only, as 2 | Written down |
| 4 | shared dev | `agent_worker` is `login` (the baseline: `nologin`) | Changed by hand on shared dev | For the lead: fix forward (`alter role agent_worker nologin`) after approval, or write down |
| 5 | shared dev | `deletion_write_guard` triggers on four more tables: `activity_post_listings`, `analytics_consents`, `beta_invitations`, `beta_memberships` | `20260905011618_remediation_integrity.sql` adds the trigger, by a loop, to every table that exists when it runs; shared dev ran it after those four tables existed | For the lead: drop the four (fix forward) after approval, or write down. They only refuse writes by a deleted account |
| 6 | both | `role-settings.sql`: the local stack's `jwt_secret`, `supabase_functions_admin` and (shared dev) `supabase_realtime_admin` settings, and shared dev's `supabase_admin statement_timeout=0` | The platform's own settings, not ours | Expected (production runbook §2) |
| 7 | shared dev | History: 291 rows; 12 files without a row and 5 rows without a file (N786) | Rows without a file: `20260913014536`, `…014621`, `…134641`, `…135341`, `…144516`. Files without a row: `20260905011618`, `20260905143949`, `20260905224929`, `20260913144218`, `20260919203000`, `20260919204000`, `20260928120000`, `20260928181000`, `20261004100000`, `20261006100200`, `20261011121000`, `20261017140000` | Step 5 archives all 291 and records the baseline: N786 closes |
| — | staging | History: 298 rows, one per file, nothing missing or extra | | Step 5 |

**What `os_reader` cannot read** (no USAGE on `private` or `cron`, no SELECT on these; identical on both databases): the rows of the seven reference tables (`private.order_status_transitions`, `private.reserved_usernames`, `public.agent_beta_steps`, `public.agent_controls`, `public.agent_spend_limits`, `public.policy_announcements`, `public.settlement_settings`), `cron.job` (the 21 scheduled jobs) and `storage.buckets` (the 8 buckets). It also cannot count the rows of our 146 tables, and so cannot run comparisons 3 and 4 (`pg_dump` needs SELECT on every table); those compare a fresh build with a fresh build and say nothing about a database holding test data, so they are not asked for here. **Asked of the lead:** an owner session in a read-only transaction for those nine objects only, to compare their rows with the baseline's (`cron-jobs.sql`, `storage-buckets.sql`, `reference-data/`).


## Step 5: replace the history rows (staging first, then shared dev)

Only the history is written. No table, function or row of member data changes, so undoing the history rows returns the database to exactly where it was. The tool is `scripts/baseline/replace-history.mjs`; it signs in as the owner (`--env-file`, as the runner does) and refuses any target not in `supabase/migration-targets.json` or not the one the env file points at.

For each database, **staging first**, from the repository root at the A6 pull request's approved head:

1. **Before.** `node scripts/apply-migration.mjs --target <name> --env-file <env> --status > before-<name>.json`. Expected: staging `count` 298, shared dev 291, both `newest` `20261111120000`. Any other count: stop.
2. **Verification.** `node scripts/apply-migration.mjs --target <name> --env-file <env> --record-only supabase/migrations/<baseline>.sql`. The runner's own check, read only: every object the baseline creates is on the target, every function by signature and body. Expected: `record`, `3727 object(s) verified`. A refusal stops the step and goes to the lead with its reasons.
3. **Dry run of the replace.** `node scripts/baseline/replace-history.mjs --target <name> --env-file <env> supabase/migrations/<baseline>.sql`. Read only. Prints the history count it sees (must equal step 1), the same verification again, the archive table's name (`schema_migrations_archive_<yyyymmdd>`, UTC) and a code bound to the target, the exact versions it saw, the baseline's bytes and the archive's name.
4. **Replace.** The same command with `--archive <name it printed> --apply --confirm <code> --pr <A6 pull request>`. One transaction under the runner's advisory lock: the history is read again and the code recomputed (a row added or the file changed since the dry run refuses everything); the baseline is verified again inside the transaction; `create table supabase_migrations.<archive> as table supabase_migrations.schema_migrations`; the archive must hold the dry run's count; every history row is deleted; the baseline's row is inserted exactly as `--record-only` writes one (its mark, the provenance line, the file); the history must be that one row and the archive still the count. Any assertion failing rolls the whole transaction back. It prints `replaced: before N, archived N …, after 1`.
5. **After.** `--status` again, kept as `after-<name>.json`. Expected: `count` 1, `newest` the baseline's version, `missing` and `extra` empty.
6. **Record.** Both `--status` outputs and the three counts (before, archived, after) go in the pull request and in `docs/plans/2026-11-remediation-record.md`; the baseline's cell in `supabase/MIGRATIONS.md` becomes `staging <date>; shared-dev <date>`.

Then shared dev, the same six steps, expecting 291.

**How it is undone**, on one database:

```bash
node scripts/baseline/replace-history.mjs --target <name> --env-file <env> --undo <archive table>                       # dry run, read only
node scripts/baseline/replace-history.mjs --target <name> --env-file <env> --undo <archive table> --apply --confirm <code>
```

One transaction: the baseline's row is deleted, every archived row is put back (`insert … select * from` the archive), and the count must equal the archive's. The archive table is kept; dropping it is a later, separate decision.

**Rehearsed** on a throwaway database built from the 298 files (port 55440) with a 298-row history in shared dev's column shape (`created_by`, `idempotency_key`, `rollback` as well): a wrong code and a row added after the dry run each refused with nothing changed; the replace gave before 298, archived 298, after 1, with 3,727 objects verified inside the transaction; the runner's status of that history is `count 1, missing [], extra []`; a second replace refused because the archive exists; one function body changed on the database made the verification refuse (`differs: function private.prune_cron_history()`); the undo put back the same 298 rows (the same hash of versions and names).

## Step 6: what moved with the files (in the A6 pull request)

- The 298 files moved unchanged to `supabase/migrations-archive/`, with the record as it stood (`supabase/migrations-archive/MIGRATIONS.md`). `supabase/migrations/` holds the baseline alone. `tests/ci/migration-order.test.ts` lets a file leave `supabase/migrations/` only into the archive with the same bytes, and never lets the archive change; PR #198's named exception went with the history.
- `supabase/MIGRATIONS.md` collapsed to the rules, the runner's description and the baseline's row; `supabase/migrations-md-baseline.json` is empty; `supabase/migration-targets.json`'s allow-list is empty (its two files are archived).
- The curated vehicle generations moved byte for byte to `supabase/reference/curated-vehicle-generations.sql`; `GENERATIONS_MIGRATION` points there; `tests/ci/vehicle-catalog.test.ts` holds the extracted text to the archived migration's and to a pinned hash, so the import's confirmation code is unchanged.
- The tests that read a named migration read `supabase/schema/` (the function, table or trigger as the database holds it): the privacy page, agent measures, tool audit vocabulary, write quotas, job inventory, listing arrivals, the category constraint, notification kinds, payout hold and photo positions. `tests/ci/migration-objects.test.ts` reads the archive and, separately, the baseline (every function with a body); `tests/ci/apply-migration.test.ts` takes the baseline as the destructive file; `tests/ci/baseline-generator.test.ts` reads A3's statements from the archive.
- The baseline tools read the archive once it exists (`build-baseline.mjs` for its header, `prove.sh` to build A, `classify-migration-statements.mjs`). `scripts/disposable-db.sh` with no files, CI's `sql-guard`, the browser and Stripe jobs (`supabase start`), `build-info`, the release candidate and the perf scripts read the folder and so now build from the baseline.

## What the old recorded names do now (ruling (c))

- **The runner on shared dev and staging after step 5:** the history holds only the baseline's version; `--status` reports nothing missing or extra; a later migration sorts after the baseline and applies normally.
- **The runner on either database if step 5 had not been done:** the baseline shows as missing, and because it is marked as a baseline the runner refuses it on a database with tables (as the file itself would). That refusal is the safety net and stays.
- **`supabase start` on a new local stack:** no history, so it applies the one file.
- **`supabase start` on an existing local volume** (one that recorded the old names): it would try to run the baseline over a full schema, and the baseline refuses with its own message. Run `npx supabase db reset` once after pulling A6; it rebuilds the local database from the baseline (local data is lost). Said in `supabase/MIGRATIONS.md`.

## Drafts #207 and #209

Two set-aside drafts carry migrations written before A6: #207 (`20261110180000_chargeback_write_off.sql`) and #209 (`20261110200000_copyright_counter_notice.sql`). Neither is applied anywhere (both databases' histories end at `20261111120000`). After A6 merges, each must be rebased onto the new `main` and its file re-dated after the baseline (rule R3, when it is next to merge): `tests/ci/migration-order.test.ts` refuses a file dated at or before the newest on `main`, and that is the baseline. Each also needs its own section and row in the new `supabase/MIGRATIONS.md`, and `npm run db:schema` after it. Their SQL needs no other change: the baseline builds the same database the old files did.

## The production database

`docs/production-runbook.md` §2: apply the baseline (plus anything dated after it) with the runner, then at once, before anything else touches the database, render it as the snapshot folder read-only and compare it with the stack build of the same baseline; a difference outside the expected list stops the launch of that database (ruling (d)).

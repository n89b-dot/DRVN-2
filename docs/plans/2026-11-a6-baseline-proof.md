# A6: the proof that one file builds the same database

**Status: the proof, run on 11 November 2026** against the 298 files on `main` at `d13f5a2f` (A1, A2 and A3 in them), on two throwaway databases on one Mac (guard build), and on GitHub for the stack build (below). It replaces the trial of 10 November (287 files). The baseline proven is `supabase/migrations/20261111130000_baseline.sql`: 39,874 lines, sha256 `09abd84753efe041eb9237247b438c338117aa899e13d1c12456afc0e98bc75b`; 564 functions, 146 tables, 143 policies, 289 triggers, 21 scheduled jobs. Nothing on this page touched shared dev or staging.

The method and its reasons are in `docs/plans/2026-11-a6-baseline-analysis.md`. This page records what was run and what came back.

## In plain words

Two databases are built from nothing. Database **A** is built the way it always has been, from every migration file in order. Database **B** is built from the one generated file alone. Then B is compared with A four different ways. If all four come back empty, the one file builds the same database.

A comparison that always says "identical" proves nothing, so B is then broken on purpose, one small fault at a time, and each fault must be reported. After each one B is put back and checked to be whole again.

## One command

```bash
bash scripts/baseline/prove.sh --generate <baseline.sql> <evidence folder>
```

It stops at the first step that fails. In order:

| Step | What it shows | Result (11 Nov, 298 files) |
|---|---|---|
| 0 | Applied by `psql` to A, which already has tables, the file refuses with its own message, and A is unchanged in all four captures | Refused (`DRVN baseline: this database already has tables in public or private…`); A identical before and after in all four captures |
| 1 | The four comparisons of A and B are empty | All four identical: 1,159 snapshot files; 476 catalog rows outside our schemas; 152 row-count and content lines; 44,278 `pg_dump` lines |
| 2 | Each of the deliberate faults is reported, and B is whole again after each | 17 of 17 reported (table below); B identical to A again after every undo |
| 3 | The migration runner's `--record-only` check reads the file and finds every object it creates on A | One outer transaction: yes. Marked as a baseline: yes. 3,727 objects checked in `auth`, `private`, `public`, `storage`; none refused |
| 4 | The generated types file is unchanged against B | Unchanged |
| 5 | Every SQL guard passes against B | 165 guards, 0 failed |

## The four comparisons

| # | What is compared | Why this one |
|---|---|---|
| 1 | Each database rendered as the snapshot folder (`supabase/schema/`): functions with their bodies, tables, every permission, policies, triggers, scheduled jobs, storage buckets, reference rows | The same tool that guards the schema every day |
| 2 | Every catalog object outside `public` and `private`, plus storage buckets, scheduled jobs and role comments | Catches anything done to the platform's own schemas, and gives buckets and jobs a second reader |
| 3 | The number of rows in every table of ours, and a hash of each reference table's rows | Rows, read without the snapshot's code |
| 4 | `pg_dump` of each, with privileges, as a sorted list of lines | A second opinion from a tool that shares no code with the snapshot |

## What is allowed to differ, and nothing else is

Each is excluded by construction and asserted, not judged by eye.

| Difference | Why it is not a difference | How the comparison treats it |
|---|---|---|
| `public.product_grow_runs`: 1 row in A, 0 in B | `supabase/migrations/20261020120000_products.sql`, line 639, runs the product grower once as a backfill (`perform public.grow_products(true)`), and every run of the grower logs one row. It is a log of work done on the database the old files built. Three things read the table and each handles "no run yet": `grow_products()` itself (no earlier run means "everything: the first run"), the admin product-coverage panel (`src/lib/admin/product-identity.ts`, shows nothing until the first nightly full run), and that migration's own self-check, which runs once. Carried, a new production database would show a full run dated the day the file was generated, which never happened there (orchestrator's ruling, 10 November) | Comparison 3 **requires** exactly `public.product_grow_runs`, 1 against 0. Any other count, or the same difference on any other table, fails |
| `public.worker_runs` | Scheduled jobs write here while a database is up (the delivery auto-confirm job, at 23 minutes past each hour). Its row count is the time of day, not the build | Left out of the row count by name. Its structure and permissions are still compared in 1 and 4 |
| Job ids, clock columns and random ids in reference rows (`updated_at`, `changed_at`, `set_at`, `announced_at`, `agent_controls.id`) | Counters, and values a default fills in at insert time | Never read: jobs are compared by name, schedule, command and active flag; reference rows without those columns |
| The order in which roles were granted | History, not state. `pg_dump` prints grants in the order they were made | Comparison 4 sorts the lines |

## The seven constraints written as BETWEEN

Seven CHECK constraints were written with `between`. PostgreSQL stores `x between a and b and …` as a pair nested inside the longer AND. `pg_dump` prints that pair, and PostgreSQL, reading it back, folds a leading pair into the outer AND: the same rule, a different stored shape, and a difference a second `pg_dump` shows. The generator writes that leading pair as BETWEEN again, for these seven and no others. It holds them by table and name (`BETWEEN_CONSTRAINTS` in `scripts/baseline/build-baseline.mjs`) and stops if it would rewrite any other, or fewer than these. Comparison 4 being empty is the proof that each rewrite is right, and it stays in the comparison set.

| Table | Constraint |
|---|---|
| `public.activity_posts` | `activity_posts_text_bounds` |
| `public.beta_invitations` | `beta_invitations_roles` |
| `public.beta_memberships` | `beta_memberships_roles` |
| `public.cars` | `cars_text_bounds` |
| `public.listings` | `listings_text_bounds` |
| `public.seller_fulfillment_profiles` | `sfp_field_lengths_check` |
| `public.settlement_settings` | `settlement_settings_auto_confirm_notice` |

## The deliberate faults

All 17 run by `scripts/baseline/fault-drill.sh` on 11 November. Each was done to B, the four comparisons run, the fault undone, and B checked to be identical to A again before the next.

| # | Fault | Reported by comparison |
|---|---|---|
| 1 | A function closed to visitors is opened to `anon` (one revoke removed) | 1, 4 |
| 2 | A function left executable through `PUBLIC` only | 1, 4 |
| 3 | A column-level grant removed | 1, 4 |
| 4 | A table visitors cannot read is opened to `anon` | 1, 4 |
| 5 | One storage rule dropped | 1, 2 |
| 6 | The sign-up trigger on `auth.users` dropped | 1, 2 |
| 7 | One scheduled job's time changed | 1, 2 |
| 8 | One scheduled job removed | 1, 2 |
| 9 | The payout hold changed by a day | 1, 3 |
| 10 | One reserved username deleted | 1, 3 |
| 11 | One index dropped | 1, 4 |
| 12 | One line of one function changed | 1, 4 |
| 13 | A storage bucket made public | 1, 2 |
| 14 | Row-level security switched off on one table | 1, 4 |
| 15 | A table added outside our schemas | 2 |
| 16 | A second row in `product_grow_runs`, the one table allowed to differ | 3 (`expected and not found: public.product_grow_runs\|1\|0`) |
| 17 | One reserved username added | 1, 3 |

Every fault but two is seen by two comparisons that share no code. The two that only one can see are by their nature: a table outside our schemas is what comparison 2 exists for, and a row in a run log is counted, not rendered.

An earlier version of this drill is worth recording. Its fault 4 "opened" `orders` to `anon`, which already holds a grant there, so the fault changed nothing; its undo then took away a real grant, and every later fault looked reported because of that leftover. The drill now checks B against A after every undo, so a fault that changes nothing, or an undo that is wrong, stops it.

## The stack build (GitHub, `baseline-proof.yml`)

Run 42950129754 on `db/a6-baseline-tools` at `fbbd1b04`, `scripts/baseline/stack-proof.sh`: two local Supabase stacks (CLI 2.116.0, real Storage and Auth, files applied as `postgres`), one after the other in one job.

| Step | Result |
|---|---|
| A: a stack from the 298 archived files | started; captured 1,159 snapshot files, 1,201 catalog rows outside our schemas, 152 row lines, 43,674 `pg_dump` lines |
| B: a stack from the baseline alone | started; captured the same counts |
| 1. The four comparisons of A and B | **all four identical** (accepted: `public.product_grow_runs\|1\|0`; not counted: `public.worker_runs`) |
| 2. May `postgres` revoke on schema `public` from `pg_database_owner`? | **Yes**: inside a rolled-back transaction the ACL of schema `public` changed (`revoke-answer.txt` in the run's artifact). The baseline's revoke is kept as it is |
| 3. The whole browser suite on B, in one run | 324 passed, 5 failed, all in offers and negotiation (`offer-action-recovery` ×2, `negotiation-three-rounds`, `seller-agent`, `buyer-agent`): an accepted offer did not reach its order. A and B are identical in all four comparisons, so the database is the one main's CI tests; these tests pass on `main`, where the suite runs as four parts, each on its own fresh stack. The same four parts run on the baseline's stack in this pull request's `ci.yml` e2e jobs, which settle it |
| 4. The Stripe lane | Not run here (the workflow reads no secret); `ci.yml`'s `stripe-integration` on this pull request runs it on a stack built from the baseline alone |

## Not proven here

- **Shared dev and staging.** Compared, read-only, in step 4 (`docs/plans/2026-11-a6-step5-runbook.md`: every function and policy identical; the differences listed there). Nothing is written to either until `APPROVED A6 STEP 5`.
- **A new hosted project.** The first real proof is the production runbook's step: apply the baseline, then run the snapshot check read-only before anything else touches the database.

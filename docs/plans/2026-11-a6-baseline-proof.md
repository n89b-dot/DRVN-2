# A6: the proof that one file builds the same database

**Status: a trial, not the proof.** This page is the form the proof takes. The numbers below come from a trial on 10 November 2026 against the 287 files then on the branch, on two throwaway databases on one Mac. The real run happens after `DATABASE FROZEN`, against the files as they stand then (with A2's and A3's migrations in them), and replaces every number here. Nothing on this page has touched shared dev or staging.

The method and its reasons are in `docs/plans/2026-11-a6-baseline-analysis.md`. This page records what was run and what came back.

## In plain words

Two databases are built from nothing. Database **A** is built the way it always has been, from every migration file in order. Database **B** is built from the one generated file alone. Then B is compared with A four different ways. If all four come back empty, the one file builds the same database.

A comparison that always says "identical" proves nothing, so B is then broken on purpose, one small fault at a time, and each fault must be reported. After each one B is put back and checked to be whole again.

## One command

```bash
bash scripts/baseline/prove.sh --generate <baseline.sql> <evidence folder>
```

It stops at the first step that fails. In order:

| Step | What it shows | Trial result |
|---|---|---|
| 0 | Applied by `psql` to A, which already has tables, the file refuses with its own message, and A is unchanged in all four captures | Refused (`DRVN baseline: this database already has tables in public or private…`); A identical before and after in all four captures |
| 1 | The four comparisons of A and B are empty | All four identical: 1,098 snapshot files; 475 catalog rows outside our schemas; 145 row-count and content lines; 41,937 `pg_dump` lines |
| 2 | Each of the deliberate faults is reported, and B is whole again after each | 16 of 16 reported (table below); B identical to A again after every undo. A seventeenth, added afterwards, was tried by hand and reported |
| 3 | The migration runner's `--record-only` check reads the file and finds every object it creates on A | One outer transaction: yes. Marked as a baseline: yes. 3,584 objects checked in `auth`, `private`, `public`, `storage`; none refused |
| 4 | The generated types file is unchanged against B | Unchanged |
| 5 | Every SQL guard passes against B | 157 guards, 0 failed |

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

Each was done to B, the four comparisons run, the fault undone, and B checked to be identical to A again before the next.

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
| 16 | One reserved username added | 1, 3 |
| 17 | A second row in `product_grow_runs`, the one table allowed to differ | 3 (`expected and not found: public.product_grow_runs\|1\|0`) |

Every fault but two is seen by two comparisons that share no code. The two that only one can see are by their nature: a table outside our schemas is what comparison 2 exists for, and a row in a run log is counted, not rendered.

An earlier version of this drill is worth recording. Its fault 4 "opened" `orders` to `anon`, which already holds a grant there, so the fault changed nothing; its undo then took away a real grant, and every later fault looked reported because of that leftover. The drill now checks B against A after every undo, so a fault that changes nothing, or an undo that is wrong, stops it.

## Not proven here

- **The stack build.** Two local Supabase stacks (real storage and sign-in tables, files applied as `postgres`), compared the same way, then the browser suite and the Stripe lane on the baseline's stack. It runs on GitHub through `.github/workflows/baseline-proof.yml`. In particular: the file revokes on schema `public` from `pg_database_owner`, which worked as `supabase_admin` here; whether `postgres` may do it is for that run to show.
- **Shared dev and staging.** Compared, read-only, in step 4 of the plan. Nothing is written to either until `APPROVED A6 STEP 5`.
- **A new hosted project.** The first real proof is the production runbook's step: apply the baseline, then run the snapshot check read-only before anything else touches the database.

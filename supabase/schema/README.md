# The database as it stands

This folder is **generated**. It is a readable copy of the database that
`supabase/migrations/` builds, kept so that anyone can read what a function,
table or policy is today, and so that a change to one shows the lines that
changed (plan 2 item A1, review finding #159). Nothing reads it at run time and
nothing applies it: the migrations are still the only way the database changes.

- **Do not edit a file here.** Change a migration, then regenerate.
- **Regenerate:** `bash scripts/disposable-db.sh start` (builds a throwaway
  database from every migration), `npm run db:schema`, then
  `bash scripts/disposable-db.sh stop`. Without Docker: push the branch, let
  the `sql-guard` job fail, and take its `schema-snapshot-<sha>` artifact as
  this folder.
- **CI checks it.** The `sql-guard` job rebuilds the database from the
  migrations and fails if this folder differs, as it does for
  `src/lib/database.generated.ts`.

## What is where

| Path | Holds |
|---|---|
| `functions/<schema>.<name>.sql` | One file per function name: its definition as Postgres stores it, its comment and who may execute it. Overloads share the file. |
| `tables/<schema>.<name>.sql` | Columns in order, constraints, indexes, row-level-security switches, comments and grants. |
| `policies/<schema>.<table>.<policy>.sql` | One row-level-security policy. Storage's rules are the `storage.objects` files. |
| `triggers/<schema>.<table>.<trigger>.sql` | One trigger. The two on `auth.users` are here too. |
| `views/`, `types/` | Views; enums, domains and composite types. |
| `sequences.sql` | Every sequence and the column that owns it. |
| `schemas.sql`, `extensions.sql`, `roles.sql`, `role-settings.sql` | Schemas and who may use them, extensions, roles a migration created, and per-role settings. |
| `default-privileges.sql` | What a newly created object is granted before any migration says otherwise. |
| `publications.sql` | Tables published for live updates. |
| `cron-jobs.sql` | Scheduled jobs: name, schedule, command. |
| `storage-buckets.sql` | Storage buckets and their limits. |
| `reference-data/<schema>.<table>.jsonl` | Rows a migration inserted (settings, switches, reserved names), one JSON object per line. |

## What is left out, on purpose

Owners, who granted a privilege, grants to the administrator roles `postgres`
and `supabase_admin`, extension versions and anything an extension owns.
These differ between CI's database and a hosted one without any migration
differing. Also left out: columns a clock or a random id fills in on insert.

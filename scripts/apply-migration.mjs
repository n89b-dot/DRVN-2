// Applies migration files over the direct pg connection: the runner documented
// in supabase/MIGRATIONS.md ("Applying a migration"). Never use `supabase db push`.
//
//   node scripts/apply-migration.mjs --target shared-dev supabase/migrations/<file>.sql
//     → dry run: checks the target and prints the plan and a confirmation code
//   node scripts/apply-migration.mjs --target shared-dev --apply --confirm <code> supabase/migrations/<file>.sql
//     → applies each file in one transaction with its history row
//   node scripts/apply-migration.mjs --target shared-dev --status
//     → read-only: prints {target, applied, onDisk, missing, extra, newest, count} as JSON
//
// Reads SUPABASE_DB_PASSWORD and NEXT_PUBLIC_SUPABASE_URL from .env.local (or
// --env-file). The target must be on supabase/migration-targets.json and be
// the project the env file points at. The logic lives in
// scripts/lib/migration-runner.mjs.
import { run } from "./lib/migration-runner.mjs";

process.exitCode = await run(process.argv.slice(2));

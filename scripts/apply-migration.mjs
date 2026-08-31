// Applies one migration file over the direct pg connection — the runner
// documented in supabase/MIGRATIONS.md ("Applying without Docker or psql").
// Usage: node scripts/apply-migration.mjs supabase/migrations/00NN_name.sql
// Reads SUPABASE_DB_PASSWORD from .env.local. Never use `supabase db push`.
import { readFileSync } from "node:fs";
import { Client } from "pg";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/apply-migration.mjs <migration.sql>");
  process.exit(1);
}
const env = readFileSync(".env.local", "utf8");
const pwd = env.match(/^SUPABASE_DB_PASSWORD=(.+)$/m)?.[1]?.trim();
const ref =
  env.match(/^NEXT_PUBLIC_SUPABASE_URL=https:\/\/([a-z0-9]+)\.supabase\.co/m)?.[1];
if (!pwd || !ref) {
  console.error("need SUPABASE_DB_PASSWORD and NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}
const client = new Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(pwd)}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
client.on("notice", (n) => console.log("NOTICE:", n.message));
await client.connect();
await client.query(readFileSync(file, "utf8"));
// PostgREST caches the schema; without this, new columns/tables 404 from the
// API (PGRST204) until the project restarts — a silent, confusing failure.
await client.query("notify pgrst, 'reload schema'");
await client.end();
console.log("applied:", file, "(PostgREST schema reload notified)");

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
// Never infer a linked project. CI can explicitly select its loopback container.
// 55440 to 55442 are the throwaway databases of scripts/disposable-db.sh.
const databaseUrl = process.env.DRVN_TYPES_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const target = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(target.hostname) || !["5432", "54322", "55440", "55441", "55442"].includes(target.port)) throw new Error("Schema generation requires an explicit local disposable database");
const result = execFileSync("npx", ["--yes", "supabase@2.116.0", "gen", "types", "typescript", "--db-url", databaseUrl, "--schema", "public", "--agent", "no"], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" }, maxBuffer: 4 * 1024 * 1024 });
if (!result.startsWith("export type Json =") || !result.includes("worker_health_snapshot:")) throw new Error("Type generation returned an incomplete schema");
const output = "// Generated from the isolated database after applying all migrations.\n" + result;
const destination = "src/lib/database.generated.ts";
if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== output) {
    // CI keeps what the generator produced, so a branch can adopt it exactly.
    if (process.env.DRVN_TYPES_MISMATCH_OUT) writeFileSync(process.env.DRVN_TYPES_MISMATCH_OUT, output);
    throw new Error("Generated schema differs: run npm run db:types (in CI, take the database-generated artifact)");
  }
} else writeFileSync(destination, output);

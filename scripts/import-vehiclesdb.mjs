// Fills or refreshes DRVN's vehicle catalogue (0041: catalog_makes,
// catalog_models) from VehiclesDB's car catalogue, then re-runs the curated
// generations seed (20261020100000) so generations exist for the imported
// models (report five #119). Data: https://github.com/vehiclesdb/vehiclesdb,
// CC-BY 4.0 (attribution "Vehicle data by VehiclesDB", linked; see
// docs/site/vehicles.md), pinned to one release by commit and file hash in
// scripts/lib/vehicle-catalog.mjs.
//
// Safe to re-run: pure upserts keyed on vdb_id / case-insensitive name;
// vPIC-seeded rows are enriched, never duplicated; the generations seed is
// `on conflict do nothing`.
//
// Usage:
//   node scripts/import-vehiclesdb.mjs --target <name> [--env-file <path>]           dry run: fetch, verify, count
//   node scripts/import-vehiclesdb.mjs --target <name> [--env-file <path>] --apply --confirm <code>
//     import, then seed generations; the code is the one the dry run printed
//
// Reads SUPABASE_DB_PASSWORD and NEXT_PUBLIC_SUPABASE_URL from the env file
// (default .env.local), the way scripts/apply-migration.mjs does. The target
// must be on supabase/migration-targets.json and be the project the env file
// points at; the connection is direct and verifies the server's certificate.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { Client } from "pg";

import { directClientConfig, loadTargets, readDbEnv, resolveTarget } from "./lib/supabase-db.mjs";
import { VEHICLESDB, generationSeedSql, importConfirmationCode, makePopularity, verifiedJson, vehiclesDbUrl } from "./lib/vehicle-catalog.mjs";

const { values } = parseArgs({
  options: {
    target: { type: "string" },
    "env-file": { type: "string", default: ".env.local" },
    apply: { type: "boolean", default: false },
    confirm: { type: "string" },
  },
});
const { password: pwd, ref } = readDbEnv(readFileSync(values["env-file"], "utf8"));
if (!pwd || !ref) {
  console.error(`need SUPABASE_DB_PASSWORD and NEXT_PUBLIC_SUPABASE_URL in ${values["env-file"]}`);
  process.exit(1);
}
let target;
try {
  target = resolveTarget({ targets: loadTargets(), name: values.target, envRef: ref });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function fetchPinned(file) {
  const res = await fetch(vehiclesDbUrl(file));
  if (!res.ok) throw new Error(`${vehiclesDbUrl(file)} answered ${res.status}`);
  return verifiedJson(file, new Uint8Array(await res.arrayBuffer()));
}

const [makes, models] = await Promise.all([fetchPinned("catalog/car/makes.json"), fetchPinned("catalog/car/models.json")]);
const version = VEHICLESDB.release;
const seedSql = generationSeedSql();
console.log(`VehiclesDB ${version} (${VEHICLESDB.commit.slice(0, 7)}, hashes verified): ${makes.length} car makes, ${models.length} car models`);
console.log(`target: ${target.name} (${target.ref}) at ${target.host}`);

const client = new Client(directClientConfig({ host: target.host, password: pwd, applicationName: "drvn-import-vehiclesdb" }));
await client.connect();

async function totals() {
  const { rows } = await client.query(
    `select (select count(*) from public.catalog_makes)::int as makes,
            (select count(*) from public.catalog_models)::int as models,
            (select count(*) from public.vehicle_generations)::int as generations`,
  );
  return rows[0];
}

const before = await totals();
console.log(`catalogue now: ${before.makes} makes, ${before.models} models, ${before.generations} generations`);
const code = importConfirmationCode(target.ref, seedSql);
if (!values.apply) {
  console.log(`Dry run: nothing was changed. To import and seed generations, re-run with --apply --confirm ${code}`);
  await client.end();
  process.exit(0);
}
if (values.confirm !== code) {
  console.error(values.confirm
    ? "--confirm doesn't match this project and this release: run the dry run again"
    : "--apply needs --confirm <code>: run the dry run first, read it, then pass the code it prints");
  await client.end();
  process.exit(1);
}

const popularity = makePopularity(models);
await client.query("begin");
try {
  let makesUpserted = 0;
  const makeIdByVdb = new Map();
  for (const make of makes) {
    const { rows } = await client.query(
      `insert into public.catalog_makes (name, vdb_id, popularity_decile, source, source_version)
       values ($1, $2, $3, 'vehiclesdb', $4)
       on conflict (lower(name)) do update
         set name = excluded.name, -- VehiclesDB casing is canonical ("BMW", not vPIC's "Bmw")
             vdb_id = excluded.vdb_id,
             popularity_decile = coalesce(excluded.popularity_decile, public.catalog_makes.popularity_decile),
             source_version = excluded.source_version,
             updated_at = now()
       returning id`,
      [make.name, make.id, popularity.get(make.id) ?? null, version],
    );
    makeIdByVdb.set(make.id, rows[0].id);
    makesUpserted += 1;
  }
  console.log(`makes upserted: ${makesUpserted}`);

  let modelsUpserted = 0;
  let skippedNoMake = 0;
  for (const model of models) {
    const makeId = makeIdByVdb.get(model.make_id);
    if (!makeId) {
      skippedNoMake += 1;
      continue;
    }
    const aliases = Array.isArray(model.aliases) && model.aliases.length ? model.aliases : null;
    await client.query(
      `insert into public.catalog_models (make_id, name, vdb_id, aliases, popularity_decile, source, source_version)
       values ($1, $2, $3, $4, $5, 'vehiclesdb', $6)
       on conflict (make_id, lower(name)) do update
         set name = excluded.name,
             vdb_id = excluded.vdb_id,
             aliases = excluded.aliases,
             popularity_decile = coalesce(excluded.popularity_decile, public.catalog_models.popularity_decile),
             source_version = excluded.source_version,
             updated_at = now()`,
      [makeId, model.name, model.id, aliases, model.popularity?.global_decile ?? null, version],
    );
    modelsUpserted += 1;
  }
  console.log(`models upserted: ${modelsUpserted}, skipped (unknown make): ${skippedNoMake}`);

  // The curated generations seed and its backfill, straight from the migration.
  await client.query(seedSql);
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(`import failed and was rolled back: ${error.message}`);
  await client.end();
  process.exit(1);
}

const after = await totals();
console.log(`catalogue now: ${after.makes} makes, ${after.models} models, ${after.generations} generations`);
if (after.generations === 0) console.error("warning: no generations after the seed; check the curated makes and models exist");
await client.end();

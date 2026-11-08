// Imports/refreshes the car-kind VehiclesDB catalog into DRVN's canonical
// catalog tables (0041). Data: https://github.com/vehiclesdb/vehiclesdb —
// CC-BY 4.0 (attribution: "Vehicle data by VehiclesDB", linked; see
// docs/site/vehicles.md). Safe to re-run: pure upserts keyed on vdb_id /
// case-insensitive name; vPIC-seeded rows are enriched, never duplicated.
//
// Usage: node scripts/import-vehiclesdb.mjs --target <name>
// Reads SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL from .env.local. The
// target must be on supabase/migration-targets.json and be the project
// .env.local points at; the connection verifies the server's certificate.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { Client } from "pg";

import { directClientConfig, loadTargets, readDbEnv, resolveTarget } from "./lib/supabase-db.mjs";

const RAW = "https://raw.githubusercontent.com/vehiclesdb/vehiclesdb/main/catalog/car";

const { values } = parseArgs({ options: { target: { type: "string" } } });
const { password: pwd, ref } = readDbEnv(readFileSync(".env.local", "utf8"));
if (!pwd || !ref) {
  console.error("need SUPABASE_DB_PASSWORD and NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}
let target;
try {
  target = resolveTarget({ targets: loadTargets(), name: values.target, envRef: ref });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const [makes, models, manifest] = await Promise.all([
  fetch(`${RAW}/makes.json`).then((r) => r.json()),
  fetch(`${RAW}/models.json`).then((r) => r.json()),
  fetch("https://raw.githubusercontent.com/vehiclesdb/vehiclesdb/main/dist/manifest.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
]);
const version = manifest?.version ?? "unknown";
console.log(`VehiclesDB ${version}: ${makes.length} car makes, ${models.length} car models`);

// Make popularity: a make is as popular as its catalog is — score by how many
// broadly popular models it has (weighted toward decile 1–3), then convert the
// ranking into deciles. "Best single model decile" made one-hit small-market
// marques (Aion, EBRO) outrank Volkswagen.
const makeScore = new Map();
for (const model of models) {
  const decile = model.popularity?.global_decile;
  if (decile == null) continue;
  const weight = decile <= 3 ? 4 - decile : decile <= 6 ? 0.5 : 0.1;
  makeScore.set(model.make_id, (makeScore.get(model.make_id) ?? 0) + weight);
}
const rankedMakes = [...makeScore.entries()].sort((a, b) => b[1] - a[1]);
const makePopularity = new Map(
  rankedMakes.map(([id], index) => [
    id,
    Math.min(10, Math.floor((index / rankedMakes.length) * 10) + 1),
  ]),
);

const client = new Client(
  directClientConfig({ host: target.host, password: pwd, applicationName: "drvn-import-vehiclesdb" }),
);
await client.connect();

let makesUpserted = 0;
const makeIdByVdb = new Map();
for (const make of makes) {
  const decile = makePopularity.get(make.id) ?? null;
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
    [make.name, make.id, decile, version],
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

const { rows: totals } = await client.query(
  `select (select count(*) from public.catalog_makes) as makes,
          (select count(*) from public.catalog_models) as models`,
);
console.log(`catalog now holds ${totals[0].makes} makes / ${totals[0].models} models`);
await client.end();

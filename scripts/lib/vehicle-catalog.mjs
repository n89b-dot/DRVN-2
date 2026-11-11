// The pieces of scripts/import-vehiclesdb.mjs that can be tested without a
// network or a database (report five #119).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The VehiclesDB release the catalogue is built from, pinned to a commit and
 * to the exact bytes of each file. Moving to a newer release is a reviewed PR
 * that changes all four values together (docs/production-runbook.md,
 * "Vehicle catalogue").
 */
export const VEHICLESDB = {
  release: "2026.10.4",
  commit: "d0e40c9661e36931089db1213ac383d2d7ba5a7a",
  files: {
    "catalog/car/makes.json": "c8bf58a58afe159dddfdd06f1e8d7a533fa9865c5e013568df373b06395b55ba",
    "catalog/car/models.json": "6f9b9b53f9cf51d8ce153a7ca0ee4914ac6acde7ebdd5bcf13c4b4bcf7ad62f8",
  },
};

/** @typedef {{ release?: string, commit: string, files: Record<string, string> }} PinnedSource */

/**
 * @param {string} file
 * @param {PinnedSource} [source]
 */
export function vehiclesDbUrl(file, source = VEHICLESDB) {
  return `https://raw.githubusercontent.com/vehiclesdb/vehiclesdb/${source.commit}/${file}`;
}

/**
 * Parses a fetched file, refusing any bytes that are not the pinned ones.
 *
 * @param {string} file
 * @param {Uint8Array} bytes
 * @param {PinnedSource} [source]
 */
export function verifiedJson(file, bytes, source = VEHICLESDB) {
  const expected = source.files[file];
  if (!expected) throw new Error(`${file} is not a pinned VehiclesDB file`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`${file} at ${source.commit.slice(0, 7)} has sha256 ${actual}, not the pinned ${expected}: refusing to import`);
  }
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

/**
 * Make popularity: a make is as popular as its catalogue is. Score by how
 * many broadly popular models it has (weighted toward deciles 1–3), then turn
 * the ranking into deciles. "Best single model decile" made one-hit
 * small-market marques (Aion, EBRO) outrank Volkswagen.
 */
export function makePopularity(models) {
  const makeScore = new Map();
  for (const model of models) {
    const decile = model.popularity?.global_decile;
    if (decile == null) continue;
    const weight = decile <= 3 ? 4 - decile : decile <= 6 ? 0.5 : 0.1;
    makeScore.set(model.make_id, (makeScore.get(model.make_id) ?? 0) + weight);
  }
  const ranked = [...makeScore.entries()].sort((a, b) => b[1] - a[1]);
  return new Map(ranked.map(([id], index) => [id, Math.min(10, Math.floor((index / ranked.length) * 10) + 1)]));
}

// Plan 2 item A6 (N1075): the curated list left the migration history, byte
// for byte, when the history became one baseline; the old migration is kept in
// supabase/migrations-archive/. The name stays so callers do not change.
export const GENERATIONS_MIGRATION = path.join(repoRoot, "supabase/reference/curated-vehicle-generations.sql");
const SEED_START = "-- ---------- curated seed ----------";
const SEED_END = "-- ---------- end of curated seed ----------";

/**
 * The curated generations seed and the cars backfill, verbatim (they were the
 * generations migration's, 20261020100000). The seed joins to the catalogue,
 * so on a new project (empty catalogue) it inserts nothing; re-running exactly
 * these statements after an import fills it in. Both are idempotent (`on
 * conflict do nothing`, and an update that writes only cars whose answer
 * changes). One copy of the curated list, in supabase/reference/.
 */
export function generationSeedSql(text = readFileSync(GENERATIONS_MIGRATION, "utf8")) {
  const start = text.indexOf(SEED_START);
  const end = text.indexOf(SEED_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error("the curated generations file no longer has its curated seed between the markers");
  }
  const sql = text.slice(start, end).trim();
  if (!/insert into public\.vehicle_generations/.test(sql) || !/on conflict \(model_id, lower\(name\)\) do nothing/.test(sql)) {
    throw new Error("the generations seed is not the idempotent insert this script expects");
  }
  return sql;
}

const CURATED_VALUES_START = "from (values";
const CURATED_VALUES_END = ") as s(make, model, name, platform_code, year_start, year_end)";

/**
 * Work review #141: which curated generations find a catalogue model, asked
 * of the database with the seed's own join (`lower(make)`, `lower(model)`),
 * so the answer is the one the seed will get. The seed is an inner join: a
 * curated row whose make or model the catalogue lacks is dropped without a
 * word, and the import used to warn only when nothing at all was seeded.
 *
 * One read-only statement. `$1` is a JSON array of `{make, model}` the
 * catalogue is about to gain (the VehiclesDB release, on a dry run), or `[]`
 * to ask about the catalogue as it stands (after an import). Returns one row
 * per curated generation: make, model, name, matched.
 */
export function curatedCoverageSql(seedSql = generationSeedSql()) {
  const start = seedSql.indexOf(CURATED_VALUES_START);
  const end = seedSql.indexOf(CURATED_VALUES_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error("the generations seed no longer lists its curated rows as `from (values …) as s(make, model, name, platform_code, year_start, year_end)`");
  }
  const values = seedSql.slice(start + CURATED_VALUES_START.length, end).trim();
  return `with incoming as (
  select lower(v.make) as make, lower(v.model) as model
    from jsonb_to_recordset($1::jsonb) as v(make text, model text)
), have as (
  select lower(mk.name) as make, lower(cm.name) as model
    from public.catalog_models cm join public.catalog_makes mk on mk.id = cm.make_id
  union
  select make, model from incoming
)
select s.make, s.model, s.name,
       exists (select 1 from have h where h.make = lower(s.make) and h.model = lower(s.model)) as matched
  from (values
${values}
) as s(make, model, name, platform_code, year_start, year_end)
 order by s.make, s.model, s.year_start, s.name`;
}

/**
 * The `{make, model}` pairs a VehiclesDB release will add, by the same rule
 * the import applies: a model whose make is not in the release is skipped.
 *
 * @param {Array<{ id: unknown, name: string }>} makes
 * @param {Array<{ make_id: unknown, name: string }>} models
 */
export function incomingPairs(makes, models) {
  const makeName = new Map(makes.map((make) => [make.id, make.name]));
  return models.filter((model) => makeName.has(model.make_id)).map((model) => ({ make: makeName.get(model.make_id), model: model.name }));
}

/**
 * Sums the coverage query's rows: how many curated generations matched, and
 * the catalogue models that are missing with the generations each would
 * have had, in the order the query returned them.
 *
 * @param {Array<{ make: string, model: string, name: string, matched: boolean }>} rows
 */
export function summariseCoverage(rows) {
  const models = new Map();
  for (const row of rows) {
    const key = `${row.make}\u0000${row.model}`;
    const entry = models.get(key) ?? { make: row.make, model: row.model, matched: row.matched === true, generations: [] };
    entry.generations.push(row.name);
    models.set(key, entry);
  }
  const all = [...models.values()];
  const missed = all.filter((entry) => !entry.matched);
  return {
    rows: rows.length,
    matchedRows: rows.filter((row) => row.matched === true).length,
    models: all.length,
    matchedModels: all.length - missed.length,
    missed: missed.map(({ make, model, generations }) => ({ make, model, generations })),
  };
}

/**
 * The coverage as the lines the import prints. `when` says which catalogue
 * was asked: "after this import" on a dry run, "now" after an apply.
 *
 * @param {ReturnType<typeof summariseCoverage>} coverage
 * @param {string} when
 */
export function coverageLines(coverage, when) {
  const lines = [
    `curated generations: ${coverage.matchedRows} of ${coverage.rows} match a catalogue model ${when} (${coverage.matchedModels} of ${coverage.models} curated models)`,
  ];
  if (coverage.missed.length) {
    lines.push(`no catalogue model ${when} for ${coverage.missed.length} curated model(s); their ${coverage.rows - coverage.matchedRows} generation(s) are not seeded:`);
    for (const miss of coverage.missed) lines.push(`  ${miss.make} ${miss.model}: ${miss.generations.join(", ")}`);
  }
  return lines;
}

/**
 * The code a dry run prints and `--apply --confirm <code>` must repeat, as
 * scripts/apply-migration.mjs does (#119 review): bound to the project and
 * to every byte this run would write from (the pinned release and the
 * generations seed), so an apply can only do what a dry run showed.
 *
 * @param {string} ref
 * @param {string} seedSql
 * @param {PinnedSource} [source]
 */
export function importConfirmationCode(ref, seedSql, source = VEHICLESDB) {
  const hash = createHash("sha256").update(`drvn-import-vehiclesdb v1\n${ref}\n${source.commit}\n`);
  for (const [file, sha] of Object.entries(source.files).sort()) hash.update(`${file} ${sha}\n`);
  hash.update(createHash("sha256").update(seedSql).digest("hex"));
  return hash.digest("hex").slice(0, 12);
}


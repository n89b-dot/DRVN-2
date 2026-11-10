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

export const GENERATIONS_MIGRATION = path.join(repoRoot, "supabase/migrations/20261020100000_vehicle_generations.sql");
const SEED_START = "-- ---------- curated seed ----------";
const SEED_END = "-- ============================================================\n-- Self-checks";

/**
 * The generations migration's curated seed and backfill, verbatim. Its seed
 * joins to the catalogue, so on a new project (empty catalogue) it inserts
 * nothing; re-running exactly these statements after an import fills it in.
 * Both are idempotent (`on conflict do nothing`, and an update that writes
 * only cars whose answer changes). Taking them from the migration keeps one
 * copy of the curated list.
 */
export function generationSeedSql(text = readFileSync(GENERATIONS_MIGRATION, "utf8")) {
  const start = text.indexOf(SEED_START);
  const end = text.indexOf(SEED_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error("the generations migration no longer has its curated seed between the markers");
  }
  const sql = text.slice(start, end).trim();
  if (!/insert into public\.vehicle_generations/.test(sql) || !/on conflict \(model_id, lower\(name\)\) do nothing/.test(sql)) {
    throw new Error("the generations seed is not the idempotent insert this script expects");
  }
  return sql;
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


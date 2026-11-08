#!/usr/bin/env node
/**
 * N232: after a database restore, do photo references and Storage agree?
 *
 * A database restore rolls back the rows that name photos and Storage's own
 * object rows (storage.objects) to the recovery point. The bytes live outside
 * the database and are not rolled back, so afterwards:
 *   - a reference may name an object with no row (it was never restored);
 *   - a restored row may have no bytes (deleted after the recovery point);
 *   - bytes uploaded after the recovery point sit in the bucket with no row
 *     (invisible to the app; not found by this check, see the runbook).
 *
 * READ-ONLY, always. It reports; restoring object versions and reapplying
 * deletions are the operator's steps in docs/production-runbook.md §6.
 *
 *   1. storage_reference_report (20261108120020): references with no object
 *      row, and member-media objects nothing names, with samples.
 *   2. With --verify-bytes: every object row in the member media buckets is
 *      read through the Storage API with a one-byte ranged GET, so a row
 *      whose bytes are gone is found. (A HEAD answers from the database row
 *      alone and would call such an object present.)
 *      is found.
 *
 * Usage (from the repo root, against an explicitly named project):
 *   DRVN_MEDIA_PROJECT_URL=$NEXT_PUBLIC_SUPABASE_URL node scripts/owner/storage-reference-check.mjs
 *   ... --verify-bytes          also check each object's bytes exist
 *   ... --bucket message-photos  only this bucket for --verify-bytes
 *   ... --limit 20000           objects --verify-bytes checks (default 50000)
 *   ... --sample 50             paths listed per finding (default 20)
 *   ... --json                  print the full result as JSON
 *
 * Exits 1 when a reference has no object or an object row has no bytes.
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from the
 * environment, never from argv.
 */
import { fileURLToPath } from "node:url";

export const MEDIA_BUCKETS = [
  "avatars",
  "car-images",
  "activity-images",
  "listing-images",
  "dispute-evidence",
  "message-photos",
  "agent-chat-photos",
];
const PAGE = 500;

export function parseArgs(argv) {
  const options = { verifyBytes: false, buckets: [...MEDIA_BUCKETS], limit: 50_000, sample: 20, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };
    const whole = (raw, max) => {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${arg} must be a whole number from 0 to ${max}`);
      return n;
    };
    if (arg === "--verify-bytes") options.verifyBytes = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--bucket") {
      const bucket = value();
      if (!MEDIA_BUCKETS.includes(bucket)) throw new Error(`--bucket must be one of ${MEDIA_BUCKETS.join(", ")}`);
      options.buckets = [bucket];
    } else if (arg === "--limit") options.limit = whole(value(), 10_000_000);
    else if (arg === "--sample") options.sample = whole(value(), 500);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

/**
 * Every object row in the chosen buckets, up to the limit, checked for bytes.
 * `unknown` counts objects the Storage API couldn't answer for (not proof
 * either way); `missing` only those it said aren't there.
 */
export async function verifyBytes(deps, options) {
  const result = { checked: 0, missing: 0, unknown: 0, missingSample: [], unknownSample: [], complete: true };
  let budget = options.limit;
  for (const bucket of options.buckets) {
    let after = null;
    for (;;) {
      if (budget === 0) {
        result.complete = false;
        return result;
      }
      const asked = Math.min(PAGE, budget);
      const { data, error } = await deps.rpc("storage_object_rows", { p_bucket: bucket, p_after: after, p_limit: asked });
      if (error) throw new Error(`listing ${bucket} failed: ${error.message}`);
      const page = data ?? [];
      for (const row of page) {
        result.checked += 1;
        const state = await deps.probe(bucket, row.path);
        if (state === "missing") {
          result.missing += 1;
          if (result.missingSample.length < options.sample) result.missingSample.push({ bucket, path: row.path });
        } else if (state !== "present") {
          result.unknown += 1;
          if (result.unknownSample.length < options.sample) result.unknownSample.push({ bucket, path: row.path });
        }
      }
      budget -= page.length;
      if (page.length < asked) break;
      after = page[page.length - 1].path;
    }
  }
  return result;
}

/**
 * Reads the first byte of one object (`Range: bytes=0-0`). Storage has to
 * fetch the bytes to answer, unlike a HEAD, which it answers from
 * storage.objects. 200/206: the bytes are there; 416: an empty object, still
 * there; 404/400: Storage can't find them; anything else, or no answer,
 * proves nothing either way.
 */
export async function probeBytes(fetchImpl, projectUrl, key, bucket, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  let response;
  try {
    response = await fetchImpl(`${projectUrl.replace(/\/$/, "")}/storage/v1/object/authenticated/${bucket}/${encoded}`, {
      method: "GET",
      headers: { authorization: `Bearer ${key}`, apikey: key, range: "bytes=0-0" },
    });
  } catch {
    return "unknown";
  }
  try {
    await response.body?.cancel?.();
  } catch {
    // Nothing to release.
  }
  if (response.status === 200 || response.status === 206 || response.status === 416) return "present";
  if (response.status === 404 || response.status === 400) return "missing";
  return "unknown";
}

export function describe(report, bytes) {
  const lines = [
    `${report.references} referenced objects; ${report.missingObjects} with no object row in Storage and no reason to be gone; ` +
      `${report.unreferencedObjects} member-media objects nothing names (uploads still staged not counted).`,
  ];
  const byBucket = (counts) => Object.entries(counts ?? {}).map(([bucket, n]) => `${bucket} ${n}`).join(", ");
  if (report.missingObjects) {
    lines.push(`  Missing, by bucket: ${byBucket(report.missingByBucket)}`);
    for (const m of report.missingSample ?? []) lines.push(`    ${m.bucket}/${m.path}  (named by ${m.sources.join(", ")})`);
  }
  if (report.expectedMissing) {
    // Gone on purpose; restoring these would undo a promised deletion.
    lines.push(`  Gone on purpose, not to restore: ${report.expectedMissing} (${byBucket(report.expectedMissingByReason)})`);
    for (const e of report.expectedMissingSample ?? []) lines.push(`    ${e.bucket}/${e.path}  (${e.reason})`);
  }
  if (report.unreferencedObjects) {
    lines.push(`  Unreferenced, by bucket: ${byBucket(report.unreferencedByBucket)}`);
    for (const u of report.unreferencedSample ?? []) lines.push(`    ${u.bucket}/${u.path}`);
  }
  if (bytes) {
    lines.push(
      `Bytes: ${bytes.checked} object rows checked, ${bytes.missing} with no bytes, ${bytes.unknown} unanswered` +
        (bytes.complete ? "." : " (stopped at --limit; run again with a higher one).")
    );
    for (const m of bytes.missingSample) lines.push(`    no bytes: ${m.bucket}/${m.path}`);
    for (const u of bytes.unknownSample) lines.push(`    unanswered: ${u.bucket}/${u.path}`);
  }
  return lines.join("\n");
}

/** 1 when anything is missing or unproven; 0 when references and bytes agree. */
export function exitCode(report, bytes) {
  if (report.missingObjects > 0) return 1;
  if (bytes && (bytes.missing > 0 || bytes.unknown > 0 || !bytes.complete)) return 1;
  return 0;
}

const HELP = "Usage: DRVN_MEDIA_PROJECT_URL=<project url> node scripts/owner/storage-reference-check.mjs [--verify-bytes] [--bucket B] [--limit N] [--sample N] [--json]";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || process.env.DRVN_MEDIA_PROJECT_URL !== url) {
    throw new Error("Set DRVN_MEDIA_PROJECT_URL to the same project as NEXT_PUBLIC_SUPABASE_URL, with SUPABASE_SECRET_KEY");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: report, error } = await admin.rpc("storage_reference_report", { p_sample: options.sample });
  if (error || !report) throw new Error(`storage_reference_report failed: ${error?.message ?? "no answer"}`);
  const bytes = options.verifyBytes
    ? await verifyBytes(
        {
          rpc: (name, args) => admin.rpc(name, args),
          probe: (bucket, path) => probeBytes(fetch, url, key, bucket, path),
        },
        options
      )
    : null;
  if (options.json) console.log(JSON.stringify({ project: url, report, bytes }, null, 2));
  else console.log(`${url}\n${describe(report, bytes)}`);
  process.exitCode = exitCode(report, bytes);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

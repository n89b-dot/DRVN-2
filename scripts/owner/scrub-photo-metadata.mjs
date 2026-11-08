#!/usr/bin/env node
/**
 * N627: re-encodes stored message and chat photos that still carry metadata.
 *
 * Message photos went into the private `message-photos` bucket straight from
 * the browser until 20261005100000 made the server's Sharp re-encode the only
 * way in, so a photo sent before then may still hold EXIF with GPS: the
 * address it was taken at, handed to whoever received it. New uploads are
 * already clean (src/app/api/media/public-photo/route.ts). This finds the
 * old ones and re-encodes each in place, at the same path and in the same
 * format, with the metadata gone (orientation is applied first, so nothing
 * turns sideways).
 *
 * Buckets: message-photos (message attachments) and agent-chat-photos (chat
 * photos, re-encoded from the start; checked for completeness). Dispute
 * evidence is never touched: it is kept exactly as uploaded, as a record. The
 * public buckets have scripts/public-media-backfill.mjs.
 *
 * Safe to stop and rerun (20261108120010):
 *   - Each object is claimed with claim_photo_rewrite under the media
 *     cleanup's per-object lock. Cleanup and the chat sweep leave it alone
 *     meanwhile, and an object cleanup has claimed or deleted is skipped.
 *   - Storage's write always upserts, so a write after a deletion (clearing a
 *     chat, account deletion, which never wait) would bring the photo back.
 *     The write is fenced on the object's identity: if it recreated the
 *     photo, finish_photo_rewrite says so and the photo is deleted again,
 *     here or, if this run dies first, by the next run.
 *   - finish_photo_rewrite records each outcome with the object's version;
 *     the next run's candidates leave out everything already settled.
 *
 * Usage (from the repo root, against an explicitly named project):
 *   DRVN_MEDIA_PROJECT_URL=$NEXT_PUBLIC_SUPABASE_URL node scripts/owner/scrub-photo-metadata.mjs
 *   ... --apply                 re-encode and record (default: a dry run that
 *                               downloads, checks and counts, and writes nothing)
 *   ... --bucket message-photos only one bucket
 *   ... --limit 500             objects to look at this run (default 1000)
 *   ... --uploaded-before 2026-10-06T00:00:00Z  only objects created before this
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from the
 * environment, never from argv.
 */
import { fileURLToPath } from "node:url";

export const BUCKETS = ["message-photos", "agent-chat-photos"];
/** Formats re-encoded to themselves; anything else is reported, not touched. */
const ENCODERS = {
  jpeg: { contentType: "image/jpeg", encode: (image) => image.jpeg({ quality: 90, mozjpeg: true }) },
  png: { contentType: "image/png", encode: (image) => image.png({ compressionLevel: 9 }) },
  webp: { contentType: "image/webp", encode: (image) => image.webp({ quality: 90 }) },
  avif: { contentType: "image/avif", encode: (image) => image.avif({ quality: 70 }) },
};
const MAX_BYTES = 25 * 1024 * 1024;
/** A rewrite lease lasts 10 minutes; never upload past half of it. */
const LEASE_BUDGET_MS = 5 * 60 * 1000;
const PAGE = 100;

export function parseArgs(argv) {
  const options = { apply: false, buckets: [...BUCKETS], limit: 1000, uploadedBefore: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === "--apply") options.apply = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--bucket") {
      const bucket = value();
      if (!BUCKETS.includes(bucket)) throw new Error(`--bucket must be one of ${BUCKETS.join(", ")}`);
      options.buckets = [bucket];
    } else if (arg === "--limit") {
      const limit = Number(value());
      if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) throw new Error("--limit must be a whole number from 1 to 100000");
      options.limit = limit;
    } else if (arg === "--uploaded-before") {
      const at = value();
      if (!Number.isFinite(Date.parse(at))) throw new Error("--uploaded-before must be a date");
      options.uploadedBefore = new Date(at).toISOString();
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

/** The private metadata a decoded image still carries, by kind. ICC colour
 *  profiles say nothing about the person and are not counted. */
export function privateMetadata(meta) {
  const kinds = [];
  if (meta.exif?.length) kinds.push("exif");
  if (meta.xmp?.length) kinds.push("xmp");
  if (meta.iptc?.length) kinds.push("iptc");
  if (meta.tifftagPhotoshop?.length) kinds.push("photoshop");
  if (Array.isArray(meta.comments) && meta.comments.length) kinds.push("comments");
  return kinds;
}

/**
 * Checks one image's bytes. `clean`: nothing to do. `dirty`: the re-encoded
 * bytes, same format, verified free of metadata. `skipped`: a format this job
 * won't re-encode (animated GIF, HEIC), for a person to look at.
 */
export async function inspectAndReencode(sharp, bytes) {
  const meta = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
  const kinds = privateMetadata(meta);
  if (!kinds.length) return { state: "clean", kinds };
  const encoder = ENCODERS[meta.format ?? ""];
  if (!encoder || (meta.pages ?? 1) > 1) return { state: "skipped", kinds, detail: `${meta.format ?? "unknown"} not re-encoded` };
  // Sharp writes no metadata unless asked to; rotate() first bakes in the
  // EXIF orientation that is about to be dropped.
  const output = await encoder.encode(sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate()).toBuffer();
  const left = privateMetadata(await sharp(output).metadata());
  if (left.length) throw new Error(`metadata survived re-encoding: ${left.join(", ")}`);
  return { state: "dirty", kinds, bytes: output, contentType: encoder.contentType };
}

function emptyCounts() {
  return { checked: 0, clean: 0, withMetadata: 0, scrubbed: 0, skipped: 0, failed: 0, busy: 0, gone: 0, leaseLost: 0, recreatedRemoved: 0 };
}

/**
 * One object. Dry run: download and check, nothing claimed or written. Apply:
 * claim, download, check, write in place if it carries metadata, record.
 *
 * Storage's write always upserts, so a write that lands after a remover
 * deleted the photo would create it again. The claim records the object's
 * identity; finish_photo_rewrite answers 'recreated' when the object now
 * has another one, and this deletes it at once. A run that dies in between
 * leaves its lease, and the next run's claim of that path answers
 * 'recreated' too.
 */
export async function scrubObject(deps, bucket, path, { apply }) {
  const counts = emptyCounts();
  let token = null;
  let objectId = null;
  const finish = async (outcome, detail) => {
    const { data, error } = await deps.rpc("finish_photo_rewrite", {
      p_bucket: bucket, p_path: path, p_token: token, p_object: objectId, p_outcome: outcome, p_detail: detail ?? null,
    });
    if (error) throw new Error(`recording ${outcome} failed: ${error.message}`);
    return data;
  };
  // Deletes a photo a write brought back, and proves it's gone.
  const removeRecreated = async () => {
    await deps.remove(bucket, path);
    const state = await finish("failed", "recreated by a rewrite after it was deleted; deleted again");
    if (state !== "gone") throw new Error(`a recreated photo is still there after deleting it (${state})`);
    counts.recreatedRemoved += 1;
    deps.log?.(`  deleted ${bucket}/${path} again: a rewrite had recreated it after it was deleted`);
  };
  // What finish said, for an object this run didn't write over (clean, skipped).
  const settle = async (state, done) => {
    if (state === "recorded") counts[done] = 1;
    else if (state === "gone") counts.gone = 1;
    else if (state === "recreated") await removeRecreated();
    else counts.leaseLost = 1;
  };

  if (apply) {
    const { data, error } = await deps.rpc("claim_photo_rewrite", { p_bucket: bucket, p_path: path });
    if (error || !data) throw new Error(`claim failed: ${error?.message ?? "no answer"}`);
    if (data.status === "busy") return { ...counts, busy: 1 };
    if (data.status === "gone" || data.status === "invalid") return { ...counts, gone: 1 };
    token = data.token;
    objectId = data.object_id;
    if (data.status === "recreated") {
      try {
        await removeRecreated();
      } catch (error) {
        counts.failed = 1;
        deps.log?.(`  failed to delete recreated ${bucket}/${path}: ${String(error?.message ?? error).slice(0, 300)}`);
      }
      return counts;
    }
  }
  const claimedAt = deps.now();
  counts.checked = 1;
  try {
    const bytes = await deps.download(bucket, path);
    if (bytes.length > MAX_BYTES) throw new Error("larger than 25 MB; check it by hand");
    const result = await inspectAndReencode(deps.sharp, bytes);
    if (result.state === "clean") {
      if (!apply) counts.clean = 1;
      else await settle(await finish("clean"), "clean");
      return counts;
    }
    counts.withMetadata = 1;
    if (result.state === "skipped") {
      if (!apply) counts.skipped = 1;
      else await settle(await finish("skipped", `${result.detail}; carries ${result.kinds.join(", ")}`), "skipped");
      return counts;
    }
    if (!apply) return counts;
    if (deps.now() - claimedAt > LEASE_BUDGET_MS) throw new Error("ran past the rewrite lease budget; left for the next run");
    // Still ours, and still the object that was read? Otherwise don't write.
    const { data: check, error: checkError } = await deps.rpc("check_photo_rewrite", { p_bucket: bucket, p_path: path, p_token: token, p_object: objectId });
    if (checkError) throw new Error(`lease check failed: ${checkError.message}`);
    if (check === "gone") {
      await finish("failed", "deleted before the rewrite");
      counts.gone = 1;
      return counts;
    }
    if (check !== "current") {
      counts.leaseLost = 1;
      return counts;
    }
    await deps.write(bucket, path, result.bytes, result.contentType);
    const state = await finish("scrubbed", `removed ${result.kinds.join(", ")}`);
    if (state === "recorded") counts.scrubbed = 1;
    // Deleted after the write: nothing to keep, nothing to undo.
    else if (state === "gone") counts.gone = 1;
    // Deleted before the write landed, and the write brought it back.
    else if (state === "recreated") await removeRecreated();
    // Written over the claimed object, but another run holds the lease now.
    else counts.leaseLost = 1;
    return counts;
  } catch (error) {
    counts.failed = 1;
    const detail = String(error?.message ?? error).slice(0, 300);
    if (apply) {
      try {
        const state = await finish("failed", detail);
        if (state === "recreated") await removeRecreated();
      } catch {
        // The lease stays with the object's identity: the next run's claim
        // finds anything this run recreated.
      }
    }
    deps.log?.(`  failed ${bucket}/${path}: ${detail}`);
    return counts;
  }
}

/** Every candidate in each bucket, up to the limit, one at a time. */
export async function run(deps, options) {
  const totals = {};
  let budget = options.limit;
  let more = false;
  for (const bucket of options.buckets) {
    if (budget === 0) {
      more = true;
      break;
    }
    const counts = emptyCounts();
    totals[bucket] = counts;
    let after = null;
    for (;;) {
      const asked = Math.min(PAGE, budget);
      const { data, error } = await deps.rpc("photo_metadata_candidates", {
        p_bucket: bucket,
        p_after: after,
        p_limit: asked,
        p_uploaded_before: options.uploadedBefore,
      });
      if (error) throw new Error(`listing ${bucket} failed: ${error.message}`);
      const page = data ?? [];
      for (const row of page) {
        const one = await scrubObject(deps, bucket, row.path, options);
        for (const key of Object.keys(counts)) counts[key] += one[key];
      }
      budget -= page.length;
      if (page.length < asked) break;
      if (budget === 0) {
        more = true;
        break;
      }
      after = page[page.length - 1].path;
    }
  }
  return { totals, more };
}

export function describe({ totals, more }, { apply }) {
  const lines = [apply ? "Re-encoded photos that carried metadata:" : "Dry run (nothing claimed, changed or recorded):"];
  for (const [bucket, c] of Object.entries(totals)) {
    lines.push(
      `  ${bucket}: ${c.checked} checked, ${c.clean} clean, ${c.withMetadata} with metadata` +
        (apply ? `, ${c.scrubbed} re-encoded` : `, ${c.withMetadata - c.skipped} would be re-encoded`) +
        `, ${c.skipped} skipped (format), ${c.failed} failed, ${c.busy} busy, ${c.gone} gone` +
        (c.leaseLost ? `, ${c.leaseLost} lease lost` : "") +
        (c.recreatedRemoved ? `, ${c.recreatedRemoved} recreated by a write after deletion and deleted again` : "")
    );
  }
  if (more) lines.push("More objects remain past --limit: run again to continue.");
  return lines.join("\n");
}

const HELP = "Usage: DRVN_MEDIA_PROJECT_URL=<project url> node scripts/owner/scrub-photo-metadata.mjs [--apply] [--bucket message-photos|agent-chat-photos] [--limit N] [--uploaded-before ISO]";

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
  const [{ createClient }, { default: sharp }] = await Promise.all([import("@supabase/supabase-js"), import("sharp")]);
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const deps = {
    sharp,
    now: () => Date.now(),
    log: (line) => console.error(line),
    rpc: (name, args) => admin.rpc(name, args),
    download: async (bucket, path) => {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error) throw new Error(`download failed: ${error.message}`);
      return Buffer.from(await data.arrayBuffer());
    },
    // Always an upsert at Storage, whatever the options say: fenced by
    // finish_photo_rewrite's identity check, not by this call.
    write: async (bucket, path, bytes, contentType) => {
      const { error } = await admin.storage.from(bucket).update(path, bytes, { contentType });
      if (error) throw new Error(`write failed: ${error.message}`);
    },
    remove: async (bucket, path) => {
      const { error } = await admin.storage.from(bucket).remove([path]);
      if (error) throw new Error(`delete failed: ${error.message}`);
    },
  };
  console.log(`${options.apply ? "Applying to" : "Dry run against"} ${url}`);
  const summary = await run(deps, options);
  console.log(describe(summary, options));
  if (options.apply) {
    const recorded = await admin.rpc("photo_metadata_scrub_summary");
    if (!recorded.error) {
      console.log("Recorded so far:");
      for (const row of recorded.data ?? []) console.log(`  ${row.bucket} ${row.outcome}: ${row.objects}`);
    }
  }
  if (Object.values(summary.totals).some((c) => c.failed || c.leaseLost)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

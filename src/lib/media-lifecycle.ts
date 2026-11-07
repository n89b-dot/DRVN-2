import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import {
  OWNED_STORAGE_BUCKETS,
  canonicalStorageObject,
  isCanonicalObjectPath,
  isOwnStorageUrl,
  type StorageObjectRef,
} from "@/lib/media-url";
import { reportError } from "@/lib/monitoring";

/**
 * Uploaded-media lifecycle (migrations 0029, 20261107150500).
 *
 * Photos hit storage before any DB row references them, so the server
 * ledgers every upload as a `staged_uploads` row (the upload route, or
 * src/lib/media-staging.ts for evidence). This module is the trusted server
 * half: stamping rows consumed once an object is actually persisted, and
 * removing objects nothing references any more.
 *
 * Every decision is made on one canonical identity — (bucket, decoded path)
 * — never on a URL as typed: the database's reference check
 * (`media_object_referenced`) compares the same identity, so an encoded or
 * variant spelling can't make an in-use photo look unused (N99).
 *
 * Server-only — the removal here runs service-role and must never be exposed
 * as a server action, or any signed-in user could aim it at other users'
 * objects. Every caller passes the owner the object must belong to.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

/** removed: gone. referenced: kept, something still uses it. invalid: not an
 *  object this owner may have removed (never retried). failed: a lookup or
 *  storage error (retry later). */
export type MediaRemovalOutcome = "removed" | "referenced" | "invalid" | "failed";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The object a deletion target names, provided it is ours and sits in
 *  `ownerId`'s own folder of a bucket members upload to; otherwise null. */
export function ownedDeletionTarget(target: string | StorageObjectRef, ownerId: string): StorageObjectRef | null {
  if (!ownerId || !UUID_RE.test(ownerId)) return null;
  let ref: StorageObjectRef | null;
  if (typeof target === "string") {
    if (!isOwnStorageUrl(target)) return null;
    ref = canonicalStorageObject(target);
  } else {
    ref = target && isCanonicalObjectPath(target.path) ? { bucket: target.bucket, path: target.path } : null;
  }
  if (!ref || !OWNED_STORAGE_BUCKETS.includes(ref.bucket)) return null;
  return ref.path.split("/")[0] === ownerId ? ref : null;
}

/**
 * Removes one object iff nothing references it, plus its staging ledger rows.
 * The object must be ours and in `ownerId`'s own folder: the GC job passes
 * the staged row's verified owner, member actions the signed-in member.
 */
export async function removeMediaObject(
  target: string | StorageObjectRef,
  ownerId: string,
  options: { strict?: boolean; admin?: AdminClient } = {}
): Promise<MediaRemovalOutcome> {
  const ref = ownedDeletionTarget(target, ownerId);
  if (!ref) return "invalid";
  try {
    const admin = options.admin ?? createAdminClient();
    const referenced = await admin.rpc("media_object_referenced", { p_bucket: ref.bucket, p_path: ref.path });
    // An unanswerable check is never "unreferenced" — deleting storage on
    // partial information is the one mistake this module exists to prevent.
    if (referenced.error || typeof referenced.data !== "boolean") {
      if (options.strict) throw new Error("Media reference lookup failed");
      reportError("[media-gc] reference check failed", { bucket: ref.bucket, error: referenced.error });
      return "failed";
    }
    if (referenced.data) return "referenced";

    const { error: removeError } = await admin.storage.from(ref.bucket).remove([ref.path]);
    if (removeError) {
      if (options.strict) throw new Error("Storage remove failed");
      reportError("[media-gc] storage remove failed", { bucket: ref.bucket, removeError });
      return "failed";
    }
    // The object is gone; its staging ledger entry has nothing left to track.
    await admin.from("staged_uploads").delete().eq("bucket", ref.bucket).eq("path", ref.path);
    return "removed";
  } catch (error) {
    if (options.strict) throw error;
    reportError("[media-gc] delete-if-unreferenced failed", { bucket: ref.bucket, error });
    return "failed";
  }
}

/**
 * Marks staged rows consumed for objects that just got persisted, matched by
 * object path (unique), so any spelling of the URL finalises the same row.
 * Runs on the caller's own client: RLS scopes the update to their rows, and
 * consumed_at is the one column a member may write. Best-effort: a miss only
 * means the GC job re-checks references before touching anything.
 */
export async function finalizeMediaUrls(supabase: ServerClient, urls: string[]): Promise<void> {
  const paths = [
    ...new Set(
      urls
        .map((url) => (typeof url === "string" ? canonicalStorageObject(url) : null))
        .filter((ref): ref is StorageObjectRef => Boolean(ref))
        .map((ref) => ref.path)
    ),
  ];
  if (!paths.length) return;
  const { error } = await supabase
    .from("staged_uploads")
    .update({ consumed_at: new Date().toISOString() })
    .in("path", paths)
    .is("consumed_at", null);
  if (error) reportError("[media-gc] finalize failed", { paths: paths.length, error });
}

/**
 * Removes a storage object iff no DB row references it anymore, plus any
 * staged rows for it. Used when an explicit delete/replace drops the last
 * known reference (deleteCarImage, updateListing's dropped photos, avatar
 * swap, account deletion). Log-and-continue unless `strict`: a failed
 * clean-up must never fail the user action that triggered it.
 *
 * Returns "removed" | "referenced" | "skipped" (not ours / not the owner's /
 * unparseable / a transient error).
 */
export async function deleteMediaIfUnreferenced(
  target: string | StorageObjectRef,
  strict: boolean,
  ownerId: string
): Promise<"removed" | "referenced" | "skipped"> {
  const outcome = await removeMediaObject(target, ownerId, { strict });
  return outcome === "removed" || outcome === "referenced" ? outcome : "skipped";
}

const CLEANUP_MAX_ATTEMPTS = 10;

export type CleanupRun = { scanned: number; removed: number; retained: number; rejected: number; failed: number };

/**
 * Works the durable cleanup queue (N51): photos of deleted cars, posts and
 * listings, queued by the database in the same transaction as the delete.
 * Each object goes only if nothing references it any more — a photo a
 * buyer's order snapshot keeps stays. A transient failure is retried on a
 * later run; after ten tries the row stays put for an operator.
 */
export async function processMediaCleanupQueue(
  options: { ownerId?: string; limit?: number; admin?: AdminClient } = {}
): Promise<CleanupRun> {
  const admin = options.admin ?? createAdminClient();
  const run: CleanupRun = { scanned: 0, removed: 0, retained: 0, rejected: 0, failed: 0 };
  let query = admin
    .from("media_cleanup_queue")
    .select("bucket, path, owner_id, attempts")
    .lt("attempts", CLEANUP_MAX_ATTEMPTS)
    .order("enqueued_at")
    .limit(options.limit ?? 200);
  if (options.ownerId) query = query.eq("owner_id", options.ownerId);
  const { data, error } = await query;
  if (error) throw new Error("Media cleanup queue unavailable");

  for (const row of data ?? []) {
    run.scanned += 1;
    const outcome = await removeMediaObject({ bucket: row.bucket, path: row.path }, row.owner_id, { admin });
    if (outcome === "failed") {
      run.failed += 1;
      const retry = await admin
        .from("media_cleanup_queue")
        .update({ attempts: row.attempts + 1, last_error: "transient failure" })
        .eq("bucket", row.bucket)
        .eq("path", row.path);
      if (retry.error) reportError("[media-cleanup] retry bookkeeping failed", retry.error);
      continue;
    }
    if (outcome === "removed") run.removed += 1;
    else if (outcome === "referenced") run.retained += 1;
    else {
      run.rejected += 1;
      reportError("[media-cleanup] queued object is not its owner's", { bucket: row.bucket });
    }
    const done = await admin.from("media_cleanup_queue").delete().eq("bucket", row.bucket).eq("path", row.path);
    if (done.error) reportError("[media-cleanup] dequeue failed", done.error);
  }
  return run;
}

/**
 * After a member's delete (or a moderator's removal) commits, take that
 * member's queued photos down straight away instead of waiting for the daily
 * job. Runs after the response is sent; outside a request (tests, scripts)
 * it does nothing and the job picks the rows up.
 */
export function scheduleMediaCleanup(ownerId: string): void {
  try {
    after(async () => {
      try {
        await processMediaCleanupQueue({ ownerId, limit: 100 });
      } catch (error) {
        reportError("[media-cleanup] immediate run failed", error);
      }
    });
  } catch {
    // Not inside a request: the scheduled media job drains the queue.
  }
}

/**
 * The database accepts a member's photo URL only on our storage origin once
 * it knows that origin (20261107150500, `job_config.media_storage_origin`).
 * The media job records it from the server's own configuration the first
 * time it runs; a value an operator set is never overwritten.
 */
export async function ensureMediaStorageOrigin(admin: AdminClient): Promise<void> {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return;
  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    return;
  }
  const { error } = await admin
    .from("job_config")
    .upsert({ key: "media_storage_origin", value: origin }, { onConflict: "key", ignoreDuplicates: true });
  if (error) reportError("[media-gc] storage origin record failed", error);
}

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
import { sendAdminAlert } from "@/lib/admin/alerts";

/**
 * Uploaded-media lifecycle (migrations 0029, 20261107203000).
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
 *  object this owner may have removed (never retried). busy: another remover
 *  holds the claim (retry later, untouched). failed: a lookup or storage
 *  error (retry later). */
export type MediaRemovalOutcome = "removed" | "referenced" | "invalid" | "busy" | "failed";

type ClaimAnswer =
  | { status: "claimed"; token: string; maybeDeleted: boolean }
  | { status: "referenced" | "busy" | "gone" | "invalid" };

/**
 * A Storage refusal that guarantees nothing was deleted: the request was
 * rejected (bad request, not authorised, forbidden, no such bucket) before
 * any object was touched. Anything else — a network failure, a timeout, a
 * 5xx, a response that couldn't be read — may have deleted the object and
 * lost the answer, so it must never reopen the object to new references.
 */
export function isDefinitiveStorageRefusal(error: unknown): boolean {
  const code = storageStatus(error);
  return code === 400 || code === 401 || code === 403 || code === 404;
}

function storageStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const code = typeof status === "number" ? status : Number(statusCode);
  return Number.isFinite(code) ? code : null;
}

function readClaim(data: unknown): ClaimAnswer | null {
  if (!data || typeof data !== "object") return null;
  const { status, token, maybe_deleted } = data as { status?: unknown; token?: unknown; maybe_deleted?: unknown };
  if (status === "claimed") {
    // Anything but an explicit false is uncertain: never release on a guess.
    return typeof token === "string" && token ? { status, token, maybeDeleted: maybe_deleted !== false } : null;
  }
  return status === "referenced" || status === "busy" || status === "gone" || status === "invalid" ? { status } : null;
}

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
    // Claim, don't just check: under a per-object lock the database re-checks
    // every reference and hands this remover an exclusive claim token that
    // every reference write then respects (20261107203000 §7). A check
    // followed by a delete let evidence attached in between be deleted
    // anyway, and a shared claim let one remover release another's.
    const claimed = await admin.rpc("claim_media_deletion", { p_bucket: ref.bucket, p_path: ref.path });
    const claim = claimed.error ? null : readClaim(claimed.data);
    // An unanswerable check is never "unreferenced" — deleting storage on
    // partial information is the one mistake this module exists to prevent.
    if (!claim) {
      if (options.strict) throw new Error("Media reference lookup failed");
      reportError("[media-gc] reference check failed", { bucket: ref.bucket, error: claimed.error });
      return "failed";
    }
    if (claim.status === "referenced") return "referenced";
    if (claim.status === "invalid") return "invalid";
    // Someone else is removing it right now; never a second delete.
    if (claim.status === "busy") return "busy";

    if (claim.status === "claimed") {
      const bucket = admin.storage.from(ref.bucket);
      const hold = { p_bucket: ref.bucket, p_path: ref.path, p_token: claim.token };
      // Uncertainty is sticky. If this claim was taken over from a holder
      // that never finished, or any attempt here has an unknown outcome, the
      // object may already be gone: from then on the claim is never
      // released, only completed once a delete is confirmed. It is recorded
      // on the claim row, so it outlives this run and any lease takeover.
      let maybeDeleted = claim.maybeDeleted;
      let removeError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        ({ error: removeError } = await bucket.remove([ref.path]));
        if (!removeError || isDefinitiveStorageRefusal(removeError)) break;
        // Unknown outcome (lost response, timeout, 5xx): record it before
        // anything else, then repeat the idempotent delete once.
        if (!maybeDeleted) {
          maybeDeleted = true;
          const marked = await admin.rpc("mark_media_deletion_uncertain", hold);
          if (marked.error) reportError("[media-gc] uncertain mark failed", { bucket: ref.bucket, error: marked.error });
        }
      }
      // A bucket that doesn't exist holds no object: when the object may have
      // gone already, "not found" confirms it.
      const confirmedGone =
        !removeError || (maybeDeleted && isDefinitiveStorageRefusal(removeError) && storageStatus(removeError) === 404);
      if (!confirmedGone) {
        if (!maybeDeleted) {
          // A definitive refusal and no attempt that might have deleted it:
          // the object is still there, so release OUR claim.
          const released = await admin.rpc("release_media_claim", hold);
          if (released.error) reportError("[media-gc] claim release failed", { bucket: ref.bucket, error: released.error });
        } else {
          // The object may be gone: KEEP the claim, so nothing attaches to
          // it. A later run takes it over after the lease, repeats the
          // delete and completes.
          reportError("[media-gc] storage delete unconfirmed; claim kept", { bucket: ref.bucket, removeError });
        }
        if (options.strict) throw new Error("Storage remove failed");
        reportError("[media-gc] storage remove failed", { bucket: ref.bucket, removeError });
        return "failed";
      }
      const completed = await admin.rpc("complete_media_deletion", hold);
      if (completed.error || completed.data !== true) {
        reportError("[media-gc] claim completion failed", { bucket: ref.bucket, error: completed.error });
      }
    }
    // "gone": an earlier remover already deleted it.
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
/** Retry delay after a failure: 15 minutes, doubling, at most a day. Always
 *  past the 10-minute claim lease, so the retry can take a kept claim over. */
export function cleanupBackoffMs(attempts: number): number {
  return Math.min(15 * 60_000 * 2 ** Math.max(0, attempts - 1), 24 * 60 * 60_000);
}
/** Another remover holds the claim: look again once its lease has passed. */
const BUSY_DEFER_MS = 11 * 60_000;

export type CleanupRun = {
  scanned: number;
  removed: number;
  retained: number;
  rejected: number;
  busy: number;
  failed: number;
  /** Rows that just used their last attempt; an operator alert went out. */
  exhausted: number;
  /** The deadline came before the batch was done; the rest wait. */
  outOfTime?: boolean;
};

/**
 * Works the durable cleanup queue (N51): photos of deleted cars, posts and
 * listings, queued by the database in the same transaction as the delete.
 * Each object goes only if nothing references it any more — a photo a
 * buyer's order snapshot keeps stays. A transient failure is retried with
 * backoff on a later run; after ten tries the row stays put and an operator
 * alert goes out.
 */
export async function processMediaCleanupQueue(
  options: {
    ownerId?: string;
    limit?: number;
    admin?: AdminClient;
    seen?: Set<string>;
    now?: () => number;
    /** Epoch ms after which no new object is started. */
    deadline?: number;
  } = {}
): Promise<CleanupRun> {
  const admin = options.admin ?? createAdminClient();
  const now = options.now ?? Date.now;
  const run: CleanupRun = { scanned: 0, removed: 0, retained: 0, rejected: 0, busy: 0, failed: 0, exhausted: 0 };
  let query = admin
    .from("media_cleanup_queue")
    .select("bucket, path, owner_id, attempts, generation")
    .lt("attempts", CLEANUP_MAX_ATTEMPTS)
    .lte("next_attempt_at", new Date(now()).toISOString())
    .order("next_attempt_at")
    .limit(options.limit ?? 200);
  if (options.ownerId) query = query.eq("owner_id", options.ownerId);
  const { data, error } = await query;
  if (error) throw new Error("Media cleanup queue unavailable");

  for (const row of data ?? []) {
    // Checked before each object, not each batch: in a Storage outage one
    // object can take tens of seconds, and a batch is hundreds.
    if (options.deadline !== undefined && now() >= options.deadline) {
      run.outOfTime = true;
      break;
    }
    // At most once per invocation: a caller draining several batches passes
    // one `seen` set, and every processed row is either dequeued or deferred.
    const key = `${row.bucket}/${row.path}`;
    if (options.seen?.has(key)) continue;
    options.seen?.add(key);
    run.scanned += 1;
    const outcome = await removeMediaObject({ bucket: row.bucket, path: row.path }, row.owner_id, { admin });
    if (outcome === "busy") {
      // Another run holds it: look again after its lease, attempts untouched.
      run.busy += 1;
      const defer = await admin
        .from("media_cleanup_queue")
        .update({ next_attempt_at: new Date(now() + BUSY_DEFER_MS).toISOString() })
        .eq("bucket", row.bucket)
        .eq("path", row.path)
        .eq("generation", row.generation);
      if (defer.error) reportError("[media-cleanup] busy deferral failed", defer.error);
      continue;
    }
    if (outcome === "failed") {
      run.failed += 1;
      const attempts = row.attempts + 1;
      const retry = await admin
        .from("media_cleanup_queue")
        .update({
          attempts,
          next_attempt_at: new Date(now() + cleanupBackoffMs(attempts)).toISOString(),
          last_error: "transient failure",
        })
        .eq("bucket", row.bucket)
        .eq("path", row.path)
        .eq("generation", row.generation);
      if (retry.error) reportError("[media-cleanup] retry bookkeeping failed", retry.error);
      if (attempts >= CLEANUP_MAX_ATTEMPTS) {
        // Out of retries: the deleted content's photo is still public. Say
        // so where operators look (the admin alert outbox), once per object.
        run.exhausted += 1;
        await sendAdminAlert({
          kind: "media_cleanup_stuck",
          title: "A deleted photo could not be removed from storage",
          detail: `${row.bucket}/${row.path} failed ${attempts} cleanup attempts and is no longer retried. Fix the cause, then set its media_cleanup_queue attempts back to 0.`,
          dedupKey: `media-cleanup:${row.bucket}/${row.path}`,
        });
      }
      continue;
    }
    if (outcome === "removed") run.removed += 1;
    else if (outcome === "referenced") run.retained += 1;
    else {
      run.rejected += 1;
      reportError("[media-cleanup] queued object is not its owner's", { bucket: row.bucket });
    }
    // Only the generation read above: if the object was queued again while
    // we worked (another post using it was deleted), that request survives
    // for its own after() run or the next job.
    const done = await admin
      .from("media_cleanup_queue")
      .delete()
      .eq("bucket", row.bucket)
      .eq("path", row.path)
      .eq("generation", row.generation);
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
 * The database accepts a member's photo URL only on our storage origin,
 * `job_config.media_storage_origin` (20261107203000), and refuses every new
 * one while that's missing. The deploy step sets it (docs/production-
 * runbook.md); the upload route and the media job also record it from the
 * server's own configuration, so a missed step heals on the first upload. A
 * value an operator set is never overwritten.
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

import "server-only";

import { after } from "next/server";

import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public copies of published photos (20261124220000).
 *
 * A member photo is a private object, shown through a link signed for an
 * hour (N455). That is right for a draft or a private car, and it stays. But
 * a published photo's address changed every hour too, so nothing could keep
 * a copy of it and the image optimiser encoded it again every hour.
 *
 * So a photo that something public shows gets a copy in a public bucket
 * (`public-<bucket>`, same path), and the database keeps a record of which
 * copies are ready (`public_photo_copies`). Where a copy is live the signer
 * is answered with its address, which never changes; where there is none it
 * signs as before. No row's stored link changes, and nothing depends on a
 * copy existing: a photo whose copy is late, or never made, is still shown.
 *
 * This is the part that moves bytes, in this order:
 *  1. retire: every copy whose photo is no longer shown publicly stops being
 *     handed out and is revoked, in one statement in the database;
 *  2. remove: the withdrawn copies are deleted from the public bucket;
 *  3. copy: photos now shown publicly that have no copy get one, and each is
 *     confirmed only if its photo is still shown when the copy is done;
 *  4. (the whole-site run only) objects in a public bucket with no record,
 *     left by a copy that was interrupted, are deleted.
 *
 * It runs every ten minutes for everyone (the media job), and straight after
 * a member's own change for that member, so hiding a car takes its copies
 * down in seconds and at worst in minutes.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export const PUBLIC_COPY_PREFIX = "public-";
const MEMBER_BUCKETS = new Set(["car-images", "listing-images", "activity-images"]);

export type PublicCopySync = {
  /** Copies withdrawn because their photo is no longer shown publicly. */
  retired: number;
  /** Withdrawn copies deleted from the public bucket. */
  removed: number;
  /** Copies made and confirmed. */
  copied: number;
  /** Unrecorded objects deleted from a public bucket. */
  orphans: number;
  /** Photos a row names whose bytes are not in storage: recorded as such and not tried again. */
  unavailable: number;
  /** Steps that did not complete; each is tried again on the next run. */
  failed: number;
  /** The deadline came first; the rest wait for the next run. */
  outOfTime?: boolean;
};

type Key = { bucket: string; path: string };

/**
 * Storage answers with an HTTP status and, on some versions, a different
 * code in the body (a missing object has been a 400 carrying "404"), so both
 * are read, and the message last.
 */
type StorageFailure = { message?: string; status?: number | string; statusCode?: number | string };
const codes = (error: StorageFailure) => [Number(error.status), Number(error.statusCode)].filter((code) => code >= 400);
/** The destination is already there: an earlier attempt's copy. */
const alreadyThere = (error: StorageFailure) => codes(error).includes(409) || /already exists|duplicate/i.test(error.message ?? "");
/** The object is not there. */
const alreadyGone = (error: StorageFailure) => codes(error).includes(404) || /not.?found/i.test(error.message ?? "");
/** Asking again in ten minutes may get a different answer: the server's own trouble, a limit, the key. */
const RETRY_CODES = new Set([401, 403, 408, 425, 429]);
/**
 * Storage will not copy this photo however often it is asked: its bytes are
 * not there, or it is something the public bucket does not take (a type or a
 * size it refuses). Anything that may pass next time is not this.
 */
const cannotBeCopied = (error: StorageFailure) => {
  if (alreadyGone(error)) return true;
  const seen = codes(error);
  return seen.length > 0 && seen.every((code) => code < 500 && !RETRY_CODES.has(code));
};

async function removeCopy(admin: AdminClient, key: Key): Promise<boolean> {
  const { error } = await admin.storage.from(PUBLIC_COPY_PREFIX + key.bucket).remove([key.path]);
  return !error || alreadyGone(error);
}

export async function syncPublicPhotoCopies(
  options: { ownerId?: string; admin?: AdminClient; limit?: number; deadline?: number } = {},
): Promise<PublicCopySync> {
  const admin = options.admin ?? createAdminClient();
  const owner = options.ownerId;
  const limit = options.limit ?? 50;
  const outOfTime = () => options.deadline !== undefined && Date.now() >= options.deadline;
  const tally: PublicCopySync = { retired: 0, removed: 0, copied: 0, orphans: 0, unavailable: 0, failed: 0 };

  // 1. Retire. The privacy step, and one statement: it comes first and its
  //    failure is the only one that stops the run.
  const retired = await admin.rpc("public_photo_copies_retire", owner ? { p_owner: owner } : {});
  if (retired.error) throw new Error("Public photo copies could not be retired", { cause: retired.error });
  tally.retired = retired.data ?? 0;

  // 2. Remove what has been withdrawn (now, or on a run that did not finish).
  let removing = admin.from("public_photo_copies").select("bucket, path").eq("state", "removing").order("updated_at").limit(limit);
  if (owner) removing = removing.eq("owner_id", owner);
  const withdrawn = await removing;
  if (withdrawn.error) throw new Error("Withdrawn photo copies could not be read", { cause: withdrawn.error });
  for (const key of withdrawn.data ?? []) {
    if (outOfTime()) return { ...tally, outOfTime: true };
    if (!MEMBER_BUCKETS.has(key.bucket) || !(await removeCopy(admin, key))) {
      tally.failed += 1;
      continue;
    }
    const done = await admin.rpc("public_photo_copy_removed", { p_bucket: key.bucket, p_path: key.path });
    if (done.error) tally.failed += 1;
    else tally.removed += 1;
  }

  // 3. Copy what is now shown publicly and has no copy.
  const claimed = await admin.rpc("public_photo_copies_claim", owner ? { p_owner: owner, p_limit: limit } : { p_limit: limit });
  if (claimed.error) throw new Error("Photos to copy could not be claimed", { cause: claimed.error });
  for (const key of (claimed.data ?? []) as Key[]) {
    if (outOfTime()) return { ...tally, outOfTime: true };
    if (!MEMBER_BUCKETS.has(key.bucket)) continue;
    const copy = await admin.storage.from(key.bucket).copy(key.path, key.path, { destinationBucket: PUBLIC_COPY_PREFIX + key.bucket });
    if (copy.error && !alreadyThere(copy.error) && cannotBeCopied(copy.error)) {
      // A row names a photo whose bytes are not there (a lost object, a
      // fixture), or one the public bucket will not take. There is nothing
      // to copy, so it is recorded and left: not a failure of this run, and
      // not claimed again every ten minutes ahead of photos that can be. It
      // is signed and shown as before, and asked about again in a day.
      if (!alreadyGone(copy.error)) reportError("[public-copies] photo cannot be copied", { bucket: key.bucket, error: copy.error.message });
      const noted = await admin.rpc("public_photo_copy_unavailable", { p_bucket: key.bucket, p_path: key.path });
      if (noted.error) tally.failed += 1;
      else tally.unavailable += 1;
      continue;
    }
    if (copy.error && !alreadyThere(copy.error)) {
      // The record stays 'copying' and is handed out again in ten minutes.
      tally.failed += 1;
      reportError("[public-copies] copy failed", { bucket: key.bucket, error: copy.error.message });
      continue;
    }
    const confirmed = await admin.rpc("public_photo_copy_confirm", { p_bucket: key.bucket, p_path: key.path });
    if (confirmed.error) {
      tally.failed += 1;
      continue;
    }
    if (confirmed.data === "live") {
      tally.copied += 1;
      continue;
    }
    // No longer shown by the time it was made ('removing'), or withdrawn and
    // already cleared ('gone'): what was just written must not stay.
    if (!(await removeCopy(admin, key))) tally.failed += 1;
    else if (confirmed.data === "removing") await admin.rpc("public_photo_copy_removed", { p_bucket: key.bucket, p_path: key.path });
  }

  // 4. Unrecorded objects, on the whole-site run only.
  if (!owner && !outOfTime()) {
    const orphans = await admin.rpc("public_photo_copy_orphans", { p_limit: limit });
    if (orphans.error) tally.failed += 1;
    for (const key of (orphans.data ?? []) as Key[]) {
      if (outOfTime()) return { ...tally, outOfTime: true };
      if (MEMBER_BUCKETS.has(key.bucket) && (await removeCopy(admin, key))) tally.orphans += 1;
      else tally.failed += 1;
    }
  }
  return tally;
}

/**
 * After a member's change commits, bring that member's copies in line now
 * rather than at the next ten-minute run: a car just hidden loses its copies
 * in seconds, a part just listed gets its copy. Runs after the response is
 * sent; outside a request (tests, scripts) it does nothing and the job does
 * the work.
 */
export function schedulePublicPhotoSync(ownerId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) return;
  try {
    after(async () => {
      try {
        await syncPublicPhotoCopies({ ownerId, limit: 100, deadline: Date.now() + 20_000 });
      } catch (error) {
        reportError("[public-copies] immediate run failed", error);
      }
    });
  } catch {
    // Not inside a request: the scheduled media job does it.
  }
}

"use server";

import { redirect } from "next/navigation";

import { deleteMediaIfUnreferenced } from "@/lib/media-lifecycle";
import { isOwnedStorageUrl, parseStorageObject } from "@/lib/media-url";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

/**
 * Client-invokable half of the uploaded-media lifecycle (migration 0029).
 * Uploaders call `recordStagedUpload` right after a successful storage
 * upload and `deleteStagedIfUnconsumed` when a not-yet-persisted photo is
 * removed. Both are best-effort from the caller's point of view — the photo
 * flow itself must never block on the staging ledger.
 *
 * These are real server actions (any signed-in client can POST them), so
 * each one proves ownership from the URL itself before touching anything.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/** Ledgers a fresh client-side upload so an abandoned form can't orphan it. */
export async function recordStagedUpload(
  bucket: string,
  path: string,
  url: string
): Promise<void> {
  const { supabase, user } = await requireUser();

  // The URL must be our storage, in the claimed bucket/path, under the
  // caller's own folder — same provenance bar the persisting actions apply.
  const object = parseStorageObject(url);
  if (
    !object ||
    object.bucket !== bucket ||
    object.path !== path ||
    !path.startsWith(`${user.id}/`) ||
    !isOwnedStorageUrl(url, user.id)
  ) {
    return;
  }

  // `path` is unique — a replayed call is a no-op, not an error.
  const { error } = await supabase
    .from("staged_uploads")
    .upsert({ owner_id: user.id, bucket, path, url }, { onConflict: "path", ignoreDuplicates: true });
  if (error) reportError("[media-gc] staging record failed", { bucket, error });
}

/**
 * Removes a staged photo the user backed out of before saving: the storage
 * object AND its ledger row — but only when the row exists, is unconsumed,
 * and is the caller's own, and the URL is referenced nowhere in the DB.
 * Anything else is left for the 48h GC sweep, which re-checks everything.
 */
export async function deleteStagedIfUnconsumed(url: string): Promise<void> {
  const { supabase, user } = await requireUser();
  if (typeof url !== "string" || !url) return;

  // RLS already scopes reads to the owner; the explicit filters make the
  // contract visible and keep admin visibility from widening this delete.
  const { data: staged } = await supabase
    .from("staged_uploads")
    .select("id")
    .eq("url", url)
    .eq("owner_id", user.id)
    .is("consumed_at", null)
    .maybeSingle();
  if (!staged) return;

  // The reference check inside guards the row-exists-but-URL-persisted edge
  // (e.g. a finalize that never ran) — never delete storage that might be
  // referenced.
  await deleteMediaIfUnreferenced(url, false, user.id);
}

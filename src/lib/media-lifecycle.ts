import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { isOwnStorageUrl, parseStorageObject } from "@/lib/media-url";
import { reportError } from "@/lib/monitoring";

/**
 * Uploaded-media lifecycle (migration 0029).
 *
 * Photos hit storage client-side before any DB row references them, so the
 * app tracks every upload as a `staged_uploads` row (see
 * src/lib/media-staging.ts for the client-invokable half). This module is the
 * trusted server half: stamping rows consumed once a URL is actually
 * persisted, and garbage-collecting objects nothing references anymore.
 *
 * Server-only — `deleteMediaIfUnreferenced` runs service-role and must never
 * be exposed as a server action, or any signed-in user could aim it at other
 * users' staged objects.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Every table/column that can hold a storage URL. A URL is only deletable
 *  when none of these mention it — the check is deliberately global rather
 *  than per-feature because URLs can be re-used across surfaces (a car photo
 *  promoted to cover, a listing photo re-used in an activity post). */
async function isMediaReferenced(
  admin: ReturnType<typeof createAdminClient>,
  url: string,
  strict = false
): Promise<boolean> {
  const checks: PromiseLike<{ count: number | null; error: unknown }>[] = [
    admin.from("car_images").select("id", { count: "exact", head: true }).eq("url", url),
    admin.from("listing_images").select("id", { count: "exact", head: true }).eq("url", url),
    admin.from("activity_images").select("id", { count: "exact", head: true }).eq("url", url),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("avatar_url", url),
    admin.from("cars").select("id", { count: "exact", head: true }).eq("cover_image_url", url),
    // Purchase evidence (migration 0049): a listing photo frozen onto an order
    // must survive the seller deleting it from the live listing — historical
    // transaction truth outlives the listing gallery.
    admin
      .from("order_item_snapshot_images")
      .select("id", { count: "exact", head: true })
      .eq("url", url),
    // A mod's thumbnail, imported from the product link the owner pasted
    // (L-2). Without this the 48h sweep would take it back out from under a
    // build sheet that is still showing it.
    admin.from("mod_items").select("id", { count: "exact", head: true }).eq("image_url", url),
  ];
  // Message photos are private and stored on the message by storage PATH
  // (20260928140000), not by URL — match on the object path instead.
  const object = parseStorageObject(url);
  if (object?.bucket === "message-photos") {
    checks.push(
      admin.from("messages").select("id", { count: "exact", head: true }).contains("attachments", [object.path]),
    );
  }
  const results = await Promise.all(checks);
  for (const { count, error } of results) {
    // An unanswerable check must read as "referenced" — deleting storage on
    // partial information is the one mistake this module exists to prevent.
    if (error) {
      if (strict) throw new Error("Media reference lookup failed");
      reportError("[media-gc] reference check failed", { url, error });
      return true;
    }
    if ((count ?? 0) > 0) return true;
  }
  const embedded = await admin.rpc("has_embedded_media_reference", { p_url: url });
  if (embedded.error) {
    if (strict) throw new Error("Embedded media reference lookup failed");
    return true;
  }
  return embedded.data !== false;
}

/**
 * Marks staged rows consumed for URLs that just got persisted. Runs on the
 * caller's own client so RLS scopes the update to their rows. Best-effort:
 * a miss only means the GC job later re-checks references before touching
 * anything, so failures are logged, never surfaced.
 */
export async function finalizeMediaUrls(supabase: ServerClient, urls: string[]): Promise<void> {
  const valid = urls.filter((u) => typeof u === "string" && u);
  if (!valid.length) return;
  const { error } = await supabase
    .from("staged_uploads")
    .update({ consumed_at: new Date().toISOString() })
    .in("url", valid)
    .is("consumed_at", null);
  if (error) reportError("[media-gc] finalize failed", { urls: valid.length, error });
}

/**
 * Removes a storage object iff no DB row references its URL anymore, plus any
 * staged rows for it. Used when an explicit delete/replace drops the last
 * known reference (deleteCarImage, updateListing's dropped photos, avatar
 * swap) and by the GC job. Log-and-continue throughout: a failed GC must
 * never fail the user action that triggered it.
 *
 * Returns "removed" | "referenced" | "skipped" (not ours / unparseable).
 */
export async function deleteMediaIfUnreferenced(
  url: string,
  strict = false
): Promise<"removed" | "referenced" | "skipped"> {
  if (!isOwnStorageUrl(url)) return "skipped";
  const object = parseStorageObject(url);
  if (!object) return "skipped";

  try {
    const admin = createAdminClient();
    if (await isMediaReferenced(admin, url, strict)) return "referenced";

    const { error: removeError } = await admin.storage.from(object.bucket).remove([object.path]);
    if (removeError) {
      reportError("[media-gc] storage remove failed", { url, removeError });
      return "skipped";
    }
    // The object is gone; its staging ledger entry has nothing left to track.
    await admin.from("staged_uploads").delete().eq("url", url);
    return "removed";
  } catch (error) {
    if (strict) throw error;
    reportError("[media-gc] delete-if-unreferenced failed", { url, error });
    return "skipped";
  }
}

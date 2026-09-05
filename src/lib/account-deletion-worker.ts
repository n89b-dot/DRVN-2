import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteMediaIfUnreferenced } from "@/lib/media-lifecycle";
import { reportError } from "@/lib/monitoring";

type Job = { id: string; lease_id: string; payload: { user_id: string } };
/** Collect before deletion so removing objects cannot shift list offsets. */
async function listOwnedPaths(admin: ReturnType<typeof createAdminClient>, bucket: string, prefix: string, paths: string[] = []) {
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error("Storage enumeration failed");
    for (const entry of data || []) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) paths.push(path); else await listOwnedPaths(admin, bucket, path, paths);
      if (paths.length > 20000 || prefix.split("/").length > 12) throw new Error("Deletion requires a larger supervised storage pass");
    }
    if (!data || data.length < 100) return paths;
  }
}
export async function processAccountDeletions() {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_remediation_jobs", { p_kind: "delete_account", p_limit: 1 });
  if (error) throw new Error("Deletion queue unavailable");
  let completed = 0;
  for (const job of (data || []) as unknown as Job[]) {
    let failure: string | undefined;
    try {
      const uid = job.payload.user_id;
      const { data: account, error: lookup } = await admin.auth.admin.getUserById(uid);
      if (lookup && lookup.status !== 404) throw new Error("Deletion account lookup failed");
      if (account.user) {
        const ban = await admin.auth.admin.updateUserById(uid, { ban_duration: "876000h" });
        if (ban.error) throw new Error("Could not revoke account access");
      }
        // Rows are removed before media checks. Frozen order/evidence references
        // remain authoritative and prevent deletion of retained transaction media.
        const scrub = await admin.from("profiles").update({ avatar_url: null, display_name: "Deleted member", username: null, bio: null, headline: null, location: null, links: [] }).eq("id", uid);
        if (scrub.error) throw new Error("Profile cleanup failed");
        for (const operation of [
          admin.from("activity_posts").delete().eq("author_id", uid),
          admin.from("listings").delete().eq("seller_id", uid),
          admin.from("cars").delete().eq("owner_id", uid),
        ]) { const result = await operation; if (result.error) throw new Error("Owned content cleanup failed"); }
        for (const bucket of ["avatars", "car-images", "activity-images", "listing-images"]) {
          const paths = await listOwnedPaths(admin, bucket, uid);
          for (const path of paths) {
            const { data: { publicUrl } } = admin.storage.from(bucket).getPublicUrl(path);
            const result = await deleteMediaIfUnreferenced(publicUrl, true);
            if (result === "skipped") throw new Error("Storage cleanup needs retry");
          }
        }
      if (account.user) {
        const deleted = await admin.auth.admin.deleteUser(uid);
        if (deleted.error) throw new Error("Auth deletion needs retry; retained media may require operator review");
      }
      completed++;
    } catch (error) {
      failure = error instanceof Error ? error.message : "Account deletion failed";
      reportError("[account-deletion] retry required", { requestId: job.id, error: failure });
    }
    const done = await admin.rpc("finish_remediation_job", { p_id: job.id, p_lease: job.lease_id, p_error: failure });
    if (done.error) throw new Error("Deletion acknowledgement failed");
    if (failure) throw new Error(failure);
  }
  return { completed };
}

import { jobHeartbeat } from "./job-lease";
import { stripeClient } from "./payments/stripe";
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteMediaIfUnreferenced } from "@/lib/media-lifecycle";
import { reportError } from "@/lib/monitoring";

type Job = { id: string; lease_id: string; payload: { user_id: string; stripe_customer_id?: string | null } };
const buckets = ["avatars", "car-images", "activity-images", "listing-images"];

/** Inventory pages commit before any deletions, so object removal cannot shift offsets. */
async function drainStorage(admin: ReturnType<typeof createAdminClient>, job: Job, heartbeat: () => Promise<void>) {
  await admin.from("deletion_storage_tasks").upsert(buckets.map(bucket => ({ job_id: job.id, bucket, path: job.payload.user_id, folder: true })), { onConflict: "job_id,bucket,path", ignoreDuplicates: true }).throwOnError();
  const deadline = Date.now() + 30_000;
  for (let pages = 0; pages < 12 && Date.now() < deadline; pages++) {
    const next = await admin.from("deletion_storage_tasks").select("bucket,path,page_offset").eq("job_id", job.id).eq("folder", true).eq("status", "pending").order("bucket").order("path").limit(1).throwOnError();
    const task = next.data[0]; if (!task) break;
    await heartbeat();
    const listed = await admin.storage.from(task.bucket).list(task.path, { limit: 100, offset: task.page_offset, sortBy: { column: "name", order: "asc" } });
    if (listed.error) throw new Error("Storage enumeration failed");
    const entries = listed.data.map(entry => ({ job_id: job.id, bucket: task.bucket, path: `${task.path}/${entry.name}`, folder: !entry.id }));
    await heartbeat();
    if (entries.length) await admin.from("deletion_storage_tasks").upsert(entries, { onConflict: "job_id,bucket,path", ignoreDuplicates: true }).throwOnError();
    await admin.from("deletion_storage_tasks").update({ page_offset: task.page_offset + listed.data.length, status: listed.data.length < 100 ? "scanned" : "pending" }).eq("job_id", job.id).eq("bucket", task.bucket).eq("path", task.path).throwOnError();
  }
  const folders = await admin.from("deletion_storage_tasks").select("path").eq("job_id", job.id).eq("folder", true).eq("status", "pending").limit(1).throwOnError();
  if (folders.data.length) return false;
  const objects = await admin.from("deletion_storage_tasks").select("bucket,path").eq("job_id", job.id).eq("folder", false).eq("status", "pending").order("bucket").order("path").limit(150).throwOnError();
  for (const object of objects.data) {
    if (Date.now() >= deadline) return false;
    await heartbeat();
    const publicUrl = admin.storage.from(object.bucket).getPublicUrl(object.path).data.publicUrl;
    const outcome = await deleteMediaIfUnreferenced(publicUrl, true);
    if (outcome === "skipped") throw new Error("Storage cleanup needs retry");
    await heartbeat();
    await admin.from("deletion_storage_tasks").update({ status: outcome === "referenced" ? "retained" : "deleted" }).eq("job_id", job.id).eq("bucket", object.bucket).eq("path", object.path).throwOnError();
  }
  const remaining = await admin.from("deletion_storage_tasks").select("path").eq("job_id", job.id).eq("status", "pending").limit(1).throwOnError();
  return remaining.data.length === 0;
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
      const heartbeat = jobHeartbeat(admin, job);
      await heartbeat();
      await admin.rpc("assert_deletion_ready", { p_user: uid }).throwOnError();
      // Preserve the external identity before profile/Auth cascades can remove it.
      if (!("stripe_customer_id" in job.payload)) {
        const profile = await admin.from("profiles").select("stripe_customer_id").eq("id", uid).maybeSingle().throwOnError();
        job.payload.stripe_customer_id = profile.data?.stripe_customer_id ?? null;
        await admin.from("remediation_jobs").update({ payload: job.payload }).eq("id", job.id).eq("lease_id", job.lease_id).throwOnError();
      }
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
      if (!(await drainStorage(admin, job, heartbeat))) {
        await admin.rpc("continue_account_deletion", { p_job: job.id, p_lease: job.lease_id }).throwOnError();
        return { completed, continued: 1 };
      }
      await heartbeat();
      await admin.rpc("assert_deletion_ready", { p_user: uid }).throwOnError();
      if (job.payload.stripe_customer_id) {
        const stripe = stripeClient();
        const customer = await stripe.customers.retrieve(job.payload.stripe_customer_id, {}, { timeout: 10000, maxNetworkRetries: 0 });
        if (!customer.deleted) {
          if (customer.metadata.user_id !== uid) throw new Error("Customer ownership requires operator review");
          await stripe.customers.del(customer.id, {}, { timeout: 10000, maxNetworkRetries: 0 });
        }
      }
      await heartbeat();
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

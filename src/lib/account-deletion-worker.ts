import { jobHeartbeat } from "./job-lease";
import { stripeClient } from "./payments/stripe";
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { removeMediaObject } from "@/lib/media-lifecycle";
import { reportError } from "@/lib/monitoring";
import { purgeAccountExportsForUser } from "@/lib/account-export-worker";
import { deletionOutcome } from "@/lib/account-deletion-policy";
import { accountEmailDigest } from "@/lib/email-digest";

type Job = { id: string; lease_id: string; payload: { user_id: string; stripe_customer_id?: string | null } };
// message-photos: the sender's own folder; the scrub clears the attachments
// first, so only photos nothing else references (dispute evidence) go.
const buckets = ["avatars", "car-images", "activity-images", "listing-images", "message-photos"];

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
    // The listing comes from the member's own folders, so they are its owner.
    // Strict: a failed lookup or removal throws and the job retries. An
    // object no reference could ever name canonically is kept, not retried
    // forever.
    const outcome = await removeMediaObject({ bucket: object.bucket, path: object.path }, job.payload.user_id, { strict: true, admin });
    // Busy: another remover holds the object's claim right now; come back.
    if (outcome === "failed" || outcome === "busy") throw new Error("Storage cleanup needs retry");
    await heartbeat();
    await admin.from("deletion_storage_tasks").update({ status: outcome === "removed" ? "deleted" : "retained" }).eq("job_id", job.id).eq("bucket", object.bucket).eq("path", object.path).throwOnError();
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
      const deletionRequest = await admin.from("account_deletion_requests").select("id, email_digest").eq("user_id", uid).maybeSingle();
      if (deletionRequest.error || !deletionRequest.data) throw new Error("Deletion request record is missing");
      const deletionRequestId = deletionRequest.data.id;
      await heartbeat();
      const blockers = await admin.rpc("account_deletion_blockers", { p_user: uid });
      if (blockers.error) throw new Error("Deletion blocker check failed");
      if (deletionOutcome(blockers.data as unknown as { financial_hold?: boolean }) === "temporary_financial_hold") {
        await admin.rpc("pause_account_deletion_hold", { p_job: job.id, p_lease: job.lease_id, p_user: uid }).throwOnError();
        return { completed, continued: 1, outcome: "temporary_financial_hold" as const };
      }
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
        // N16: the email is replaced by a keyed digest, taken once: a resumed
        // run finds the digest already recorded (the email is gone by then).
        const email = account.user?.email;
        const digest = !deletionRequest.data.email_digest && email ? accountEmailDigest(email) : null;
        // One transaction, the same however often it runs (20261107220510):
        // Auth email and metadata, addresses, order party labels, message,
        // question and comment bodies, the profile, and the retained-key
        // clock. Rows are removed before media checks; frozen order and
        // evidence references still protect retained transaction media.
        const scrub = await admin.rpc("scrub_deleted_account", {
          p_user: uid,
          p_email_digest: digest?.digest ?? null,
          p_digest_key: digest?.key ?? null,
        });
        if (scrub.error) throw new Error("Personal data scrub failed");
        for (const operation of [
          admin.from("activity_posts").delete().eq("author_id", uid),
          // Listings kept for completed orders keep their private terms row;
          // the member's minimums go either way.
          admin.from("listing_private_terms").update({ offer_floor_cents: null }).eq("seller_id", uid),
          // The member's agent: limits, tasks, record, approvals and chat
          // (agent-data-rules.md §1). Rounds it made stay with their offers.
          admin.rpc("agent_purge_member", { p_user: uid }),
          admin.from("listings").delete().eq("seller_id", uid),
          admin.from("cars").delete().eq("owner_id", uid),
        ]) { const result = await operation; if (result.error) throw new Error("Owned content cleanup failed"); }
      if (!(await drainStorage(admin, job, heartbeat))) {
        await admin.rpc("continue_account_deletion", { p_job: job.id, p_lease: job.lease_id }).throwOnError();
        return { completed, continued: 1 };
      }
      await heartbeat();
      const recheck = await admin.rpc("account_deletion_blockers", { p_user: uid });
      if (recheck.error) throw new Error("Deletion blocker recheck failed");
      const blockersAfterCleanup = recheck.data as unknown as { financial_hold?: boolean; retained_identity?: boolean };
      const outcome = deletionOutcome(blockersAfterCleanup);
      if (outcome === "temporary_financial_hold") {
        await admin.rpc("pause_account_deletion_hold", { p_job: job.id, p_lease: job.lease_id, p_user: uid }).throwOnError();
        return { completed, continued: 1, outcome: "temporary_financial_hold" as const };
      }
      await purgeAccountExportsForUser(uid);
      if (outcome === "operator_attention") {
        const retained = await admin.from("account_deletion_requests").update({
          outcome: "operator_attention",
          blocker_code: "immutable_retained_identity",
          // N16: personal data is scrubbed; only transaction keys remain,
          // until account_deletion_requests.retain_until (6 years).
          affected_data_classes: ["order and payment keys", "audit or reporting references"],
          next_action: "Personal data is removed. Order and payment keys are kept until the retention date; the final step after it is not yet ruled.",
          responsible_owner: "operations and policy owner",
          review_at: null,
          policy_decisions_pending: ["audit/log retention", "backup expiry", "what happens when the 6-year retention ends"],
          updated_at: new Date().toISOString(),
        }).eq("user_id", uid);
        if (retained.error) throw new Error("Could not record retained identity outcome");
        completed++;
        const acknowledged = await admin.rpc("finish_remediation_job", { p_id: job.id, p_lease: job.lease_id, p_error: undefined });
        if (acknowledged.error) throw new Error("Deletion outcome acknowledgement failed");
        return { completed, outcome: "operator_attention" as const };
      }
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
      await admin.from("account_deletion_requests").update({ outcome: "completed", blocker_code: null, next_action: "No further action is required.", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", deletionRequestId).throwOnError();
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

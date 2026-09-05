import "server-only";
import { deliverOrderAccessLink } from "@/features/commerce/guest-buyer";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

type ReceiptJob = { id: string; lease_id: string; payload: { buyer_id: string; destination?: string } };
export async function processReceiptJobs() {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_remediation_jobs", { p_kind: "receipt", p_limit: 10 });
  if (error) throw new Error(`Receipt claim failed: ${error.code}`);
  let delivered = 0, failed = 0;
  for (const job of (data ?? []) as unknown as ReceiptJob[]) {
    let failure: string | undefined;
    try {
      const { data: account, error: lookupError } = await admin.auth.admin.getUserById(job.payload.buyer_id);
      if (lookupError || !account.user?.email) throw new Error("Receipt account unavailable");
      await deliverOrderAccessLink(account.user.email, job.payload.destination || "/orders");
      delivered++;
    } catch (error) {
      failed++;
      failure = error instanceof Error ? error.message : "Receipt delivery failed";
      reportError("[receipt] delivery failed", { jobId: job.id, error: failure });
    }
    const finished = await admin.rpc("finish_remediation_job", { p_id: job.id, p_lease: job.lease_id, p_error: failure });
    if (finished.error) throw new Error(`Receipt acknowledgement failed: ${finished.error.code}`);
  }
  return { delivered, failed };
}

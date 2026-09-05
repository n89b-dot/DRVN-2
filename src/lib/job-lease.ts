import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
/** Renew at checkpoints before external effects; an expired owner cannot revive itself. */
export function jobHeartbeat(admin: ReturnType<typeof createAdminClient>, job: { id: string; lease_id: string }) {
  return async () => {
    const renewed = await admin.rpc("renew_remediation_lease", { p_id: job.id, p_lease: job.lease_id }).abortSignal(AbortSignal.timeout(2000));
    if (renewed.error) throw new Error("Job lease lost; stop this worker");
  };
}

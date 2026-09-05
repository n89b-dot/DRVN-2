import { createAdminClient } from "@/lib/supabase/admin";
import { syncListingToSearch } from "@/lib/marketplace/search/indexing";
import { syncCarToSearch, syncProfileToSearch, syncUpdateToSearch } from "@/lib/explore/search/indexing";
import { typesenseConfigured } from "@/lib/search/typesense";
import { reportError } from "@/lib/monitoring";
const sync = { listing: syncListingToSearch, car: syncCarToSearch, profile: syncProfileToSearch, update: syncUpdateToSearch };
type Job = { id: string; lease_id: string; payload: { entity: keyof typeof sync; id: string } };
export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response(null, { status: 404 });
  if (!typesenseConfigured()) return Response.json({ configured: false, processed: 0 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_remediation_jobs", { p_kind: "search", p_limit: 10 });
  if (error) return new Response("Search claim failed", { status: 500 });
  let processed = 0, failed = 0;
  for (const job of (data || []) as unknown as Job[]) {
    let failure: string | undefined;
    try { await sync[job.payload.entity](job.payload.id); processed++; }
    catch { failed++; failure = "Search synchronization failed"; reportError("[search] queued sync failed", { jobId: job.id }); }
    const done = await admin.rpc("finish_remediation_job", { p_id: job.id, p_lease: job.lease_id, p_error: failure });
    if (done.error) return new Response("Search acknowledgement failed", { status: 500 });
  }
  return Response.json({ processed, failed }, { status: failed ? 503 : 200 });
}

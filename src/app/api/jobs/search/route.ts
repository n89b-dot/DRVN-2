import { ensureSearchCollections } from "@/lib/search/collections";
import { trackedWorker } from "@/lib/tracked-worker";
import { jobHeartbeat } from "@/lib/job-lease";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexListingNow } from "@/lib/marketplace/search/indexing";
import { indexCarNow, indexProfileNow, indexUpdateNow } from "@/lib/explore/search/indexing";
import { typesenseConfigured } from "@/lib/search/typesense";
import { reportError } from "@/lib/monitoring";
const sync = { listing: indexListingNow, car: indexCarNow, profile: indexProfileNow, update: indexUpdateNow };
type Job = { id: string; lease_id: string; payload: { entity: keyof typeof sync; id: string } };
async function run(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response(null, { status: 404 });
  if (!typesenseConfigured()) return Response.json({ configured: false, processed: 0 });
  await ensureSearchCollections();
  const admin = createAdminClient();
  const rebuilds = await admin.from("search_rebuilds").select("id").eq("status", "pending").order("created_at").limit(1);
  if (rebuilds.error) return new Response("Rebuild lookup failed", { status: 503 });
  if (rebuilds.data[0]) {
    const advanced = await admin.rpc("advance_search_rebuild", { p_run: rebuilds.data[0].id });
    if (advanced.error) return new Response("Rebuild checkpoint failed", { status: 503 });
  }
  const { data, error } = await admin.rpc("claim_search_jobs", {});
  if (error) return new Response("Search claim failed", { status: 500 });
  let processed = 0, failed = 0;
  for (const job of (data || []) as unknown as Job[]) {
    let failure: string | undefined;
    try { await jobHeartbeat(admin, job)(); await sync[job.payload.entity](job.payload.id, jobHeartbeat(admin, job)); processed++; }
    catch { failed++; failure = "Search synchronization failed"; reportError("[search] queued sync failed", { jobId: job.id }); }
    const done = await admin.rpc("finish_remediation_job", { p_id: job.id, p_lease: job.lease_id, p_error: failure });
    if (done.error) return new Response("Search acknowledgement failed", { status: 500 });
  }
  return Response.json({ processed, failed }, { status: failed ? 503 : 200 });
}

export async function POST(request: Request) { return trackedWorker("search", request, () => run(request)); }

export const maxDuration = 300;

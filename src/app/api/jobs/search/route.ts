import { ensureSearchCollections } from "@/lib/search/collections";
import { trackedWorker } from "@/lib/tracked-worker";
import { jobHeartbeat } from "@/lib/job-lease";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexListingNow, indexListingsNow } from "@/lib/marketplace/search/indexing";
import { indexCarNow, indexProfileNow, indexUpdateNow } from "@/lib/explore/search/indexing";
import { typesenseConfigured } from "@/lib/search/typesense";
import { reportError } from "@/lib/monitoring";
const sync = { listing: indexListingNow, car: indexCarNow, profile: indexProfileNow, update: indexUpdateNow };
type Job = { id: string; lease_id: string; payload: { entity: keyof typeof sync; id: string } };
const BATCH = 500;
/** Stop starting batches after this long; maxDuration is 300 s. */
const BUDGET_MS = 120_000;
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
  // Batches of up to 500 documents (migration 20261011130000), for as long
  // as there is work and time; before that migration, ten one at a time.
  const started = Date.now();
  let processed = 0, failed = 0;
  while (Date.now() - started < BUDGET_MS) {
    let claim = await admin.rpc("claim_search_job_batch", { p_limit: BATCH });
    const batched = claim.error?.code !== "PGRST202";
    if (!batched) claim = await admin.rpc("claim_search_jobs");
    if (claim.error) return new Response("Search claim failed", { status: 500 });
    const jobs = (claim.data || []) as unknown as Job[];
    if (!jobs.length) break;
    const failures = new Map<string, string>();
    // Every part in the batch in one go; anything else one at a time.
    const listingJobs = batched ? jobs.filter((job) => job.payload.entity === "listing") : [];
    if (listingJobs.length) {
      // Every job's lease is renewed before the engine is written; any lost
      // lease abandons the batch (its jobs are retried).
      const lease = async () => {
        for (let i = 0; i < listingJobs.length; i += 50) await Promise.all(listingJobs.slice(i, i + 50).map((job) => jobHeartbeat(admin, job)()));
      };
      try {
        if (!(await indexListingsNow([...new Set(listingJobs.map((job) => job.payload.id))], lease))) {
          for (const job of listingJobs) await indexListingNow(job.payload.id, jobHeartbeat(admin, job));
        }
      } catch {
        for (const job of listingJobs) failures.set(job.id, "Search synchronization failed");
        reportError("[search] batched sync failed", { jobs: listingJobs.length });
      }
    }
    for (const job of jobs) {
      if (listingJobs.includes(job)) continue;
      try { await jobHeartbeat(admin, job)(); await sync[job.payload.entity](job.payload.id, jobHeartbeat(admin, job)); }
      catch { failures.set(job.id, "Search synchronization failed"); reportError("[search] queued sync failed", { jobId: job.id }); }
    }
    for (const job of jobs) {
      const failure = failures.get(job.id);
      if (failure) failed++; else processed++;
      const done = await admin.rpc("finish_remediation_job", { p_id: job.id, p_lease: job.lease_id, p_error: failure });
      if (done.error) return new Response("Search acknowledgement failed", { status: 500 });
    }
    if (!batched) break;
  }
  return Response.json({ processed, failed }, { status: failed ? 503 : 200 });
}

export async function POST(request: Request) { return trackedWorker("search", request, () => run(request)); }

export const maxDuration = 300;

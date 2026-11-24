import { flushMonitoring, reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";
import { trackedWorker } from "@/lib/tracked-worker";
import { cronAuthorized } from "@/lib/cron-auth";

/**
 * Listing-import sweep (0047) — the retention half of the importer:
 *
 *  1. Expire overdue rows: any import past `expires_at` that never became a
 *     listing moves to `expired`. Its staged photos then age out through the
 *     existing 48h media GC (0029) — one media lifecycle, not two.
 *  2. Scrub terminal rows: imported source text can carry personal residue
 *     (phone numbers, handles, addresses). Once a row is consumed/failed/
 *     expired and 7 days old, `normalized_source`/`extracted`/`imported_images`
 *     are cleared — DRVN keeps the operational metadata (source domain,
 *     status, error code), never an archive of external pages.
 *
 * SCHEDULING — pg_cron's drvn-listing-import-sweep job (20261004150000)
 * calls this route daily through invoke_remediation_worker, the same door as
 * media-gc. Each run is recorded as the `listingImports` worker family, so a
 * sweep that stops running shows as overdue in worker health. By hand:
 *   curl -X POST https://<host>/api/jobs/listing-imports \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */

export const dynamic = "force-dynamic";
// Two statements in the database; a minute is far more than they need, and a
// stated limit means the host's default (ten seconds on some plans) can't
// cut a large backlog short.
export const maxDuration = 60;

async function run(request: Request) {
  // 404, not 401 — the worker route pattern (0020): unauthenticated callers
  // learn nothing about which job endpoints exist.
  if (!cronAuthorized(request)) {
    return new Response(null, { status: 404 });
  }

  const admin = createAdminClient();
  let expired = 0;
  let scrubbed = 0;

  try {
    // Each half is one statement in the database (20261124200000). It used to
    // be a read of 200 rows and then one request per row, up to 10,000
    // requests a run. The status guard still decides: every state the sweep
    // touches may move to `expired`, and a row another transaction holds is
    // skipped and taken the next night.
    // A failed call throws: an unread queue is not an empty one, and a run
    // that answered 200 would be recorded as a healthy sweep.
    const moved = await admin.rpc("expire_stale_listing_imports", {});
    if (moved.error) throw new Error("Overdue imports could not be expired", { cause: moved.error });
    expired = moved.data ?? 0;

    const cleared = await admin.rpc("scrub_expired_listing_imports", {});
    if (cleared.error) throw new Error("Stale imports could not be scrubbed", { cause: cleared.error });
    scrubbed = cleared.data ?? 0;

    return Response.json({ expired, scrubbed });
  } catch (error) {
    reportError("[import-sweep] sweep crashed", error);
    return Response.json({ expired, scrubbed, error: "sweep failed" }, { status: 500 });
  } finally {
    await flushMonitoring();
  }
}

export async function POST(request: Request) {
  return trackedWorker("listingImports", request, () => run(request));
}

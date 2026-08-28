import { flushMonitoring, reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

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
 * Point the same external cron that runs media-gc at this route daily:
 *   curl -X POST https://<host>/api/jobs/listing-imports \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */

export const dynamic = "force-dynamic";

const BATCH = 200;
const SCRUB_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  // 404, not 401 — the worker route pattern (0020): unauthenticated callers
  // learn nothing about which job endpoints exist.
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 404 });
  }

  const admin = createAdminClient();
  let expired = 0;
  let scrubbed = 0;

  try {
    // 1. Expiry — row by row so the status-guard trigger stays the authority.
    const { data: overdue } = await admin
      .from("listing_imports")
      .select("id, status")
      .not("status", "in", "(consumed,expired)")
      .lt("expires_at", new Date().toISOString())
      .order("expires_at")
      .limit(BATCH);
    for (const row of overdue ?? []) {
      const { error } = await admin
        .from("listing_imports")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", row.status);
      if (error) reportError("[import-sweep] expire failed", { id: row.id, error });
      else expired++;
    }

    // 2. Scrub — clear payloads from old terminal rows that still carry them.
    const cutoff = new Date(Date.now() - SCRUB_AFTER_MS).toISOString();
    const { data: stale } = await admin
      .from("listing_imports")
      .select("id")
      .in("status", ["consumed", "expired", "failed"])
      .lt("updated_at", cutoff)
      .not("normalized_source", "is", null)
      .limit(BATCH);
    for (const row of stale ?? []) {
      const { error } = await admin
        .from("listing_imports")
        .update({
          normalized_source: null,
          extracted: null,
          imported_images: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) reportError("[import-sweep] scrub failed", { id: row.id, error });
      else scrubbed++;
    }

    return Response.json({ expired, scrubbed });
  } catch (error) {
    reportError("[import-sweep] sweep crashed", error);
    return Response.json({ expired, scrubbed, error: "sweep failed" }, { status: 500 });
  } finally {
    await flushMonitoring();
  }
}

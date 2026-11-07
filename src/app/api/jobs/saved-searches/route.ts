import { trackedWorker } from "@/lib/tracked-worker";
import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { listingRowsQuery } from "@/lib/marketplace/query";
import { readSavedSearch } from "@/lib/marketplace/saved-search";
import { marketplaceHref } from "@/lib/marketplace/state";
import { deliverNotification } from "@/lib/notifications/deliver";
import { flushMonitoring, reportError } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

/**
 * Saved-search matching (brief §C/§D). One pass: for every saved search with
 * alerts ON, find active listings created since the last check that match its
 * params, and raise ONE quiet in-app notification summarizing them — never a
 * per-listing flood. Runs behind CRON_SECRET like the transfer worker and
 * media GC; schedule it every ~30 min (see docs/production-runbook.md).
 *
 * The first pass for a search only stamps last_checked_at — nobody gets
 * alerted about inventory that predates their opt-in.
 */
async function run(request: Request) {
  if (!cronAuthorized(request)) {
    return new NextResponse(null, { status: 404 });
  }

  const admin = createAdminClient();
  const started = new Date().toISOString();
  let checked = 0;
  let matchedSearches = 0;
  let notified = 0;
  let failed = 0;

  try {
    const { data: searches, error: searchError } = await admin
      .from("saved_searches")
      .select("*")
      .eq("alert", true)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(200);
    if (searchError) throw new Error(`Saved search lookup: ${searchError.code}`);

    for (const search of searches ?? []) {
      checked += 1;
      const params = readSavedSearch(search.params);
      if (!params) { failed += 1; reportError("[saved-searches] unsupported definition", { id: search.id }); continue; }
      const since = search.last_checked_at;

      // First pass after opt-in: establish the baseline, alert from then on.
      if (!since) {
        const { error } = await admin
          .from("saved_searches")
          .update({ last_checked_at: started })
          .eq("id", search.id);
        if (error) { failed += 1; reportError("[saved-searches] baseline failed", { id: search.id, code: error.code }); }
        continue;
      }

      // All criteria and visibility run before the limit; unlike the old
      // candidate-prefix path, a new match cannot be lost behind older rows.
      const { data: matches, count, error } = await listingRowsQuery(admin, params, search.user_id)
        .gt("created_at", since).lte("created_at", started).neq("seller_id", search.user_id)
        .order("created_at", { ascending: false }).order("id").limit(3);
      if (error) {
        failed += 1;
        reportError("[saved-searches] match query failed", { id: search.id, code: error.code });
        continue;
      }
      const matchCount = count ?? matches?.length ?? 0;
      if (matchCount > 0) {
        matchedSearches += 1;
        const destination = marketplaceHref(params);
        const outcome = await deliverNotification({
          userId: search.user_id,
          kind: "saved_search",
          section: "marketplace",
          title:
            matchCount === 1
              ? `New match for ${search.name}: ${matches?.[0]?.title ?? "A new part"}`
              : `${matchCount} new parts match ${search.name}`,
          body: (matches ?? [])
            .slice(0, 3)
            .map((m) => m.title)
            .join(" · "),
          href: destination,
        });
        if (outcome === "delivered") notified += 1;
        // Retain the cursor after a failed delivery so the next pass retries.
        if (outcome === "failed") { failed += 1; continue; }
      }

      const { error: cursorError } = await admin
        .from("saved_searches")
        .update({
          last_checked_at: started,
          ...(matchCount > 0 ? { last_matched_at: started } : {}),
        })
        .eq("id", search.id);
      if (cursorError) { failed += 1; reportError("[saved-searches] cursor update failed", { id: search.id, code: cursorError.code }); }
    }

    return NextResponse.json({ checked, matchedSearches, notified, failed }, { status: failed ? 503 : 200 });
  } catch (error) {
    reportError("[saved-searches] pass failed", { error: String(error) });
    return NextResponse.json({ checked, matchedSearches, notified, error: true }, { status: 500 });
  } finally {
    await flushMonitoring();
  }
}

export async function POST(request: Request) { return trackedWorker("savedSearches", request, () => run(request)); }

export const maxDuration = 300;

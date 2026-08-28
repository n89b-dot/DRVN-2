import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getSearchProvider } from "@/lib/marketplace/search/provider";
import {
  buildGarageFitmentIndex,
  matchFitmentClaims,
  type FitmentClaim,
  type GarageCar,
} from "@/lib/marketplace/fitment";
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
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 404 });
  }

  const admin = createAdminClient();
  const started = new Date().toISOString();
  let checked = 0;
  let matchedSearches = 0;
  let notified = 0;

  try {
    const { data: searches } = await admin
      .from("saved_searches")
      .select("*")
      .eq("alert", true)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(200);

    for (const search of searches ?? []) {
      checked += 1;
      const params = (search.params ?? {}) as Record<string, string>;
      const since = search.last_checked_at;

      // First pass after opt-in: establish the baseline, alert from then on.
      if (!since) {
        await admin
          .from("saved_searches")
          .update({ last_checked_at: started })
          .eq("id", search.id);
        continue;
      }

      let query = admin
        .from("listings")
        .select("id, title, source_car_id")
        .eq("status", "active")
        .gt("created_at", since)
        .neq("seller_id", search.user_id)
        .limit(50);
      if (params.category) query = query.eq("category", params.category);
      if (params.subcategory) query = query.eq("subcategory", params.subcategory);
      if (params.condition)
        query = query.eq("condition", params.condition as "new" | "like_new" | "used" | "for_parts");
      if (params.location) query = query.ilike("location", `%${params.location}%`);
      const min = Number(params.min);
      const max = Number(params.max);
      if (params.min && Number.isFinite(min)) query = query.gte("price_cents", Math.round(min * 100));
      if (params.max && Number.isFinite(max)) query = query.lte("price_cents", Math.round(max * 100));
      if (params.q) {
        const ids = await getSearchProvider().searchIds(params.q, { limit: 300 }).catch(() => null);
        if (ids !== null) {
          if (ids.length === 0) {
            await admin.from("saved_searches").update({ last_checked_at: started }).eq("id", search.id);
            continue;
          }
          query = query.in("id", ids);
        } else {
          query = query.or(
            [
              `title.ilike.%${params.q.replace(/[,()]/g, " ")}%`,
              `description.ilike.%${params.q.replace(/[,()]/g, " ")}%`,
            ].join(","),
          );
        }
      }

      const { data: candidates, error } = await query;
      if (error) {
        reportError("[saved-searches] match query failed", { id: search.id, error });
        continue;
      }
      let matches = candidates ?? [];

      // "Fits my garage": same rule the marketplace filter uses — declared
      // fitment or source-car make/model against the saver's garage.
      if (params.fit === "1" && matches.length) {
        const { data: cars } = await admin
          .from("cars")
          .select("name, make, model, year")
          .eq("owner_id", search.user_id);
        const garage = (cars ?? []) as GarageCar[];
        const index = buildGarageFitmentIndex(garage);
        const listingIds = matches.map((m) => m.id);
        const sourceCarIds = matches.flatMap((m) => (m.source_car_id ? [m.source_car_id] : []));
        const [{ data: claims }, { data: sourceCars }] = await Promise.all([
          admin
            .from("listing_fitments")
            .select("listing_id, make, model, year_start, year_end")
            .in("listing_id", listingIds),
          sourceCarIds.length
            ? admin.from("cars").select("id, make, model").in("id", sourceCarIds)
            : Promise.resolve({ data: [] }),
        ]);
        matches = matches.filter((listing) => {
          const declared = (claims ?? []).filter((c) => c.listing_id === listing.id);
          if (declared.length && matchFitmentClaims(garage, declared as FitmentClaim[])) return true;
          const source = (sourceCars ?? []).find((c) => c.id === listing.source_car_id);
          return Boolean(
            source?.make &&
              source?.model &&
              index.get(`${source.make.toLowerCase()}|${source.model.toLowerCase()}`),
          );
        });
      }

      if (matches.length > 0) {
        matchedSearches += 1;
        const qs = new URLSearchParams({ ...params, sort: "newest" }).toString();
        const outcome = await deliverNotification({
          userId: search.user_id,
          kind: "saved_search",
          section: "marketplace",
          title:
            matches.length === 1
              ? `New match for ${search.name}: ${matches[0].title}`
              : `${matches.length} new parts match ${search.name}`,
          body: matches
            .slice(0, 3)
            .map((m) => m.title)
            .join(" · "),
          href: `/marketplace?${qs}`,
        });
        if (outcome === "delivered") notified += 1;
      }

      await admin
        .from("saved_searches")
        .update({
          last_checked_at: started,
          ...(matches.length > 0 ? { last_matched_at: started } : {}),
        })
        .eq("id", search.id);
    }

    return NextResponse.json({ checked, matchedSearches, notified });
  } catch (error) {
    reportError("[saved-searches] pass failed", { error: String(error) });
    return NextResponse.json({ checked, matchedSearches, notified, error: true }, { status: 500 });
  } finally {
    await flushMonitoring();
  }
}

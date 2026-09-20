import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ListingStatus } from "@/lib/database.types";
import { hydrateListingCards, type ListingPage } from "@/lib/marketplace/query";

import { storeStatusesFor } from "./visible-statuses";

/**
 * A member's store — the Parts tab on their profile (P-6).
 *
 * It runs its own rows query rather than reusing the marketplace's, for one
 * reason the plan is explicit about: the store shows SOLD parts and the
 * marketplace never does. Bending the marketplace query to carry a seller
 * key and a wider status set would put an owner-visible state one URL
 * parameter away from every public browse surface.
 *
 * What it does share is everything after retrieval: `hydrateListingCards`
 * and `ListingCard`, so a part looks and behaves the same in a store as it
 * does in the marketplace. That is the whole of P-6 — "a person's store
 * looks and works like the marketplace".
 *
 * The seller and status filters are applied IN the query, before the count
 * and the page window. Filtering a page after fetching it would give a count
 * that disagrees with the rows and a last page that is silently short.
 */
export async function fetchStorePage(
  supabase: SupabaseClient<Database>,
  {
    sellerId,
    isOwner,
    tab,
    page = 1,
    pageSize = 24,
  }: {
    sellerId: string;
    isOwner: boolean;
    tab: string | undefined;
    page?: number;
    pageSize?: number;
  }
): Promise<ListingPage> {
  const statuses = storeStatusesFor(isOwner, tab);
  const current = Math.max(1, page);
  const from = (current - 1) * pageSize;

  if (!statuses.length) {
    return { status: "success", results: [], page: current, pageSize, hasMore: false, total: 0 };
  }

  const { data, count, error } = await supabase
    .from("listings")
    .select(
      "id, title, description, created_at, price_cents, shipping_cents, shipping_mode, allows_collection, condition, location, source_car_id, part_number, brand, part_miles, part_miles_unit, seller_id, status",
      { count: "exact" }
    )
    .eq("seller_id", sellerId)
    .in("status", statuses as ListingStatus[])
    .order("created_at", { ascending: false })
    // Listings made together share a timestamp; without a tie-break a part
    // can sit on two pages, or on neither.
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) {
    return {
      status: "error",
      results: [],
      page: current,
      pageSize,
      hasMore: false,
      total: null,
      errorReference: error.code ?? "store_query_failed",
    };
  }

  const results = await hydrateListingCards(supabase, data ?? []);
  const total = count ?? results.length;
  return {
    status: "success",
    results,
    page: current,
    pageSize,
    hasMore: from + results.length < total,
    total,
  };
}

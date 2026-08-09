import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { ListingCardData } from "@/components/ui";
import {
  buildGarageFitmentIndex,
  matchFitmentClaims,
  matchGarageFitment,
  type GarageCar,
} from "@/lib/marketplace/fitment";
import { reportError } from "@/lib/monitoring";

export type ListingSort = "newest" | "price_asc" | "price_desc";

export type ListingFilters = {
  q?: string;
  category?: string;
  subcategory?: string;
  condition?: string;
  min?: string;
  max?: string;
  fit?: string;
  location?: string;
  sort?: string;
  page?: string;
};

export type ListingPage = {
  results: ListingCardData[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export const PAGE_SIZE = 24;

/**
 * How many people are watching each of these listings.
 *
 * Counted from `saves` rather than a denormalised column: the number is small,
 * always current, and a stored counter would need a trigger to stay honest.
 * Returns a map so callers can render "—" for anything with no watchers rather
 * than a misleading 0.
 */
export async function fetchWatchCounts(
  supabase: SupabaseClient<Database>,
  listingIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!listingIds.length) return counts;

  const { data, error } = await supabase
    .from("saves")
    .select("target_id")
    .eq("target_type", "listing")
    .in("target_id", listingIds);

  if (error) {
    reportError("[marketplace] watch counts failed", error);
    return counts;
  }
  for (const row of data ?? []) {
    counts.set(row.target_id, (counts.get(row.target_id) ?? 0) + 1);
  }
  return counts;
}

function parseSort(value: string | undefined): ListingSort {
  return value === "price_asc" || value === "price_desc" ? value : "newest";
}

function parsePage(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/**
 * Fetches listings with cover images and (when logged in) a metadata-based
 * "fits your car" hint: the listing's source car shares make+model with a car in
 * the viewer's garage. Never derived from seller compatibility notes (PRD §7.1).
 *
 * Changes from the original: real pagination (it was a hard limit of 48 with no
 * offset, presented as if complete), sort control, a location filter, and search
 * across description and compatibility notes rather than title only.
 *
 * The "fits my car" filter is applied in the database via a pre-resolved id list
 * rather than after fetching a page — filtering post-fetch meant a filtered page
 * could come back empty while matches sat just beyond the cut-off.
 */
export async function fetchListings(
  supabase: SupabaseClient<Database>,
  filters: ListingFilters,
  viewerId?: string
): Promise<ListingPage> {
  const sort = parseSort(filters.sort);
  const page = parsePage(filters.page);
  const from = (page - 1) * PAGE_SIZE;

  // Resolve the viewer's garage first: the fitment filter needs to constrain the
  // query itself, not the page it returns.
  let fitSourceCarIds: string[] = [];
  let fitDeclaredListingIds: string[] = [];
  let garageByKey = new Map<string, string>();
  let garageCars: GarageCar[] = [];

  if (viewerId) {
    const { data } = await supabase
      .from("cars")
      .select("name, make, model, year")
      .eq("owner_id", viewerId);
    garageCars = data ?? [];
    garageByKey = buildGarageFitmentIndex(garageCars);

    if (filters.fit === "1" && garageByKey.size) {
      const makes = [...new Set(garageCars.map((c) => c.make).filter(Boolean))] as string[];
      // Two ways a listing can fit (both seller-stated): its source car
      // matches the garage, or a structured fitment row (0025) does. The
      // make pre-filter runs case-insensitively — fitment rows come from
      // the vPIC picker whose casing ("Volkswagen") needn't match a
      // hand-typed garage make ("volkswagen").
      // Quoted so multi-word makes ("Aston Martin") survive the PostgREST
      // or-syntax; quotes/commas/parens in the value are stripped, not data.
      const makeClause = makes
        .map((m) => `make.ilike."${m.replace(/["\\,()]/g, " ").trim()}"`)
        .join(",");
      const [{ data: matchingCars }, { data: claims }] = await Promise.all([
        supabase.from("cars").select("id, make, model").or(makeClause),
        supabase
          .from("listing_fitments")
          .select("listing_id, make, model, year_start, year_end")
          .or(makeClause),
      ]);

      fitSourceCarIds = (matchingCars ?? [])
        .filter((c) => matchGarageFitment(garageByKey, c.make, c.model))
        .map((c) => c.id);
      fitDeclaredListingIds = [
        ...new Set(
          (claims ?? [])
            .filter((f) => matchFitmentClaims(garageCars, [f]))
            .map((f) => f.listing_id)
        ),
      ];
    }
  }

  let query = supabase
    .from("listings")
    .select(
      "id, title, price_cents, shipping_cents, condition, location, source_car_id, part_number",
      { count: "exact" }
    )
    .eq("status", "active");

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.subcategory) query = query.eq("subcategory", filters.subcategory);
  if (filters.condition) {
    query = query.eq("condition", filters.condition as "new" | "like_new" | "used" | "for_parts");
  }
  if (filters.location) query = query.ilike("location", `%${filters.location}%`);

  if (filters.q) {
    // Escape the PostgREST `or` separators before interpolating user input.
    const term = filters.q.replace(/[,()]/g, " ").trim();
    if (term) {
      query = query.or(
        [
          `title.ilike.%${term}%`,
          `description.ilike.%${term}%`,
          `compatibility_notes.ilike.%${term}%`,
        ].join(",")
      );
    }
  }

  const min = Number(filters.min);
  const max = Number(filters.max);
  if (filters.min && Number.isFinite(min) && min >= 0) {
    query = query.gte("price_cents", Math.round(min * 100));
  }
  if (filters.max && Number.isFinite(max) && max >= 0) {
    query = query.lte("price_cents", Math.round(max * 100));
  }

  if (filters.fit === "1") {
    // No garage, or nothing matching by either route → no results by
    // definition. Say so rather than showing an unfiltered page.
    if (!fitSourceCarIds.length && !fitDeclaredListingIds.length) {
      return { results: [], total: 0, page, pageSize: PAGE_SIZE, hasMore: false };
    }
    const clauses = [
      ...(fitSourceCarIds.length ? [`source_car_id.in.(${fitSourceCarIds.join(",")})`] : []),
      ...(fitDeclaredListingIds.length ? [`id.in.(${fitDeclaredListingIds.join(",")})`] : []),
    ];
    query = query.or(clauses.join(","));
  }

  if (sort === "price_asc") query = query.order("price_cents", { ascending: true });
  else if (sort === "price_desc") query = query.order("price_cents", { ascending: false });
  else query = query.order("created_at", { ascending: false });

  const { data: listings, count, error } = await query.range(from, from + PAGE_SIZE - 1);

  if (error) {
    reportError("[marketplace] listing query failed", error);
    return { results: [], total: 0, page, pageSize: PAGE_SIZE, hasMore: false };
  }
  if (!listings?.length) {
    return { results: [], total: count ?? 0, page, pageSize: PAGE_SIZE, hasMore: false };
  }

  const ids = listings.map((l) => l.id);
  const [{ data: images }, watchCounts] = await Promise.all([
    supabase
      .from("listing_images")
      .select("listing_id, url, position")
      .in("listing_id", ids)
      .order("position"),
    fetchWatchCounts(supabase, ids),
  ]);

  const coverByListing = new Map<string, string>();
  for (const image of images ?? []) {
    if (!coverByListing.has(image.listing_id)) coverByListing.set(image.listing_id, image.url);
  }

  // Fitment hint for the rows on this page — declared rows (0025) first,
  // source-car match as the fallback, mirroring the listing page's order.
  const fitByListing = new Map<string, string>();
  const sourceCarIds = listings.map((l) => l.source_car_id).filter(Boolean) as string[];
  if (viewerId && garageByKey.size) {
    const [{ data: sourceCars }, { data: pageClaims }] = await Promise.all([
      sourceCarIds.length
        ? supabase.from("cars").select("id, make, model").in("id", sourceCarIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from("listing_fitments")
        .select("listing_id, make, model, year_start, year_end")
        .in("listing_id", ids),
    ]);

    const claimsByListing = new Map<string, NonNullable<typeof pageClaims>>();
    for (const claim of pageClaims ?? []) {
      const bucket = claimsByListing.get(claim.listing_id) ?? [];
      bucket.push(claim);
      claimsByListing.set(claim.listing_id, bucket);
    }
    const sourceById = new Map((sourceCars ?? []).map((c) => [c.id, c]));
    for (const listing of listings) {
      const declared = matchFitmentClaims(garageCars, claimsByListing.get(listing.id) ?? []);
      const source = listing.source_car_id ? sourceById.get(listing.source_car_id) : null;
      const match =
        declared ?? (source ? matchGarageFitment(garageByKey, source.make, source.model) : null);
      if (match) fitByListing.set(listing.id, match);
    }
  }

  const total = count ?? listings.length;

  return {
    results: listings.map((l) => ({
      id: l.id,
      title: l.title,
      price_cents: l.price_cents,
      condition: l.condition,
      location: l.location,
      cover_url: coverByListing.get(l.id) ?? null,
      fits_car_name: fitByListing.get(l.id) ?? null,
      part_number: l.part_number,
      watch_count: watchCounts.get(l.id) ?? 0,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    hasMore: from + listings.length < total,
  };
}

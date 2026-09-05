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
import { capture } from "@/lib/analytics";
import { classifyQuery } from "@/lib/marketplace/search/normalize";
import { getSearchProvider } from "@/lib/marketplace/search/provider";
import { resolveVehicleFilter } from "@/lib/vehicles/catalog";
import { vehicleLabel } from "@/lib/vehicles/label";

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
  /** Canonical catalog vehicle identity, "<makeId>" or "<makeId>-<modelId>"
   *  (0041). Matches by the SAME seller-stated routes as `fit`: the listing's
   *  declared fitment rows or its source car — never compatibility notes. */
  vehicle?: string;
  /** Model-year bounds on the SOURCE car (the build the part came off).
   *  Listings with no source car can't answer and are excluded while set. */
  ymin?: string;
  ymax?: string;
  sort?: string;
  page?: string;
};

export type ListingPage = {
  searchTruncated?: boolean;
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

type HydratableListingRow = {
  id: string;
  title: string;
  price_cents: number;
  shipping_cents?: number | null;
  condition: string | null;
  location: string | null;
  part_number?: string | null;
  seller_id?: string | null;
  /** The build the part came off — hydrates the provenance line. */
  source_car_id?: string | null;
  /** Non-active rows render their state as the card's ink flag. */
  status?: string | null;
};

/**
 * Turns raw listing rows into ListingCardData: cover image, watch count and
 * the seller trust line (profile name + review average), batched across the
 * whole row set. One shape for every surface that renders a ListingCard —
 * the marketplace grid and the PDP rails previously selected different
 * fields, so the same component silently rendered two densities on one page.
 */
export async function hydrateListingCards(
  supabase: SupabaseClient<Database>,
  rows: HydratableListingRow[]
): Promise<ListingCardData[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const sellerIds = [...new Set(rows.map((r) => r.seller_id).filter(Boolean))] as string[];
  const sourceCarIds = [...new Set(rows.map((r) => r.source_car_id).filter(Boolean))] as string[];

  const [
    { data: images },
    watchCounts,
    { data: sellerProfiles },
    { data: sellerReviews },
    { data: sourceCars },
  ] = await Promise.all([
      supabase
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", ids)
        .order("position"),
      fetchWatchCounts(supabase, ids),
      sellerIds.length
        ? supabase.from("profiles").select("id, display_name, username").in("id", sellerIds)
        : Promise.resolve({ data: [] }),
      sellerIds.length
        ? supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", sellerIds)
        : Promise.resolve({ data: [] }),
      // The source car is always loaded: every card names the car the part
      // came off, which is the marketplace's whole premise — and links to
      // the build when it's public.
      sourceCarIds.length
        ? supabase.from("cars").select("id, year, make, model, slug, is_public").in("id", sourceCarIds)
        : Promise.resolve({ data: [] }),
    ]);

  const coverByListing = new Map<string, string>();
  for (const image of images ?? []) {
    if (!coverByListing.has(image.listing_id)) coverByListing.set(image.listing_id, image.url);
  }

  const ratingBySeller = new Map<string, { sum: number; n: number }>();
  for (const r of sellerReviews ?? []) {
    const agg = ratingBySeller.get(r.reviewee_id) ?? { sum: 0, n: 0 };
    agg.sum += r.rating;
    agg.n += 1;
    ratingBySeller.set(r.reviewee_id, agg);
  }
  const sellerById = new Map(
    (sellerProfiles ?? []).map((p) => {
      const agg = ratingBySeller.get(p.id);
      return [
        p.id,
        {
          name: p.display_name ?? (p.username ? `@${p.username}` : "Seller"),
          rating: agg ? (agg.sum / agg.n).toFixed(1) : null,
          review_count: agg?.n ?? 0,
        },
      ] as const;
    })
  );

  const sourceById = new Map((sourceCars ?? []).map((c) => [c.id, c]));

  return rows.map((r) => {
    const source = r.source_car_id ? sourceById.get(r.source_car_id) : null;
    const sourceName = vehicleLabel(source);
    return {
      id: r.id,
      title: r.title,
      price_cents: r.price_cents,
      shipping_cents: r.shipping_cents,
      condition: r.condition,
      location: r.location,
      cover_url: coverByListing.get(r.id) ?? null,
      part_number: r.part_number,
      watch_count: watchCounts.get(r.id) ?? 0,
      seller: r.seller_id ? (sellerById.get(r.seller_id) ?? null) : null,
      seller_id: r.seller_id ?? null,
      source_car_name: sourceName || null,
      source_car_slug: source?.is_public && sourceName ? source.slug : null,
      status_flag: r.status && r.status !== "active" ? r.status : null,
    };
  });
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
  let searchTruncated = false;
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

  // Arbitrary selected-vehicle filter (brief §17/§37) — the shared canonical
  // route for "parts for a Volkswagen Golf R", used by /marketplace and by
  // Explore's Parts scope. Same seller-stated-only doctrine as `fit`: a
  // listing matches through its declared fitment rows (0025) or through its
  // source car — catalog ids where they exist, exact-string ilike for the
  // frozen snapshots, never free-text compatibility notes.
  let vehicleSourceCarIds: string[] = [];
  let vehicleListingIds: string[] = [];
  let vehicleActive = false;
  if (filters.vehicle) {
    const selection = await resolveVehicleFilter(filters.vehicle);
    if (selection) {
      vehicleActive = true;
      const exact = (value: string) => `"${value.replace(/["\\,()]/g, " ").trim()}"`;
      const carClause = selection.modelId
        ? `catalog_model_id.eq.${selection.modelId},and(make.ilike.${exact(selection.make)},model.ilike.${exact(selection.model ?? "")})`
        : `catalog_make_id.eq.${selection.makeId},make.ilike.${exact(selection.make)}`;
      let claimsQuery = supabase
        .from("listing_fitments")
        .select("listing_id")
        .ilike("make", selection.make)
        .limit(1000);
      if (selection.model) claimsQuery = claimsQuery.ilike("model", selection.model);
      const [{ data: matchingCars }, { data: claims }] = await Promise.all([
        supabase.from("cars").select("id").or(carClause).limit(1000),
        claimsQuery,
      ]);
      vehicleSourceCarIds = (matchingCars ?? []).map((c) => c.id);
      vehicleListingIds = [...new Set((claims ?? []).map((f) => f.listing_id))];
    }
    // An unresolvable vehicle param (stale catalog id in a pasted URL) is
    // treated as no filter rather than an error page.
  }

  let query = supabase
    .from("listings")
    .select(
      "id, title, price_cents, shipping_cents, condition, location, source_car_id, part_number, seller_id",
      { count: "exact" }
    )
    .eq("status", "active");

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.subcategory) query = query.eq("subcategory", filters.subcategory);
  if (filters.condition) {
    query = query.eq("condition", filters.condition as "new" | "like_new" | "used" | "for_parts");
  }
  if (filters.location) query = query.ilike("location", `%${filters.location}%`);

  // Year is a fact about the source car, not the listing: narrow to listings
  // whose build falls in the range. A listing without a source car has no
  // year to match and drops out while the bound is set.
  if (filters.ymin || filters.ymax) {
    let yearCars = supabase.from("cars").select("id");
    if (filters.ymin) yearCars = yearCars.gte("year", Number(filters.ymin));
    if (filters.ymax) yearCars = yearCars.lte("year", Number(filters.ymax));
    const { data: yearMatches } = await yearCars.limit(1000);
    const yearCarIds = (yearMatches ?? []).map((c) => c.id);
    query = yearCarIds.length
      ? query.in("source_car_id", yearCarIds)
      : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  if (filters.q) {
    // The search seam (§B1): a provider produces ranked candidate ids — two
    // lanes, fuzzy human discovery vs exact identifier matching (see
    // src/lib/marketplace/search/) — and this canonical Postgres query then
    // applies every other filter and the sort on top. null = provider
    // couldn't answer → the legacy ilike clause below keeps search working.
    const term = filters.q.replace(/[,()]/g, " ").trim();
    if (term) {
      const ids = await getSearchProvider()
        .searchIds(term, { limit: 300 })
        .catch(() => null);
      if (ids !== null) {
        searchTruncated = ids.length >= 300;
        if (ids.length === 0) {
          // A definitive empty answer — force an empty page without a
          // degenerate `in ()` clause.
          query = query.eq("id", "00000000-0000-0000-0000-000000000000");
        } else {
          query = query.in("id", ids);
        }
      } else {
        const clauses = [
          `title.ilike.%${term}%`,
          `description.ilike.%${term}%`,
          `compatibility_notes.ilike.%${term}%`,
          `part_number.ilike.%${term}%`,
        ];
        const compact = term.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        if (compact.length >= 4 && /\d/.test(compact)) {
          clauses.push(`part_number_compact.ilike.%${compact}%`);
        }
        query = query.or(clauses.join(","));
      }
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

  if (vehicleActive) {
    // Nothing on the platform matches this vehicle by either seller-stated
    // route → an honest empty page, same doctrine as `fit` below.
    if (!vehicleSourceCarIds.length && !vehicleListingIds.length) {
      return { searchTruncated, results: [], total: 0, page, pageSize: PAGE_SIZE, hasMore: false };
    }
    const clauses = [
      ...(vehicleSourceCarIds.length ? [`source_car_id.in.(${vehicleSourceCarIds.join(",")})`] : []),
      ...(vehicleListingIds.length ? [`id.in.(${vehicleListingIds.join(",")})`] : []),
    ];
    // A separate .or() from the fit clause: PostgREST ANDs them, which is the
    // correct semantics (fits my garage AND is for this vehicle).
    query = query.or(clauses.join(","));
  }

  if (filters.fit === "1") {
    // No garage, or nothing matching by either route → no results by
    // definition. Say so rather than showing an unfiltered page.
    if (!fitSourceCarIds.length && !fitDeclaredListingIds.length) {
      return { searchTruncated, results: [], total: 0, page, pageSize: PAGE_SIZE, hasMore: false };
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

  // Product telemetry (§AE) — first page only, so pagination doesn't
  // multiply one search into many events. Coarse properties only.
  if (page === 1 && !error) {
    if (filters.q?.trim()) {
      capture(viewerId ?? null, {
        event: "search_performed",
        props: { lane: classifyQuery(filters.q).kind, results: count ?? 0 },
      });
    }
    if (filters.fit === "1" && viewerId) {
      capture(viewerId, { event: "fitment_filter_used" });
    }
  }

  if (error) {
    reportError("[marketplace] listing query failed", error);
    return { searchTruncated, results: [], total: 0, page, pageSize: PAGE_SIZE, hasMore: false };
  }
  if (!listings?.length) {
    return { searchTruncated, results: [], total: count ?? 0, page, pageSize: PAGE_SIZE, hasMore: false };
  }

  const ids = listings.map((l) => l.id);
  // Covers, watch counts and seller trust hydrate in parallel with the
  // fitment lookups below.
  const cardsPromise = hydrateListingCards(supabase, listings);
  // The viewer's saves and likes over this page plus public like/question
  // counts, so each card's engagement strip renders pre-fired. All bounded
  // by the page's ids.
  const viewerSavesPromise = viewerId
    ? supabase
        .from("saves")
        .select("target_id")
        .eq("user_id", viewerId)
        .eq("target_type", "listing")
        .in("target_id", ids)
    : Promise.resolve({ data: [] as { target_id: string }[] });
  const likesPromise = supabase
    .from("likes")
    .select("target_id")
    .eq("target_type", "listing")
    .in("target_id", ids);
  const viewerLikesPromise = viewerId
    ? supabase
        .from("likes")
        .select("target_id")
        .eq("user_id", viewerId)
        .eq("target_type", "listing")
        .in("target_id", ids)
    : Promise.resolve({ data: [] as { target_id: string }[] });
  const questionsPromise = supabase
    .from("listing_questions")
    .select("listing_id")
    .in("listing_id", ids);

  // Fitment hint for the rows on this page — declared rows (0025) first,
  // source-car match as the fallback, mirroring the listing page's order.
  // (The provenance line itself comes from hydrateListingCards.)
  const fitByListing = new Map<string, string>();
  if (viewerId && garageByKey.size) {
    const sourceCarIds = listings.map((l) => l.source_car_id).filter(Boolean) as string[];
    const [{ data: pageClaims }, { data: sourceCars }] = await Promise.all([
      supabase
        .from("listing_fitments")
        .select("listing_id, make, model, year_start, year_end")
        .in("listing_id", ids),
      sourceCarIds.length
        ? supabase.from("cars").select("id, make, model").in("id", sourceCarIds)
        : Promise.resolve({ data: [] as { id: string; make: string | null; model: string | null }[] }),
    ]);
    const sourceById = new Map((sourceCars ?? []).map((c) => [c.id, c]));

    const claimsByListing = new Map<string, NonNullable<typeof pageClaims>>();
    for (const claim of pageClaims ?? []) {
      const bucket = claimsByListing.get(claim.listing_id) ?? [];
      bucket.push(claim);
      claimsByListing.set(claim.listing_id, bucket);
    }
    for (const listing of listings) {
      const declared = matchFitmentClaims(garageCars, claimsByListing.get(listing.id) ?? []);
      const source = listing.source_car_id ? sourceById.get(listing.source_car_id) : null;
      const match =
        declared ?? (source ? matchGarageFitment(garageByKey, source.make, source.model) : null);
      if (match) fitByListing.set(listing.id, match);
    }
  }

  const total = count ?? listings.length;
  const [cards, { data: viewerSaves }, { data: likeRows }, { data: viewerLikes }, { data: questionRows }] =
    await Promise.all([cardsPromise, viewerSavesPromise, likesPromise, viewerLikesPromise, questionsPromise]);
  const savedIds = new Set((viewerSaves ?? []).map((s) => s.target_id));
  const likedIds = new Set((viewerLikes ?? []).map((l) => l.target_id));
  const likeCounts = new Map<string, number>();
  for (const row of likeRows ?? []) {
    likeCounts.set(row.target_id, (likeCounts.get(row.target_id) ?? 0) + 1);
  }
  const questionCounts = new Map<string, number>();
  for (const row of questionRows ?? []) {
    questionCounts.set(row.listing_id, (questionCounts.get(row.listing_id) ?? 0) + 1);
  }

  return {
    results: cards.map((card) => ({
      ...card,
      fits_car_name: fitByListing.get(card.id) ?? null,
      viewer_saved: savedIds.has(card.id),
      viewer_liked: likedIds.has(card.id),
      like_count: likeCounts.get(card.id) ?? 0,
      question_count: questionCounts.get(card.id) ?? 0,
    })),
    total,
    searchTruncated,
    page,
    pageSize: PAGE_SIZE,
    hasMore: from + listings.length < total,
  };
}

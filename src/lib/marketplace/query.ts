import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { ListingCardData } from "@/components/ui";
import {
  buildGarageFitmentIndex,
  explainMatch,
  type MatchEvidence,
  type GarageCar,
} from "@/lib/marketplace/fitment";
import { reportError } from "@/lib/monitoring";
import { resolveVehicleFilter, type VehicleFilterSelection } from "@/lib/vehicles/catalog";
import { vehicleLabel } from "@/lib/vehicles/label";
import { normalizeMarketplaceState, type ListingFilters, type ListingSort } from "./state";
export type { ListingFilters, ListingSort } from "./state";

type ListingPageContext = {
  searchTruncated?: boolean;
  page: number;
  pageSize: number;
};
export type ListingPage = ListingPageContext & (
  | { status: "success"; results: ListingCardData[]; total: number; hasMore: boolean }
  | { status: "error"; results: []; total: null; hasMore: false; errorReference: string }
);

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

/**
 * The card shows ONE line of the seller's own description — their first
 * sentence, not a paraphrase. A card that paraphrases is a card that can be
 * wrong about somebody else's part.
 */
function firstLine(description: string | null | undefined): string | null {
  const text = (description ?? "").trim();
  if (!text) return null;
  const line = text.split(/\n|(?<=[.!?])\s/)[0]?.trim() ?? "";
  return line ? line.slice(0, 160) : null;
}

type HydratableListingRow = {
  id: string;
  title: string;
  price_cents: number;
  shipping_cents?: number | null;
  allows_collection?: boolean;
  shipping_mode?: string;
  condition: string | null;
  location: string | null;
  part_number?: string | null;
  /** M-6 / M-7 / the card's one description line. */
  brand?: string | null;
  part_miles?: number | null;
  part_miles_unit?: string | null;
  description?: string | null;
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
    { data: activeCounts },
  ] = await Promise.all([
      supabase
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", ids)
        .order("position"),
      fetchWatchCounts(supabase, ids),
      sellerIds.length
        ? supabase
            .from("profiles")
            .select("id, display_name, username, avatar_url")
            .in("id", sellerIds)
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
      // M-5's "N for sale": one RPC for every seller on the page rather than
      // a count query per card.
      sellerIds.length
        ? supabase.rpc("seller_active_counts", { p_sellers: sellerIds })
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
  const activeBySeller = new Map(
    ((activeCounts ?? []) as { seller_id: string; total: number }[]).map((row) => [
      row.seller_id,
      Number(row.total),
    ])
  );

  const sellerById = new Map(
    (sellerProfiles ?? []).map((p) => {
      const agg = ratingBySeller.get(p.id);
      return [
        p.id,
        {
          name: p.display_name ?? (p.username ? `@${p.username}` : "Seller"),
          username: p.username,
          avatar_url: p.avatar_url,
          active_count: activeBySeller.get(p.id) ?? 0,
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
      allows_collection: r.allows_collection,
      shipping_mode: r.shipping_mode === "flat" || r.shipping_mode === "drvn" || r.shipping_mode === "pickup_only" ? r.shipping_mode : undefined,
      condition: r.condition,
      location: r.location,
      cover_url: coverByListing.get(r.id) ?? null,
      part_number: r.part_number,
      brand: r.brand ?? null,
      part_miles: r.part_miles ?? null,
      part_miles_unit: r.part_miles_unit ?? null,
      // The seller's own first line, not a generated summary — a card that
      // paraphrases is a card that can be wrong.
      summary: firstLine(r.description),
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

/** Canonical filtered relation for browsing and saved-search workers. Workers
 * pass their explicit owner; the database enforces shopper-visible evidence. */
export function listingRowsQuery(supabase: SupabaseClient<Database>, raw: ListingFilters, workerViewer?: string) {
  const filters = normalizeMarketplaceState(raw);
  let query = supabase.rpc("marketplace_browse_rows", {
    p_query: filters.q ?? "", p_vehicle: filters.vehicle ?? "", p_vyear: Number(filters.vyear ?? 0),
    p_ymin: Number(filters.ymin ?? 0), p_ymax: Number(filters.ymax ?? 9999), p_fit: filters.fit === "1",
    ...(workerViewer ? { p_viewer: workerViewer } : {}),
  }, { count: "exact" }).select("id, title, description, created_at, price_cents, shipping_cents, shipping_mode, allows_collection, condition, location, source_car_id, part_number, brand, part_miles, part_miles_unit, seller_id");
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.subcategory) query = query.eq("subcategory", filters.subcategory);
  if (filters.condition) query = query.eq("condition", filters.condition as "new" | "like_new" | "used" | "for_parts");
  // Exact, not ilike: the value comes from the brand facet, which is built
  // from the brands actually stored, so a partial match would only ever
  // widen the filter past what the member picked.
  if (filters.brand) query = query.eq("brand", filters.brand);
  if (filters.location) query = query.ilike("location", `%${filters.location.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  if (filters.min) query = query.gte("price_cents", Math.round(Number(filters.min) * 100));
  if (filters.max) query = query.lte("price_cents", Math.round(Number(filters.max) * 100));
  return query;
}

/** Fetch a page and hydrate the same evidence shown on listing detail. */
export async function fetchListings(
  supabase: SupabaseClient<Database>,
  filters: ListingFilters,
  viewerId?: string,
  context?: {
    garage: Promise<GarageCar[]>;
    selection: Promise<VehicleFilterSelection | null>;
  }
): Promise<ListingPage> {
  const started = performance.now();
  filters = normalizeMarketplaceState(filters);
  const searchTruncated = false;
  const sort = parseSort(filters.sort);
  const page = parsePage(filters.page);
  const from = (page - 1) * PAGE_SIZE;

  // The RPC applies filters in SQL. Garage/catalog reads only decorate cards,
  // so run them alongside retrieval, reusing the page's reads when supplied.
  const garagePromise = context?.garage ?? (viewerId
    ? Promise.resolve(supabase.from("cars").select("name, make, model, year").eq("owner_id", viewerId)).then(({ data }) => data ?? [])
    : Promise.resolve([] as GarageCar[]));
  const selectionPromise = context?.selection ?? (filters.vehicle ? resolveVehicleFilter(filters.vehicle) : Promise.resolve(null));
  let query = listingRowsQuery(supabase, filters);

  if (sort === "price_asc") query = query.order("price_cents", { ascending: true });
  else if (sort === "price_desc") query = query.order("price_cents", { ascending: false });
  else query = query.order("created_at", { ascending: false });

  const [retrieval, garageCars, selection] = await Promise.all([
    query.order("id").range(from, from + PAGE_SIZE - 1), garagePromise, selectionPromise,
  ]);
  const garageByKey = buildGarageFitmentIndex(garageCars);
  let { data: listings, count, error } = retrieval;
  if (error?.code === "PGRST103" && page > 1) {
    const first = await listingRowsQuery(supabase, filters).order("id").range(0, 0);
    if (!first.error) { listings = []; count = first.count; error = null; }
  }
  console.info("[marketplace:retrieval]", { outcome: error ? "error" : count === 0 ? "zero" : "success", duration_ms: Math.round(performance.now() - started), count: error ? null : count, page });

  if (error) {
    const errorReference = crypto.randomUUID();
    reportError("[marketplace] listing query failed", { reference: errorReference, code: error.code, message: error.message });
    return { status: "error", errorReference, results: [], total: null, page, pageSize: PAGE_SIZE, hasMore: false };
  }
  if (!listings?.length) {
    return { status: "success", searchTruncated, results: [], total: count ?? 0, page, pageSize: PAGE_SIZE, hasMore: false };
  }

  const ids = listings.map((l) => l.id);
  // Covers, watch counts and seller trust hydrate in parallel with the
  // fitment lookups below.
  const cardsPromise = hydrateListingCards(supabase, listings);
  // The viewer's saves and likes over this page plus public like/question
  // counts, so each card's engagement strip renders pre-fired. All bounded
  // by the page's ids.
  const viewerSavesPromise = Promise.resolve(viewerId
    ? supabase
        .from("saves")
        .select("target_id")
        .eq("user_id", viewerId)
        .eq("target_type", "listing")
        .in("target_id", ids)
    : { data: [] as { target_id: string }[] });
  const likesPromise = Promise.resolve(supabase
    .from("likes")
    .select("target_id")
    .eq("target_type", "listing")
    .in("target_id", ids));
  const viewerLikesPromise = Promise.resolve(viewerId
    ? supabase
        .from("likes")
        .select("target_id")
        .eq("user_id", viewerId)
        .eq("target_type", "listing")
        .in("target_id", ids)
    : { data: [] as { target_id: string }[] });
  const questionsPromise = Promise.resolve(supabase
    .from("listing_questions")
    .select("listing_id")
    .in("listing_id", ids));

  // Fitment hint for the rows on this page — declared rows (0025) first,
  // source-car match as the fallback, mirroring the listing page's order.
  // (The provenance line itself comes from hydrateListingCards.)
  const fitByListing = new Map<string, string>();
  const evidenceByListing = new Map<string, MatchEvidence>();
  if (selection || (viewerId && garageByKey.size)) {
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
      const source = listing.source_car_id ? sourceById.get(listing.source_car_id) ?? null : null;
      const claims = claimsByListing.get(listing.id) ?? [];
      if (selection) {
        evidenceByListing.set(listing.id, explainMatch({ make: selection.make, model: selection.model, year: filters.vyear ? Number(filters.vyear) : null }, claims, source));
      } else {
        for (const car of garageCars) {
          const evidence = explainMatch(car, claims, source);
          if (["seller_stated", "source_model"].includes(evidence.kind)) {
            fitByListing.set(listing.id, car.name);
            evidenceByListing.set(listing.id, { ...evidence, label: `${evidence.label} · ${car.name}` });
            break;
          }
        }
      }
    }
  }

  const total = count ?? listings.length;
  const [cards, { data: viewerSaves }, { data: likeRows }, { data: viewerLikes }, { data: questionRows }] =
    await Promise.all([cardsPromise, viewerSavesPromise, likesPromise, viewerLikesPromise, questionsPromise]);
  const savedIds = new Set((viewerSaves ?? []).map((s) => s.target_id));
  console.info("[marketplace:complete]", { duration_ms: Math.round(performance.now() - started), page, count: cards.length });
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
    status: "success",
    results: cards.map((card) => ({
      ...card,
      fits_car_name: fitByListing.get(card.id) ?? null,
      match_evidence: evidenceByListing.get(card.id) ?? null,
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

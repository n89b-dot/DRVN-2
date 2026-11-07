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
import { searchListingPage } from "@/lib/marketplace/search/typesense";
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
  | {
      status: "success"; results: ListingCardData[]; total: number; hasMore: boolean;
      /** The count stopped at a cap: "10,000+" (or `totalCap`+). */
      totalIsCapped?: boolean;
      /** The cap it stopped at, when not COUNT_CAP. */
      totalCap?: number;
      /** Postgres' search (engine away) also searched these words in place
       *  of what was typed: "Including results for brembo". */
      corrections?: { word: string; correction: string }[];
      /** Positions for the next and previous pages' links, when known. */
      nextCursor?: string | null;
      prevCursor?: string | null;
    }
  | { status: "error"; results: []; total: null; hasMore: false; errorReference: string }
);

export const PAGE_SIZE = 24;

/**
 * How many people are watching each of these listings (R2-09).
 *
 * Asks `listing_watch_counts`, which counts saves for every listing the
 * caller can see and returns the number only — never who saved. Reading
 * `saves` directly can't work: RLS shows a listing's saves to its seller
 * alone, so every buyer counted 0.
 *
 * A listing in the map has a real count, 0 included. `null` means the count
 * couldn't be read; callers show nothing then rather than a misleading 0.
 */
export async function fetchWatchCounts(
  supabase: SupabaseClient<Database>,
  listingIds: string[]
): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  if (!listingIds.length) return counts;

  // The function takes at most 200 ids; pages are smaller, but stay safe.
  for (let i = 0; i < listingIds.length; i += 200) {
    const { data, error } = await supabase.rpc("listing_watch_counts", {
      p_listings: listingIds.slice(i, i + 200),
    });
    if (error) {
      reportError("[marketplace] watch counts failed", error);
      return null;
    }
    for (const row of data ?? []) counts.set(row.listing_id, row.watchers);
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
      // Every review, counted and averaged by the database: fetching the
      // rows stopped at 1,000 across the page's sellers (N30).
      sellerIds.length
        ? supabase.rpc("seller_review_summaries", { p_sellers: sellerIds })
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

  const ratingBySeller = new Map(
    ((sellerReviews ?? []) as { seller_id: string; review_count: number; rating_avg: number }[]).map((row) => [
      row.seller_id,
      { avg: Number(row.rating_avg), n: Number(row.review_count) },
    ])
  );
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
          rating: agg ? agg.avg.toFixed(1) : null,
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
      watch_count: watchCounts?.get(r.id),
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
 * pass their explicit owner; the database enforces shopper-visible evidence.
 *
 * A text search goes to the search entry point (migration 20261010100100),
 * which starts from the parts the words matched and applies the same rules.
 * Through PostgREST, `marketplace_browse_rows` ran the search once per part
 * for sale until migration 20261017145500 — a timeout at a thousand parts —
 * so nothing may depend on that migration being applied. `searchEntry:
 * false` is only for a database without the entry point (PGRST202). */
export function listingRowsQuery(supabase: SupabaseClient<Database>, raw: ListingFilters, workerViewer?: string, options: { searchEntry?: boolean; count?: boolean } = {}) {
  const filters = normalizeMarketplaceState(raw);
  const rows = options.searchEntry !== false && filters.q?.trim() ? "marketplace_search_browse_rows" : "marketplace_browse_rows";
  let query = supabase.rpc(rows, {
    p_query: filters.q ?? "", p_vehicle: filters.vehicle ?? "", p_vyear: Number(filters.vyear ?? 0),
    p_ymin: Number(filters.ymin ?? 0), p_ymax: Number(filters.ymax ?? 9999), p_fit: filters.fit === "1",
    ...(workerViewer ? { p_viewer: workerViewer } : {}),
    // An exact count makes the database produce every matching part before
    // it returns the first page; callers that already know the total skip it.
  }, options.count === false ? {} : { count: "exact" }).select("id, title, description, created_at, price_cents, shipping_cents, shipping_mode, allows_collection, condition, location, source_car_id, part_number, brand, part_miles, part_miles_unit, seller_id");
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.subcategory) query = query.eq("subcategory", filters.subcategory);
  if (filters.condition) query = query.eq("condition", filters.condition as "new" | "like_new" | "used" | "for_parts");
  // The whole brand, whatever its case. The field is a free-text box with
  // suggestions, so "brembo" has to find Brembo — but still the WHOLE brand:
  // a partial match would make "KW" find every brand containing those
  // letters. `ilike` with its wildcards escaped is an exact match that
  // ignores case.
  if (filters.brand) query = query.ilike("brand", filters.brand.replace(/[\\%_]/g, (c) => `\\${c}`));
  if (filters.location) query = query.ilike("location", `%${filters.location.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  if (filters.min) query = query.gte("price_cents", Math.round(Number(filters.min) * 100));
  if (filters.max) query = query.lte("price_cents", Math.round(Number(filters.max) * 100));
  return query;
}

/** "10,000+ parts": counts stop here (marketplace_count reads at most one more). */
export const COUNT_CAP = 10_000;
/** Postgres' own text search stops at the newest 1,001 matches (migration
 *  20261011130000): past 1,000 the page says "1,000+". The engine counts
 *  exactly. */
export const SEARCH_CAP = 1_000;

const CARD_COLUMNS = "id, title, description, created_at, price_cents, shipping_cents, shipping_mode, allows_collection, condition, location, source_car_id, part_number, brand, part_miles, part_miles_unit, seller_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A page's position — the sort it belongs to, the sort value of a part and
 * its id — as one URL-safe token. Next links carry the last part shown,
 * Previous links the first. The date is kept as the database's own string:
 * a JS Date holds milliseconds, the database microseconds, and a rounded
 * position would skip or repeat parts.
 */
export function encodePosition(sort: ListingSort, row: { id: string; created_at: string; price_cents: number }): string {
  const key = sort === "newest" ? row.created_at : String(row.price_cents);
  return btoa(`${sort}|${key}|${row.id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The position in a token, or null when it isn't one for this sort. */
export function decodePosition(token: string | undefined, sort: ListingSort): { created?: string; price?: number; id: string } | null {
  if (!token) return null;
  try {
    const [tokenSort, key, id, extra] = atob(token.replace(/-/g, "+").replace(/_/g, "/")).split("|");
    if (extra !== undefined || tokenSort !== sort || !id || !UUID.test(id) || !key) return null;
    if (sort === "newest") {
      return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(key) ? { created: key, id } : null;
    }
    return /^\d{1,10}$/.test(key) && Number(key) <= 2147483647 ? { price: Number(key), id } : null;
  } catch {
    return null;
  }
}

/** The shopper's choices as marketplace_page / marketplace_count arguments. */
function marketplaceArgs(filters: ListingFilters) {
  return {
    p_query: filters.q ?? "",
    p_category: filters.category ?? "",
    p_subcategory: filters.subcategory ?? "",
    p_condition: filters.condition ?? "",
    p_brand: filters.brand ?? "",
    p_location: filters.location ?? "",
    ...(filters.min ? { p_min_cents: Math.round(Number(filters.min) * 100) } : {}),
    ...(filters.max ? { p_max_cents: Math.round(Number(filters.max) * 100) } : {}),
    p_vehicle: filters.vehicle ?? "",
    p_vyear: Number(filters.vyear ?? 0),
    p_ymin: Number(filters.ymin ?? 0),
    p_ymax: Number(filters.ymax ?? 9999),
    p_fit: filters.fit === "1",
  };
}

type PageContext = {
  garage: Promise<GarageCar[]>;
  selection: Promise<VehicleFilterSelection | null>;
  /** How many parts this view holds, when the page already knows (the
   *  category counts on an unfiltered view). The page of parts is then read
   *  without asking the database to count them all again. Resolving to
   *  undefined means "not known" and the query counts as before. */
  total?: Promise<number | undefined>;
};

/**
 * Fetch a page and hydrate the same evidence shown on listing detail.
 *
 * Reads through marketplace_page (migration 20261011110000): the page is
 * read from the previous page's last part rather than by skipping every part
 * before it, one extra part says whether there is a next page, and a filtered
 * view is counted only up to COUNT_CAP. Before that migration is applied the
 * original offset-and-exact-count path answers (`fetchListingsByOffset`).
 */
export async function fetchListings(
  supabase: SupabaseClient<Database>,
  filters: ListingFilters,
  viewerId?: string,
  context?: PageContext
): Promise<ListingPage> {
  const started = performance.now();
  filters = normalizeMarketplaceState(filters);
  const sort = parseSort(filters.sort);
  const page = parsePage(filters.page);
  const after = decodePosition(filters.after, sort);
  const before = after ? null : decodePosition(filters.before, sort);
  const position = after ?? before;
  const args = marketplaceArgs(filters);

  const garagePromise = context?.garage ?? (viewerId
    ? Promise.resolve(supabase.from("cars").select("name, make, model, year").eq("owner_id", viewerId)).then(({ data }) => data ?? [])
    : Promise.resolve([] as GarageCar[]));
  const selectionPromise = context?.selection ?? (filters.vehicle ? resolveVehicleFilter(filters.vehicle) : Promise.resolve(null));

  // One part more than a page: whether there is another page that way. A
  // page without a position (page one, an old ?page=N link) skips instead.
  let pageQuery = supabase.rpc("marketplace_page", {
    ...args,
    p_sort: sort,
    p_limit: PAGE_SIZE + 1,
    p_before: Boolean(before),
    ...(position
      ? { p_after_id: position.id, ...(position.created ? { p_after_created: position.created } : { p_after_price: position.price }) }
      : { p_offset: (page - 1) * PAGE_SIZE }),
  }).select(CARD_COLUMNS);
  // The function returns its page in order; asking again costs a sort of 25.
  if (sort === "newest") pageQuery = pageQuery.order("created_at", { ascending: false }).order("id", { ascending: false });
  else pageQuery = pageQuery.order("price_cents", { ascending: sort === "price_asc" }).order("id", { ascending: sort === "price_asc" });

  // A typed search the engine can answer: its page of ids and exact count,
  // re-checked here under the shopper's own row security. A garage fit or a
  // place isn't in the engine's documents; those, and any engine failure,
  // fall through to Postgres' capped search below.
  if (filters.q?.trim() && filters.fit !== "1" && !filters.location) {
    const [garageCars, selection] = await Promise.all([garagePromise, selectionPromise]);
    const found = filters.vehicle && !selection ? { ids: [], found: 0 } : await searchListingPage({
      q: filters.q,
      category: filters.category, subcategory: filters.subcategory, condition: filters.condition, brand: filters.brand,
      minCents: args.p_min_cents, maxCents: args.p_max_cents,
      vehicle: selection ? { make: selection.make.toLowerCase(), model: (selection.model ?? "").toLowerCase(), year: Number(filters.vyear ?? 0) } : null,
      yearMin: filters.ymin ? Number(filters.ymin) : undefined, yearMax: filters.ymax ? Number(filters.ymax) : undefined,
      sort, page, perPage: PAGE_SIZE,
    });
    if (found) {
      const checked = found.ids.length
        ? await supabase.rpc("marketplace_page", { ...args, p_ids: found.ids, p_limit: PAGE_SIZE }).select(CARD_COLUMNS)
        : { data: [], error: null };
      if (!checked.error) {
        const listings = checked.data ?? [];
        console.info("[marketplace:retrieval]", { outcome: found.found ? "success" : "zero", engine: true, duration_ms: Math.round(performance.now() - started), count: found.found, page });
        const results = listings.length ? await decorateListings(supabase, listings, filters, viewerId, garageCars, selection) : [];
        return { status: "success", results, total: found.found, page, pageSize: PAGE_SIZE, hasMore: page * PAGE_SIZE < found.found };
      }
      // marketplace_page can't re-check (migration unapplied): Postgres answers.
    }
  }

  // The count, when the page doesn't already know it, is asked alongside the
  // page, up to the cap: past it, the page says "10,000+".
  type Counting = { known: number } | { counted: Awaited<ReturnType<typeof countQuery>> };
  const countQuery = () => supabase.rpc("marketplace_count", { ...args, p_cap: COUNT_CAP + 1 });
  const countPromise: Promise<Counting> = Promise.resolve(context?.total).then(async (known): Promise<Counting> =>
    known !== undefined ? { known } : { counted: await countQuery() });
  // Postgres' search corrects a word it has never seen to the closest word
  // it has, searching both; the page says which (a database without the
  // word list answers with an error, and the page says nothing).
  const correctionsPromise: Promise<{ word: string; correction: string }[]> = filters.q?.trim()
    ? Promise.resolve(supabase.rpc("search_word_corrections", { p_query: filters.q })).then(({ data, error }) => (error ? [] : data ?? []), () => [])
    : Promise.resolve([]);
  const [retrieval, garageCars, selection, counting, corrections] = await Promise.all([pageQuery, garagePromise, selectionPromise, countPromise, correctionsPromise]);
  const knownTotal = "known" in counting ? counting.known : undefined;
  if (retrieval.error?.code === "PGRST202") {
    return fetchListingsByOffset(supabase, filters, viewerId, { garage: Promise.resolve(garageCars), selection: Promise.resolve(selection), total: Promise.resolve(knownTotal) });
  }
  let total = knownTotal;
  let totalIsCapped = false;
  let totalCap: number | undefined;
  if (!retrieval.error && "counted" in counting) {
    const { counted } = counting;
    if (counted.error) {
      const errorReference = crypto.randomUUID();
      reportError("[marketplace] listing count failed", { reference: errorReference, code: counted.error.code, message: counted.error.message });
      return { status: "error", errorReference, results: [], total: null, page, pageSize: PAGE_SIZE, hasMore: false };
    }
    // A typed search is Postgres' capped one here: past SEARCH_CAP, "1,000+".
    const cap = filters.q?.trim() ? SEARCH_CAP : COUNT_CAP;
    totalIsCapped = Number(counted.data) > cap;
    total = Math.min(Number(counted.data), cap);
    if (cap !== COUNT_CAP) totalCap = cap;
  }
  const { error } = retrieval;
  console.info("[marketplace:retrieval]", { outcome: error ? "error" : total === 0 ? "zero" : "success", duration_ms: Math.round(performance.now() - started), count: error ? null : total, page });
  if (error) {
    const errorReference = crypto.randomUUID();
    reportError("[marketplace] listing query failed", { reference: errorReference, code: error.code, message: error.message });
    return { status: "error", errorReference, results: [], total: null, page, pageSize: PAGE_SIZE, hasMore: false };
  }

  // The extra part is the one furthest from the position: the last when
  // reading forward, the first when reading back.
  let listings = retrieval.data ?? [];
  const extra = listings.length > PAGE_SIZE;
  if (extra) listings = before ? listings.slice(1) : listings.slice(0, PAGE_SIZE);
  // Reading back, there is always a next page (the one we came from).
  const hasMore = before ? true : extra;
  const nextCursor = hasMore && listings.length ? encodePosition(sort, listings[listings.length - 1]) : null;
  const prevCursor = page > 1 && listings.length ? encodePosition(sort, listings[0]) : null;
  if (!listings.length) {
    return { status: "success", results: [], total: total ?? 0, totalIsCapped, totalCap, page, pageSize: PAGE_SIZE, hasMore: false };
  }
  const results = await decorateListings(supabase, listings, filters, viewerId, garageCars, selection);
  console.info("[marketplace:complete]", { duration_ms: Math.round(performance.now() - started), page, count: results.length });
  return {
    status: "success",
    results,
    total: total ?? listings.length,
    totalIsCapped,
    totalCap,
    ...(corrections.length ? { corrections } : {}),
    page,
    pageSize: PAGE_SIZE,
    hasMore,
    nextCursor,
    prevCursor,
  };
}

/** The original path: skip to the page, count every match. Kept for a
 *  database without marketplace_page (code deploys before the migration). */
async function fetchListingsByOffset(
  supabase: SupabaseClient<Database>,
  filters: ListingFilters,
  viewerId?: string,
  context?: PageContext
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
  const knownTotalPromise = context?.total ?? Promise.resolve(undefined);
  const knownTotal = await knownTotalPromise;
  const counted = knownTotal === undefined;
  const pageOf = (searchEntry: boolean) => {
    let query = listingRowsQuery(supabase, filters, undefined, { searchEntry, count: counted });
    if (sort === "price_asc") query = query.order("price_cents", { ascending: true });
    else if (sort === "price_desc") query = query.order("price_cents", { ascending: false });
    else query = query.order("created_at", { ascending: false });
    return query.order("id").range(from, from + PAGE_SIZE - 1);
  };

  let searchEntry = true;
  const [firstRetrieval, garageCars, selection] = await Promise.all([pageOf(searchEntry), garagePromise, selectionPromise]);
  let retrieval = firstRetrieval;
  // The search entry point isn't in this database yet (migration unapplied):
  // ask the original function, which answers the same thing more slowly.
  if (retrieval.error?.code === "PGRST202") {
    searchEntry = false;
    retrieval = await pageOf(searchEntry);
  }
  let { data: listings, count, error } = retrieval;
  if (!counted && !error) count = knownTotal ?? null;
  if (error?.code === "PGRST103" && page > 1) {
    const first = await listingRowsQuery(supabase, filters, undefined, { searchEntry }).order("id").range(0, 0);
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
  const total = count ?? listings.length;
  const results = await decorateListings(supabase, listings, filters, viewerId, garageCars, selection);
  console.info("[marketplace:complete]", { duration_ms: Math.round(performance.now() - started), page, count: results.length });
  return {
    status: "success",
    results,
    total,
    searchTruncated,
    page,
    pageSize: PAGE_SIZE,
    hasMore: from + listings.length < total,
  };
}

type DecoratableListing = HydratableListingRow & { id: string; source_car_id: string | null };

/** Cards for a page of parts: covers, sellers, the viewer's marks, counts
 *  and the fitment line for the chosen vehicle or the viewer's garage. */
async function decorateListings(
  supabase: SupabaseClient<Database>,
  listings: DecoratableListing[],
  filters: ListingFilters,
  viewerId: string | undefined,
  garageCars: GarageCar[],
  selection: VehicleFilterSelection | null
) {
  const garageByKey = buildGarageFitmentIndex(garageCars);
  const ids = listings.map((l) => l.id);
  // Covers, watch counts and seller trust hydrate in parallel with the
  // fitment lookups below.
  const cardsPromise = hydrateListingCards(supabase, listings);
  // The viewer's saves and likes over this page plus public like/question
  // counts, so each card's engagement strip renders pre-fired. All bounded
  // by the page's ids (a page is at most PAGE_SIZE parts).
  const viewerSavesPromise = Promise.resolve(viewerId
    ? supabase
        .from("saves")
        .select("target_id")
        .eq("user_id", viewerId)
        .eq("target_type", "listing")
        .in("target_id", ids)
    : { data: [] as { target_id: string }[] });
  // Like and question totals counted by the database: fetching the rows
  // stopped at 1,000 across the page (N30).
  const countsPromise = Promise.resolve(ids.length
    ? supabase.rpc("listing_engagement_counts", { p_listings: ids })
    : { data: [] as { listing_id: string; likes: number; questions: number }[], error: null });
  const viewerLikesPromise = Promise.resolve(viewerId
    ? supabase
        .from("likes")
        .select("target_id")
        .eq("user_id", viewerId)
        .eq("target_type", "listing")
        .in("target_id", ids)
    : { data: [] as { target_id: string }[] });

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

  const [cards, { data: viewerSaves }, counts, { data: viewerLikes }] =
    await Promise.all([cardsPromise, viewerSavesPromise, countsPromise, viewerLikesPromise]);
  if (counts.error) reportError("[marketplace] engagement counts failed", counts.error);
  const savedIds = new Set((viewerSaves ?? []).map((s) => s.target_id));
  const likedIds = new Set((viewerLikes ?? []).map((l) => l.target_id));
  const countsBy = new Map((counts.data ?? []).map((row) => [row.listing_id, row]));

  return cards.map((card) => ({
    ...card,
    fits_car_name: fitByListing.get(card.id) ?? null,
    match_evidence: evidenceByListing.get(card.id) ?? null,
    viewer_saved: savedIds.has(card.id),
    viewer_liked: likedIds.has(card.id),
    like_count: countsBy.get(card.id)?.likes ?? 0,
    question_count: countsBy.get(card.id)?.questions ?? 0,
  }));
}

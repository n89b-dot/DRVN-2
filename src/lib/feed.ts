import type { SupabaseClient } from "@supabase/supabase-js";

import { leadingBeforeAfter, normalizeBlocks } from "@/lib/activity-blocks";
import { spaceSellerRuns } from "@/lib/feed-merge";
import type { Database } from "@/lib/database.types";
import { buildGarageFitmentIndex, matchGarageFitment } from "@/lib/marketplace/fitment";
import { reportError } from "@/lib/monitoring";
import { vehicleLabel } from "@/lib/vehicles/label";
import { postHeadline } from "@/lib/activity/headline";

export type FeedItem =
  | {
      kind: "update";
      id: string;
      created_at: string;
      title: string;
      intro: string | null;
      /** Null on a carless post (W-5): there is no build to name. */
      carName: string | null;
      carSlug: string | null;
      /** The car's year/make/model for the vehicle line ("2023 Chevrolet
       *  Corvette Z06"). All null when the keeper never filled them; the
       *  card then falls back to the car's name. */
      carVehicle: { year: number | null; make: string | null; model: string | null } | null;
      ownerName: string | null;
      /** The author's profile photo — the card's byline plate. */
      ownerAvatarUrl?: string | null;
      cover_url: string | null;
      /** The "after" side when the post leads with a before/after plate —
       *  cover_url is then the "before" side and the card draws a static
       *  split of the two. Null for a plain photo cover. */
      compare_url?: string | null;
      avatar_url: string | null;
      reactions: number;
      /** How many photos the post carries — the card's gallery cue. */
      imageCount: number;
      /** Whether the viewer already fired the card's like (🔥 reaction). */
      viewerLiked?: boolean;
      /** Whether the viewer bookmarked this update (saves, 0037). */
      viewerSaved?: boolean;
      /** Replies on the post — the card's comment count. */
      commentCount?: number;
    }
  | {
      kind: "car";
      id: string;
      created_at: string;
      name: string;
      slug: string;
      /** "2019 Volkswagen Golf R" — the vehicle label, for headlines. */
      meta: string;
      /** The label's parts, so cards can drop a subline that would only
       *  repeat a nameless car's name (vehicleSubline). */
      vehicle: { year: number | null; make: string | null; model: string | null };
      cover_url: string | null;
      ownerName: string | null;
      /** The owner's profile photo — the card's byline plate. */
      ownerAvatarUrl?: string | null;
      /** Published build updates on this car. */
      updateCount: number;
      /** When the most recent update was published, if any. */
      lastActivityAt: string | null;
      /** Active listings sourced from this car. */
      forSaleCount: number;
      /** Whether the viewer has this build saved. */
      viewerSaved?: boolean;
      /** Public likes on this build (0037). */
      likeCount?: number;
      viewerLiked?: boolean;
    }
  | {
      kind: "part";
      id: string;
      created_at: string;
      title: string;
      price_cents: number;
      cover_url: string | null;
      /** 0 = shipping included, >0 = added at checkout, null = unknown. */
      shipping_cents: number | null;
      condition: string | null;
      grade: string | null;
      location: string | null;
      sellerName: string | null;
      /** The seller's profile photo — the card's byline plate. */
      sellerAvatarUrl?: string | null;
      partNumber: string | null;
      /** null = unknown (count failed), 0+ = actual watchers. */
      watchCount: number | null;
      /** Garage make+model match for the viewer, when they have one. */
      fitsCarName?: string | null;
      /** The car this part came off — the provenance line. */
      sourceCarName?: string | null;
      /** Its public build-sheet slug, when the build is public. */
      sourceCarSlug?: string | null;
      /** Whether the viewer is watching (has saved) this listing. */
      viewerSaved?: boolean;
      /** Public likes on this listing (0037). */
      likeCount?: number;
      viewerLiked?: boolean;
      /** Buyer questions on the listing — the card's comment count. */
      questionCount?: number;
    };

export type FeedTab = "all" | "cars" | "updates" | "parts";

/**
 * The feed's segmentation — one description read by Explore's filter row
 * and Home's Discovery segments, so the two surfaces can't drift apart on
 * what the kinds are called.
 *
 * "Parts" *is* parts for sale: `kindsForTab` maps it to active listings and
 * nothing else, so a separate "For sale" segment would be the same set twice.
 *
 * Every segment is public. Parts used to carry a `loggedInOnly` flag, from
 * PRD v3.1 §8.2 ("listings are a signed-in view"); that ruling is retired
 * (PRD 2026-09 E-5) — the marketplace is a front door, so a signed-out
 * visitor sees parts in the feed, in search and in suggestions. A part off a
 * private car is still named but never linked (see `hydrateFeedItems`).
 */
export const FEED_TABS: { key: FeedTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "cars", label: "Builds" },
  { key: "updates", label: "Updates" },
  { key: "parts", label: "Parts" },
];

/**
 * Validates a `?tab=` / `?discover=` value server-side; anything unknown
 * falls back to "all", so a pasted link never renders an empty segment.
 */
export function resolveFeedTab(value: unknown): FeedTab {
  return FEED_TABS.find((t) => t.key === value)?.key ?? "all";
}

export type FeedPage = {
  items: FeedItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  /** Where the next page starts: the oldest event on this page, as fetched
   *  (the "All" wall reorders kinds for display, so it is not the last card).
   *  Pass it back as `before` to read on from there. */
  nextCursor?: FeedCursor | null;
};

/** An event's position on the wall. `at` is the database's own timestamp
 *  string — microseconds included, never round-tripped through a JS Date. */
export type FeedCursor = { at: string; id: string };

const FEED_CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEED_CURSOR_AT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

/** A client-supplied position, or null when it isn't one. */
export function parseFeedCursor(value: unknown): FeedCursor | null {
  if (!value || typeof value !== "object") return null;
  const { at, id } = value as Record<string, unknown>;
  return typeof at === "string" && typeof id === "string" && FEED_CURSOR_AT.test(at) && FEED_CURSOR_ID.test(id) ? { at, id } : null;
}

const DEFAULT_PAGE_SIZE = 20;
// Legacy-fallback guard only (see _legacyFetchFeed): deep-paging a feed
// assembled from three separately-sorted tables means pulling proportionally
// more from each table per page — this caps that growth. The primary path
// pages the `feed_events` view instead, whose cost stays flat per page.
const LEGACY_MAX_FETCH_PER_TABLE = 200;

type FeedKind = FeedItem["kind"];

export type FeedEventRow = { kind: FeedKind; id: string; happened_at: string };

type HydrationPost = {
  id: string;
  title: string | null;
  intro: string | null;
  car_id: string | null;
  author_id: string;
  published_at: string | null;
  body: Database["public"]["Tables"]["activity_posts"]["Row"]["body"];
};
type HydrationCar = {
  id: string;
  slug: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  cover_image_url: string | null;
  owner_id: string;
  created_at: string;
};
type HydrationListing = {
  id: string;
  title: string;
  price_cents: number;
  shipping_cents: number | null;
  condition: string | null;
  grade: string | null;
  location: string | null;
  part_number: string | null;
  seller_id: string;
  source_car_id: string | null;
  created_at: string;
};
type HydrationPostCar = {
  id: string;
  slug: string;
  name: string;
  year: number | null;
  make: string | null;
  model: string | null;
  is_public: boolean;
  cover_image_url: string | null;
};
type HydrationSourceCar = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  slug: string;
  is_public: boolean;
};
type HydrationOwner = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

/** Everything a page of cards needs, already counted — the one shape both
 *  loaders below produce, so card building can't tell them apart. */
type HydrationData = {
  posts: HydrationPost[];
  cars: HydrationCar[];
  listings: HydrationListing[];
  garage: { name: string; make: string | null; model: string | null }[];
  postCars: HydrationPostCar[];
  sourceCars: HydrationSourceCar[];
  owners: HydrationOwner[];
  postCover: Map<string, string>;
  postImageCount: Map<string, number>;
  reactionCount: Map<string, number>;
  commentCountByPost: Map<string, number>;
  carUpdateCount: Map<string, number>;
  carLastActivity: Map<string, string>;
  carForSaleCount: Map<string, number>;
  listingCover: Map<string, string>;
  /** null when the counts couldn't be read (R2-09: unknown, not 0). */
  watchCounts: Map<string, number> | null;
  questionCountByListing: Map<string, number>;
  likeCountByKey: Map<string, number>;
  viewerSavedKeys: Set<string>;
  viewerLikedPosts: Set<string>;
  viewerLikedKeys: Set<string>;
};

type HydrationIds = { postIds: string[]; carIds: string[]; listingIds: string[] };

/**
 * Hydrates a page-sized window of (kind, id, happened_at) rows into full
 * FeedItems. All enrichment is bounded by the window size (at most pageSize
 * ids), never by table size — this is the only place feed cards' extra
 * signals (watch counts, fitment, activity rollups, image counts) are
 * fetched, so both the view path and the legacy fallback pay the same flat
 * per-page cost.
 *
 * One round trip: `feed_hydration` (migration 20260928120500) returns every
 * signal, counts already made, under the caller's own RLS.
 *
 * Exported for Explore search (src/lib/explore/search/query.ts): search
 * result windows are the same (kind, id) shape, so feed and search hydrate
 * through this one path instead of growing divergent enrichment code —
 * including the private-car re-check on updates, which makes hydration the
 * final visibility gate for any ranked ids a search index hands back.
 */
export async function hydrateFeedItems(
  supabase: SupabaseClient<Database>,
  rows: FeedEventRow[],
  viewerId?: string | null
): Promise<FeedItem[]> {
  if (!rows.length) return [];
  const ids: HydrationIds = {
    postIds: rows.filter((r) => r.kind === "update").map((r) => r.id),
    carIds: rows.filter((r) => r.kind === "car").map((r) => r.id),
    listingIds: rows.filter((r) => r.kind === "part").map((r) => r.id),
  };
  const data = await loadHydrationInOneCall(supabase, ids, viewerId);
  return buildFeedItems(rows, data);
}

type FeedHydrationJson = {
  posts: (HydrationPost & { cover_url: string | null; image_count: number; reactions: number; comments: number })[];
  cars: (HydrationCar & { update_count: number; last_activity_at: string | null; for_sale_count: number })[];
  listings: (HydrationListing & { cover_url: string | null; watch_count: number; question_count: number })[];
  garage: { name: string; make: string | null; model: string | null }[];
  post_cars: HydrationPostCar[];
  source_cars: HydrationSourceCar[];
  owners: HydrationOwner[];
  likes: { target_type: string; target_id: string; count: number }[];
  viewer_saves: { target_type: string; target_id: string }[];
  viewer_reactions: string[];
  viewer_likes: { target_type: string; target_id: string }[];
};

async function loadHydrationInOneCall(
  supabase: SupabaseClient<Database>,
  { postIds, carIds, listingIds }: HydrationIds,
  viewerId?: string | null
): Promise<HydrationData> {
  const { data, error } = await supabase.rpc("feed_hydration", {
    p_post_ids: postIds,
    p_car_ids: carIds,
    p_listing_ids: listingIds,
    p_viewer: viewerId ?? undefined,
  });
  if (error || !data) {
    // N30: there is no per-table fallback any more. It counted likes,
    // comments and the rest by fetching their rows, which stops silently at
    // 1,000 — a card's numbers quietly short. A failed read is a failed page.
    reportError("[feed] feed_hydration failed", error);
    throw new Error("Could not load the feed");
  }
  const json = data as unknown as FeedHydrationJson;
  const byId = <T extends { id: string }, V>(list: T[], pick: (row: T) => V | null | undefined) => {
    const map = new Map<string, V>();
    for (const row of list) {
      const value = pick(row);
      if (value !== null && value !== undefined) map.set(row.id, value);
    }
    return map;
  };
  return {
    posts: json.posts,
    cars: json.cars,
    listings: json.listings,
    garage: json.garage,
    postCars: json.post_cars,
    sourceCars: json.source_cars,
    owners: json.owners,
    postCover: byId(json.posts, (p) => p.cover_url),
    postImageCount: byId(json.posts, (p) => p.image_count),
    reactionCount: byId(json.posts, (p) => p.reactions),
    commentCountByPost: byId(json.posts, (p) => p.comments),
    carUpdateCount: byId(json.cars, (c) => c.update_count),
    carLastActivity: byId(json.cars, (c) => c.last_activity_at),
    carForSaleCount: byId(json.cars, (c) => c.for_sale_count),
    listingCover: byId(json.listings, (l) => l.cover_url),
    watchCounts: byId(json.listings, (l) => l.watch_count),
    questionCountByListing: byId(json.listings, (l) => l.question_count),
    likeCountByKey: new Map(json.likes.map((l) => [`${l.target_type}:${l.target_id}`, l.count])),
    viewerSavedKeys: new Set(json.viewer_saves.map((s) => `${s.target_type}:${s.target_id}`)),
    viewerLikedPosts: new Set(json.viewer_reactions),
    viewerLikedKeys: new Set(json.viewer_likes.map((l) => `${l.target_type}:${l.target_id}`)),
  };
}

/** Maps a hydrated page back onto its rows, in row order. */
function buildFeedItems(rows: FeedEventRow[], data: HydrationData): FeedItem[] {
  const {
    posts,
    cars,
    listings,
    postCars,
    sourceCars,
    owners,
    postCover,
    postImageCount,
    reactionCount,
    commentCountByPost,
    carUpdateCount,
    carLastActivity,
    carForSaleCount,
    listingCover,
    watchCounts,
    questionCountByListing,
    likeCountByKey,
    viewerSavedKeys,
    viewerLikedPosts,
    viewerLikedKeys,
  } = data;
  const garageIndex = buildGarageFitmentIndex(data.garage);
  const postById = new Map(posts.map((p) => [p.id, p]));
  const carItemById = new Map(cars.map((c) => [c.id, c]));
  const listingById = new Map(listings.map((l) => [l.id, l]));
  const postCarById = new Map((postCars ?? []).map((c) => [c.id, c]));
  const ownerById = new Map(
    (owners ?? []).map((o) => [o.id, o.display_name ?? (o.username ? `@${o.username}` : null)])
  );
  const avatarById = new Map((owners ?? []).map((o) => [o.id, o.avatar_url ?? null]));
  const sourceCarById = new Map((sourceCars ?? []).map((c) => [c.id, c]));

  // A post that leads with a before/after plate has no gallery mirror to
  // cover it (activity_images takes gallery urls only) — the pair itself is
  // the cover, drawn as a static split on the card.
  const postCompare = new Map<string, { beforeUrl: string; afterUrl: string }>();
  for (const p of posts) {
    const pair = leadingBeforeAfter(normalizeBlocks(p.body));
    if (pair) postCompare.set(p.id, pair);
  }
  // Map back in row order — the window is already time-ordered.
  const items: FeedItem[] = [];
  for (const row of rows) {
    if (row.kind === "update") {
      const p = postById.get(row.id);
      if (!p) continue;
      // A post with a car only reaches the feed when that car is public;
      // one without a car has no such gate to fail (W-5).
      const car = p.car_id ? postCarById.get(p.car_id) : null;
      if (p.car_id && !car?.is_public) continue;
      items.push({
        kind: "update",
        id: p.id,
        created_at: p.published_at ?? row.happened_at,
        title: postHeadline(p),
        intro: p.intro,
        carName: car?.name ?? null,
        carSlug: car?.slug ?? null,
        carVehicle: car ? { year: car.year, make: car.make, model: car.model } : null,
        ownerName: ownerById.get(p.author_id) ?? null,
        ownerAvatarUrl: avatarById.get(p.author_id) ?? null,
        cover_url: postCompare.get(p.id)?.beforeUrl ?? postCover.get(p.id) ?? null,
        compare_url: postCompare.get(p.id)?.afterUrl ?? null,
        avatar_url: car?.cover_image_url ?? null,
        reactions: reactionCount.get(p.id) ?? 0,
        imageCount: postImageCount.get(p.id) ?? 0,
        viewerLiked: viewerLikedPosts.has(p.id),
        viewerSaved: viewerSavedKeys.has(`post:${p.id}`),
        commentCount: commentCountByPost.get(p.id) ?? 0,
      });
    } else if (row.kind === "car") {
      const c = carItemById.get(row.id);
      if (!c) continue;
      items.push({
        kind: "car",
        id: c.id,
        created_at: c.created_at,
        name: c.name,
        slug: c.slug,
        meta: vehicleLabel(c),
        vehicle: { year: c.year, make: c.make, model: c.model },
        cover_url: c.cover_image_url,
        ownerName: ownerById.get(c.owner_id) ?? null,
        ownerAvatarUrl: avatarById.get(c.owner_id) ?? null,
        updateCount: carUpdateCount.get(c.id) ?? 0,
        lastActivityAt: carLastActivity.get(c.id) ?? null,
        forSaleCount: carForSaleCount.get(c.id) ?? 0,
        viewerSaved: viewerSavedKeys.has(`car:${c.id}`),
        likeCount: likeCountByKey.get(`car:${c.id}`) ?? 0,
        viewerLiked: viewerLikedKeys.has(`car:${c.id}`),
      });
    } else {
      const l = listingById.get(row.id);
      if (!l) continue;
      const sourceCar = l.source_car_id ? sourceCarById.get(l.source_car_id) : undefined;
      items.push({
        kind: "part",
        id: l.id,
        created_at: l.created_at,
        title: l.title,
        price_cents: l.price_cents,
        cover_url: listingCover.get(l.id) ?? null,
        shipping_cents: l.shipping_cents ?? null,
        condition: l.condition,
        grade: l.grade,
        location: l.location,
        sellerName: ownerById.get(l.seller_id) ?? null,
        sellerAvatarUrl: avatarById.get(l.seller_id) ?? null,
        partNumber: l.part_number,
        watchCount: watchCounts?.get(l.id) ?? null,
        fitsCarName: sourceCar
          ? matchGarageFitment(garageIndex, sourceCar.make, sourceCar.model)
          : null,
        sourceCarName: sourceCar ? vehicleLabel(sourceCar) || null : null,
        sourceCarSlug: sourceCar?.is_public && vehicleLabel(sourceCar) ? sourceCar.slug : null,
        viewerSaved: viewerSavedKeys.has(`listing:${l.id}`),
        likeCount: likeCountByKey.get(`listing:${l.id}`) ?? 0,
        viewerLiked: viewerLikedKeys.has(`listing:${l.id}`),
        questionCount: questionCountByListing.get(l.id) ?? 0,
      });
    }
  }
  return items;
}

function kindsForTab(tab: FeedTab): FeedKind[] {
  const kinds: FeedKind[] = [];
  if (tab === "all" || tab === "cars") kinds.push("car");
  if (tab === "all" || tab === "updates") kinds.push("update");
  if (tab === "all" || tab === "parts") kinds.push("part");
  return kinds;
}

/**
 * Explore feed: a mixed feed of build updates, cars and parts, public to
 * everyone. Recency-ordered for MVP; personalization comes later.
 *
 * Pagination: pages the `feed_events` view (migration 0032) — a single
 * globally-ordered UNION of public cars, published updates, and active
 * listings — with `range()`, so each page is one indexed ordered scan and
 * `hasMore` is honest (one row fetched past the window). Numbered-page
 * `range()` was chosen over a keyset cursor for URL-addressable pages; a
 * created-before cursor over the same view is the upgrade path if offset
 * depth ever becomes a real cost.
 *
 * FAIL SOFT: when the view doesn't exist yet (migration unapplied), falls
 * back to the previous three-table merge (`_legacyFetchFeed`) and reports.
 */
export async function fetchFeed(
  supabase: SupabaseClient<Database>,
  tab: FeedTab,
  opts: {
    page?: number;
    pageSize?: number;
    viewerId?: string | null;
    /** Leave this member's own cars, posts and parts out — a discovery feed
     *  that shows you your own car reads as padded (H-1 "For you"). */
    excludeOwnerId?: string | null;
    /** Read on from here (a previous page's `nextCursor`) rather than by
     *  skipping `page - 1` pages: the same rows, without reading the ones
     *  before. */
    before?: FeedCursor | null;
  } = {}
): Promise<FeedPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const kinds = kindsForTab(tab);
  if (!kinds.length) return { items: [], page, pageSize, hasMore: false };

  const from = (page - 1) * pageSize;
  // One extra row past the window answers `hasMore` without a count query.
  // feed_event_page (migration 20261010100100) returns the same rows as the
  // view, read off indexes: the view sorts every event to find a page. Before
  // that migration is applied the view still answers. A position needs
  // 20261011120000; before it, the same page is read by skipping.
  const pageArgs = {
    p_kinds: kinds,
    p_limit: pageSize + 1,
    ...(opts.excludeOwnerId ? { p_exclude_owner: opts.excludeOwnerId } : {}),
  };
  let paged = await (opts.before
    ? supabase.rpc("feed_event_page", { ...pageArgs, p_offset: 0, p_before_at: opts.before.at, p_before_id: opts.before.id })
    : supabase.rpc("feed_event_page", { ...pageArgs, p_offset: from }));
  if (opts.before && paged.error?.code === "PGRST202") paged = await supabase.rpc("feed_event_page", { ...pageArgs, p_offset: from });
  let data: { kind: string | null; id: string | null; happened_at: string | null }[] | null = paged.data;
  let error = paged.error;
  if (error?.code === "PGRST202") {
    let events = supabase.from("feed_events").select("kind, id, happened_at").in("kind", kinds);
    if (opts.excludeOwnerId) events = events.neq("owner_id", opts.excludeOwnerId);
    ({ data, error } = await events
      .order("happened_at", { ascending: false })
      .order("id", { ascending: false }) // stable tiebreak for equal timestamps
      .range(from, from + pageSize));
  }

  if (error || !data) {
    reportError("[feed] feed_events view unavailable, falling back to legacy merge", error);
    return _legacyFetchFeed(supabase, tab, {
      page,
      pageSize,
      viewerId: opts.viewerId,
      excludeOwnerId: opts.excludeOwnerId,
    });
  }

  const hasMore = data.length > pageSize;
  const windowRows = data.slice(0, pageSize) as FeedEventRow[];
  const items = await hydrateFeedItems(supabase, windowRows, opts.viewerId);
  const last = windowRows[windowRows.length - 1];
  return {
    items: tab === "all" ? interleaveKinds(items) : items,
    page,
    pageSize,
    hasMore,
    nextCursor: hasMore && last ? { at: last.happened_at, id: last.id } : null,
  };
}

/**
 * Spread the kinds evenly across a page. Strict recency clumps the wall —
 * three updates from one busy weekend, then five listings from a parts
 * purge — so the "All" wall reads as one person's feed, not a community.
 * Each item keeps its position *within its kind* (still newest-first) and
 * is given a fractional slot (i + 0.5) / count; sorting by slot spreads a
 * kind with 10 items every other cell and a kind with 2 items at a quarter
 * and three-quarters of the page. Deterministic, no reshuffle on re-render.
 */
export function interleaveKinds(items: FeedItem[]): FeedItem[] {
  const counts = new Map<FeedItem["kind"], number>();
  for (const it of items) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
  if (counts.size < 2) return items;
  const seen = new Map<FeedItem["kind"], number>();
  return items
    .map((item, index) => {
      const i = seen.get(item.kind) ?? 0;
      seen.set(item.kind, i + 1);
      return { item, index, slot: (i + 0.5) / (counts.get(item.kind) ?? 1) };
    })
    .sort((a, b) => a.slot - b.slot || a.index - b.index)
    .map((x) => x.item);
}

/**
 * Pre-0032 implementation, kept as the fail-soft fallback while the
 * `feed_events` migration rolls out: pulls the top `page*pageSize+1` ids from
 * each source table, merges and sorts in memory, slices the window, then
 * hydrates it through the same shared path as the view. Query cost grows
 * with page depth (capped at LEGACY_MAX_FETCH_PER_TABLE, past which
 * `hasMore` under-reports) — which is exactly why the view exists.
 */
async function _legacyFetchFeed(
  supabase: SupabaseClient<Database>,
  tab: FeedTab,
  opts: { page: number; pageSize: number; viewerId?: string | null; excludeOwnerId?: string | null }
): Promise<FeedPage> {
  const { page, pageSize } = opts;
  const notMine = opts.excludeOwnerId ?? null;
  const fetchLimit = Math.min(LEGACY_MAX_FETCH_PER_TABLE, page * pageSize + 1);

  const wantCars = tab === "all" || tab === "cars";
  const wantUpdates = tab === "all" || tab === "updates";
  const wantParts = tab === "all" || tab === "parts";

  const [carsRes, postsRes, listingsRes] = await Promise.all([
    wantCars
      ? supabase
          .from("cars")
          .select("id, created_at, owner_id")
          .eq("is_public", true)
          .order("created_at", { ascending: false })
          .limit(fetchLimit)
      : Promise.resolve({ data: [] }),
    wantUpdates
      ? supabase
          .from("activity_posts")
          .select("id, published_at, author_id")
          .not("published_at", "is", null)
          .order("published_at", { ascending: false })
          .limit(fetchLimit)
      : Promise.resolve({ data: [] }),
    wantParts
      ? supabase
          .from("listings")
          .select("id, created_at, seller_id")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(fetchLimit)
      : Promise.resolve({ data: [] }),
  ]);

  // The fallback filters the viewer's own rows in memory; the view path
  // asks the database (feed_events.owner_id).
  const rows: FeedEventRow[] = [
    ...(postsRes.data ?? []).filter((p) => !notMine || p.author_id !== notMine).map((p) => ({
      kind: "update" as const,
      id: p.id,
      happened_at: p.published_at!,
    })),
    ...(carsRes.data ?? []).filter((c) => !notMine || c.owner_id !== notMine).map((c) => ({
      kind: "car" as const,
      id: c.id,
      happened_at: c.created_at,
    })),
    ...(listingsRes.data ?? []).filter((l) => !notMine || l.seller_id !== notMine).map((l) => ({
      kind: "part" as const,
      id: l.id,
      happened_at: l.created_at,
    })),
  ].sort((a, b) => (a.happened_at < b.happened_at ? 1 : -1));

  const from = (page - 1) * pageSize;
  const windowRows = rows.slice(from, from + pageSize);
  const hasMore = rows.length > from + pageSize;
  const items = await hydrateFeedItems(supabase, windowRows, opts.viewerId);
  return { items, page, pageSize, hasMore };
}

/**
 * H-2 — Local: the same feed, filtered to where somebody is.
 *
 * Shown as a Home tab only once a member has set a country, because a Local
 * tab that greets you with "set your location first" is a tab that exists to
 * ask for something. Region narrows it when they've given one; country alone
 * is a perfectly good answer in a small market.
 */
export async function fetchLocalFeed(
  supabase: SupabaseClient<Database>,
  place: { country: string; region?: string | null },
  opts: { page?: number; pageSize?: number; viewerId?: string | null } = {}
): Promise<FeedPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  // One page, asked for as one page. The function returns every public car,
  // update and part in the country, and slicing that here meant fetching all
  // of it to show twelve. One row beyond the page answers "is there more?".
  const from = (page - 1) * pageSize;
  const { data, error } = await supabase
    .rpc("local_feed_rows", {
      p_country: place.country,
      p_region: place.region ?? undefined,
    })
    .order("happened_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + pageSize);
  if (error || !data) {
    reportError("[feed] local_feed_rows unavailable", error);
    return { items: [], page, pageSize, hasMore: false };
  }
  const rows = data as FeedEventRow[];
  const items = await hydrateFeedItems(supabase, rows.slice(0, pageSize), opts.viewerId);
  return { items, page, pageSize, hasMore: rows.length > pageSize };
}

export type FollowedFeedPage = FeedPage & {
  /** True when this viewer follows nothing yet — the caller's cue to lean on Discovery instead. */
  followsNothing: boolean;
};

/**
 * Followed-first feed for Home: build updates and cars from profiles and
 * cars this viewer follows, prioritised over the general feed. `fetchFeed`
 * stays the global "everyone" feed (used by Explore and as Home's Discovery
 * fallback); this is the personalized layer on top of it.
 *
 * Three things count as followed (B-1): a car you follow, a person you
 * follow, and — since the September 2026 direction — a **new listing** from
 * either. A part reaches the people who care about that seller or that build
 * without anyone having to follow a listing, which is not a thing you can do.
 *
 * N31: the database does the joining. This used to read every follow (which
 * stops at 1,000) and put every followed id into each lane's URL — past a
 * few hundred follows the URL was too long and the feed showed empty.
 * `followed_feed_rows` (20261107180000) reads each followed car's and
 * person's newest rows, merges them into one order — newest, then id, the
 * order `feed-merge.ts` defines — and gives one card for a part reached two
 * ways. Pages read on from a position (`before`, the previous page's
 * `nextCursor`); a page number still works for the first link into a page.
 * The per-seller run cap is applied inside the page, never across pages.
 */
export async function fetchFollowedFeed(
  supabase: SupabaseClient<Database>,
  userId: string,
  opts: { page?: number; pageSize?: number; before?: FeedCursor | null } = {}
): Promise<FollowedFeedPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const before = opts.before ?? null;

  const [followed, rowsResult] = await Promise.all([
    supabase.from("follows").select("target_id", { count: "exact", head: true }).eq("follower_id", userId),
    supabase.rpc("followed_feed_rows", {
      p_limit: pageSize + 1,
      ...(before ? { p_before_at: before.at, p_before_id: before.id } : { p_offset: (page - 1) * pageSize }),
    }),
  ]);

  if (!followed.error && (followed.count ?? 0) === 0) {
    return { items: [], page, pageSize, hasMore: false, followsNothing: true, nextCursor: null };
  }
  if (rowsResult.error || !rowsResult.data) {
    reportError("[feed] followed_feed_rows failed", rowsResult.error);
    throw new Error("Could not load the people and builds you follow");
  }

  const rows = rowsResult.data.map((r) => ({
    kind: r.kind as FeedKind,
    id: r.id,
    happened_at: r.happened_at,
    sellerId: r.seller_id,
  }));
  const hasMore = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize);
  const last = pageRows[pageRows.length - 1];
  const items = await hydrateFeedItems(supabase, spaceSellerRuns(pageRows), userId);
  return {
    items,
    page,
    pageSize,
    hasMore,
    followsNothing: false,
    // The page's last row in the plain order, not after spacing: the next
    // page starts below it whatever spacing moved.
    nextCursor: hasMore && last ? { at: last.happened_at, id: last.id } : null,
  };
}

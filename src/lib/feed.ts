import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { buildGarageFitmentIndex, matchGarageFitment } from "@/lib/marketplace/fitment";
import { fetchWatchCounts } from "@/lib/marketplace/query";
import { reportError } from "@/lib/monitoring";
import { vehicleLabel } from "@/lib/vehicles/label";

export type FeedItem =
  | {
      kind: "update";
      id: string;
      created_at: string;
      title: string;
      intro: string | null;
      carName: string;
      carSlug: string;
      ownerName: string | null;
      cover_url: string | null;
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
      meta: string;
      cover_url: string | null;
      ownerName: string | null;
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
 * what the kinds are called or who may see them.
 *
 * "Parts" *is* parts for sale: `kindsForTab` maps it to active listings and
 * nothing else, so a separate "For sale" segment would be the same set twice.
 * Listings are a signed-in view (PRD §8.2), hence `loggedInOnly`.
 */
export const FEED_TABS: { key: FeedTab; label: string; loggedInOnly?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "cars", label: "Builds" },
  { key: "updates", label: "Updates" },
  { key: "parts", label: "Parts", loggedInOnly: true },
];

/** The tabs this viewer may select. */
export function visibleFeedTabs(isLoggedIn: boolean) {
  return FEED_TABS.filter((t) => !t.loggedInOnly || isLoggedIn);
}

/**
 * Validates a `?tab=` / `?discover=` value server-side. Anything unknown — or
 * a signed-in-only tab requested while signed out — falls back to "all", so a
 * pasted link never renders an empty or forbidden segment.
 */
export function resolveFeedTab(value: unknown, isLoggedIn: boolean): FeedTab {
  const allowed = visibleFeedTabs(isLoggedIn);
  return allowed.find((t) => t.key === value)?.key ?? "all";
}

export type FeedPage = {
  items: FeedItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

const DEFAULT_PAGE_SIZE = 20;
// Legacy-fallback guard only (see _legacyFetchFeed): deep-paging a feed
// assembled from three separately-sorted tables means pulling proportionally
// more from each table per page — this caps that growth. The primary path
// pages the `feed_events` view instead, whose cost stays flat per page.
const LEGACY_MAX_FETCH_PER_TABLE = 200;

type FeedKind = FeedItem["kind"];

type FeedEventRow = { kind: FeedKind; id: string; happened_at: string };

/**
 * Hydrates a page-sized window of (kind, id, happened_at) rows into full
 * FeedItems. All enrichment queries here are bounded by the window size
 * (`.in()` over at most pageSize ids), never by table size — this is the only
 * place feed cards' extra signals (watch counts, fitment, activity rollups,
 * image counts) are fetched, so both the view path and the legacy fallback
 * pay the same flat per-page cost.
 */
async function hydrateFeedItems(
  supabase: SupabaseClient<Database>,
  rows: FeedEventRow[],
  viewerId?: string | null
): Promise<FeedItem[]> {
  const postIds = rows.filter((r) => r.kind === "update").map((r) => r.id);
  const carIds = rows.filter((r) => r.kind === "car").map((r) => r.id);
  const listingIds = rows.filter((r) => r.kind === "part").map((r) => r.id);

  const [postsRes, carsRes, listingsRes, garageRes] = await Promise.all([
    postIds.length
      ? supabase
          .from("activity_posts")
          .select("id, title, intro, car_id, author_id, published_at")
          .in("id", postIds)
      : Promise.resolve({ data: [] }),
    carIds.length
      ? supabase
          .from("cars")
          .select("id, slug, name, make, model, year, cover_image_url, owner_id, created_at")
          .in("id", carIds)
      : Promise.resolve({ data: [] }),
    listingIds.length
      ? supabase
          .from("listings")
          .select(
            "id, title, price_cents, shipping_cents, condition, grade, location, part_number, seller_id, source_car_id, created_at"
          )
          .in("id", listingIds)
      : Promise.resolve({ data: [] }),
    // Viewer garage, fetched once per page for "Fits your <car>" hints.
    viewerId
      ? supabase.from("cars").select("name, make, model").eq("owner_id", viewerId)
      : Promise.resolve({ data: [] }),
  ]);

  const posts = postsRes.data ?? [];
  const cars = carsRes.data ?? [];
  const listings = listingsRes.data ?? [];
  const garageIndex = buildGarageFitmentIndex(garageRes.data ?? []);

  const postCarIds = [...new Set(posts.map((p) => p.car_id))];
  const ownerIds = [
    ...new Set([
      ...cars.map((c) => c.owner_id),
      ...posts.map((p) => p.author_id),
      ...listings.map((l) => l.seller_id),
    ]),
  ];
  const sourceCarIds = [
    ...new Set(listings.map((l) => l.source_car_id).filter((id): id is string => Boolean(id))),
  ];

  const [
    { data: postCars },
    { data: owners },
    { data: listingImages },
    { data: postImages },
    { data: reactionRows },
    { data: carActivity },
    { data: carListings },
    { data: sourceCars },
    watchCounts,
    { data: viewerSaves },
    { data: viewerReactions },
    { data: likeRows },
    { data: viewerLikes },
    { data: commentRows },
    { data: questionRows },
  ] = await Promise.all([
    postCarIds.length
      ? supabase.from("cars").select("id, slug, name, is_public, cover_image_url").in("id", postCarIds)
      : Promise.resolve({ data: [] }),
    ownerIds.length
      ? supabase.from("profiles").select("id, display_name, username").in("id", ownerIds)
      : Promise.resolve({ data: [] }),
    listingIds.length
      ? supabase
          .from("listing_images")
          .select("listing_id, url, position")
          .in("listing_id", listingIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    postIds.length
      ? supabase
          .from("activity_images")
          .select("post_id, url, position")
          .in("post_id", postIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    postIds.length
      ? supabase.from("activity_reactions").select("post_id").in("post_id", postIds)
      : Promise.resolve({ data: [] }),
    // Activity rollup for build cards: count + latest published_at per car.
    carIds.length
      ? supabase
          .from("activity_posts")
          .select("car_id, published_at")
          .in("car_id", carIds)
          .not("published_at", "is", null)
      : Promise.resolve({ data: [] }),
    // "N parts for sale" per build card.
    carIds.length
      ? supabase
          .from("listings")
          .select("source_car_id")
          .eq("status", "active")
          .in("source_car_id", carIds)
      : Promise.resolve({ data: [] }),
    // The source car of each listing: names the provenance line on every
    // part card, and is the fitment source for a viewer with a garage.
    sourceCarIds.length
      ? supabase.from("cars").select("id, year, make, model, slug, is_public").in("id", sourceCarIds)
      : Promise.resolve({ data: [] }),
    listingIds.length ? fetchWatchCounts(supabase, listingIds) : Promise.resolve(new Map<string, number>()),
    // The viewer's own marks, so every card renders its toggles pre-fired:
    // saves over this page's listings+cars+posts, 🔥 reactions over posts.
    viewerId && rows.length
      ? supabase
          .from("saves")
          .select("target_type, target_id")
          .eq("user_id", viewerId)
          .in("target_id", [...listingIds, ...carIds, ...postIds])
      : Promise.resolve({ data: [] }),
    viewerId && postIds.length
      ? supabase
          .from("activity_reactions")
          .select("post_id")
          .eq("user_id", viewerId)
          .in("post_id", postIds)
      : Promise.resolve({ data: [] }),
    // Public like counts over the page's listings+cars (0037).
    listingIds.length || carIds.length
      ? supabase
          .from("likes")
          .select("target_type, target_id")
          .in("target_id", [...listingIds, ...carIds])
      : Promise.resolve({ data: [] }),
    viewerId && (listingIds.length || carIds.length)
      ? supabase
          .from("likes")
          .select("target_type, target_id")
          .eq("user_id", viewerId)
          .in("target_id", [...listingIds, ...carIds])
      : Promise.resolve({ data: [] }),
    // Comment counts: post replies and listing questions.
    postIds.length
      ? supabase.from("activity_comments").select("post_id").in("post_id", postIds)
      : Promise.resolve({ data: [] }),
    listingIds.length
      ? supabase.from("listing_questions").select("listing_id").in("listing_id", listingIds)
      : Promise.resolve({ data: [] }),
  ]);

  const viewerSavedKeys = new Set(
    (viewerSaves ?? []).map((s) => `${s.target_type}:${s.target_id}`)
  );
  const viewerLikedPosts = new Set((viewerReactions ?? []).map((r) => r.post_id));
  const likeCountByKey = new Map<string, number>();
  for (const row of likeRows ?? []) {
    const key = `${row.target_type}:${row.target_id}`;
    likeCountByKey.set(key, (likeCountByKey.get(key) ?? 0) + 1);
  }
  const viewerLikedKeys = new Set(
    (viewerLikes ?? []).map((l) => `${l.target_type}:${l.target_id}`)
  );
  const commentCountByPost = new Map<string, number>();
  for (const row of commentRows ?? []) {
    commentCountByPost.set(row.post_id, (commentCountByPost.get(row.post_id) ?? 0) + 1);
  }
  const questionCountByListing = new Map<string, number>();
  for (const row of questionRows ?? []) {
    questionCountByListing.set(
      row.listing_id,
      (questionCountByListing.get(row.listing_id) ?? 0) + 1
    );
  }

  const postById = new Map(posts.map((p) => [p.id, p]));
  const carItemById = new Map(cars.map((c) => [c.id, c]));
  const listingById = new Map(listings.map((l) => [l.id, l]));
  const postCarById = new Map((postCars ?? []).map((c) => [c.id, c]));
  const ownerById = new Map(
    (owners ?? []).map((o) => [o.id, o.display_name ?? (o.username ? `@${o.username}` : null)])
  );
  const sourceCarById = new Map((sourceCars ?? []).map((c) => [c.id, c]));

  const listingCover = new Map<string, string>();
  for (const img of listingImages ?? []) {
    if (!listingCover.has(img.listing_id)) listingCover.set(img.listing_id, img.url);
  }
  const postCover = new Map<string, string>();
  const postImageCount = new Map<string, number>();
  for (const img of postImages ?? []) {
    if (!postCover.has(img.post_id)) postCover.set(img.post_id, img.url);
    postImageCount.set(img.post_id, (postImageCount.get(img.post_id) ?? 0) + 1);
  }
  const reactionCount = new Map<string, number>();
  for (const row of reactionRows ?? []) {
    reactionCount.set(row.post_id, (reactionCount.get(row.post_id) ?? 0) + 1);
  }
  const carUpdateCount = new Map<string, number>();
  const carLastActivity = new Map<string, string>();
  for (const row of carActivity ?? []) {
    carUpdateCount.set(row.car_id, (carUpdateCount.get(row.car_id) ?? 0) + 1);
    const prev = carLastActivity.get(row.car_id);
    if (row.published_at && (!prev || row.published_at > prev)) {
      carLastActivity.set(row.car_id, row.published_at);
    }
  }
  const carForSaleCount = new Map<string, number>();
  for (const row of carListings ?? []) {
    if (row.source_car_id) {
      carForSaleCount.set(row.source_car_id, (carForSaleCount.get(row.source_car_id) ?? 0) + 1);
    }
  }

  // Map back in row order — the window is already time-ordered.
  const items: FeedItem[] = [];
  for (const row of rows) {
    if (row.kind === "update") {
      const p = postById.get(row.id);
      if (!p) continue;
      const car = postCarById.get(p.car_id);
      if (!car?.is_public) continue; // author viewing own private-car post: not feed material
      items.push({
        kind: "update",
        id: p.id,
        created_at: p.published_at ?? row.happened_at,
        title: p.title,
        intro: p.intro,
        carName: car.name,
        carSlug: car.slug,
        ownerName: ownerById.get(p.author_id) ?? null,
        cover_url: postCover.get(p.id) ?? null,
        avatar_url: car.cover_image_url ?? null,
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
        cover_url: c.cover_image_url,
        ownerName: ownerById.get(c.owner_id) ?? null,
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
        partNumber: l.part_number,
        watchCount: watchCounts.get(l.id) ?? 0,
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

function kindsForTab(tab: FeedTab, isLoggedIn: boolean): FeedKind[] {
  const kinds: FeedKind[] = [];
  if (tab === "all" || tab === "cars") kinds.push("car");
  if (tab === "all" || tab === "updates") kinds.push("update");
  if ((tab === "all" || tab === "parts") && isLoggedIn) kinds.push("part");
  return kinds;
}

/**
 * Explore feed (PRD §8.2): mixed feed of build updates, cars, and — for
 * logged-in viewers only — parts. Recency-ordered for MVP; personalization
 * comes later.
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
  isLoggedIn: boolean,
  opts: { page?: number; pageSize?: number; viewerId?: string | null } = {}
): Promise<FeedPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const kinds = kindsForTab(tab, isLoggedIn);
  if (!kinds.length) return { items: [], page, pageSize, hasMore: false };

  const from = (page - 1) * pageSize;
  // One extra row past the window answers `hasMore` without a count query.
  const { data, error } = await supabase
    .from("feed_events")
    .select("kind, id, happened_at")
    .in("kind", kinds)
    .order("happened_at", { ascending: false })
    .order("id", { ascending: false }) // stable tiebreak for equal timestamps
    .range(from, from + pageSize);

  if (error || !data) {
    reportError("[feed] feed_events view unavailable, falling back to legacy merge", error);
    return _legacyFetchFeed(supabase, tab, isLoggedIn, { page, pageSize, viewerId: opts.viewerId });
  }

  const hasMore = data.length > pageSize;
  const windowRows = data.slice(0, pageSize) as FeedEventRow[];
  const items = await hydrateFeedItems(supabase, windowRows, opts.viewerId);
  return { items: tab === "all" ? interleaveKinds(items) : items, page, pageSize, hasMore };
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
  isLoggedIn: boolean,
  opts: { page: number; pageSize: number; viewerId?: string | null }
): Promise<FeedPage> {
  const { page, pageSize } = opts;
  const fetchLimit = Math.min(LEGACY_MAX_FETCH_PER_TABLE, page * pageSize + 1);

  const wantCars = tab === "all" || tab === "cars";
  const wantUpdates = tab === "all" || tab === "updates";
  const wantParts = (tab === "all" || tab === "parts") && isLoggedIn;

  const [carsRes, postsRes, listingsRes] = await Promise.all([
    wantCars
      ? supabase
          .from("cars")
          .select("id, created_at")
          .eq("is_public", true)
          .order("created_at", { ascending: false })
          .limit(fetchLimit)
      : Promise.resolve({ data: [] }),
    wantUpdates
      ? supabase
          .from("activity_posts")
          .select("id, published_at")
          .not("published_at", "is", null)
          .order("published_at", { ascending: false })
          .limit(fetchLimit)
      : Promise.resolve({ data: [] }),
    wantParts
      ? supabase
          .from("listings")
          .select("id, created_at")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(fetchLimit)
      : Promise.resolve({ data: [] }),
  ]);

  const rows: FeedEventRow[] = [
    ...(postsRes.data ?? []).map((p) => ({
      kind: "update" as const,
      id: p.id,
      happened_at: p.published_at!,
    })),
    ...(carsRes.data ?? []).map((c) => ({
      kind: "car" as const,
      id: c.id,
      happened_at: c.created_at,
    })),
    ...(listingsRes.data ?? []).map((l) => ({
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
 * Same in-memory-merge caveat as `_legacyFetchFeed` (the followed set can't
 * be paged through `feed_events` — the view carries no follow edge), plus one
 * more: "followed" only covers cars and build updates (what `follows` can
 * target), not parts. A followed *seller's* new listing doesn't show up here
 * as a followed item; it would need a `follows` row per-seller-listing that
 * doesn't exist.
 * TODO: fold followed sellers' active listings in once `follows` learns a
 * seller-listing edge (or via a listings-by-followed-profile query) — left
 * out for now rather than adding another per-page fan-out.
 */
export async function fetchFollowedFeed(
  supabase: SupabaseClient<Database>,
  userId: string,
  opts: { page?: number; pageSize?: number } = {}
): Promise<FollowedFeedPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const fetchLimit = Math.min(LEGACY_MAX_FETCH_PER_TABLE, page * pageSize + 1);

  const { data: follows } = await supabase
    .from("follows")
    .select("target_type, target_id")
    .eq("follower_id", userId);

  const followedCarIds = (follows ?? []).filter((f) => f.target_type === "car").map((f) => f.target_id);
  const followedProfileIds = (follows ?? [])
    .filter((f) => f.target_type === "profile")
    .map((f) => f.target_id);
  const followsNothing = followedCarIds.length === 0 && followedProfileIds.length === 0;

  if (followsNothing) {
    return { items: [], page, pageSize, hasMore: false, followsNothing: true };
  }

  let carsQuery = supabase
    .from("cars")
    .select("id, created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);
  const carClauses = [
    followedCarIds.length ? `id.in.(${followedCarIds.join(",")})` : null,
    followedProfileIds.length ? `owner_id.in.(${followedProfileIds.join(",")})` : null,
  ].filter(Boolean) as string[];
  carsQuery = carClauses.length ? carsQuery.or(carClauses.join(",")) : carsQuery.eq("id", "");

  let postsQuery = supabase
    .from("activity_posts")
    .select("id, published_at")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(fetchLimit);
  const postClauses = [
    followedCarIds.length ? `car_id.in.(${followedCarIds.join(",")})` : null,
    followedProfileIds.length ? `author_id.in.(${followedProfileIds.join(",")})` : null,
  ].filter(Boolean) as string[];
  postsQuery = postClauses.length ? postsQuery.or(postClauses.join(",")) : postsQuery.eq("id", "");

  const [carsRes, postsRes] = await Promise.all([carsQuery, postsQuery]);

  const rows: FeedEventRow[] = [
    ...(postsRes.data ?? []).map((p) => ({
      kind: "update" as const,
      id: p.id,
      happened_at: p.published_at!,
    })),
    ...(carsRes.data ?? []).map((c) => ({
      kind: "car" as const,
      id: c.id,
      happened_at: c.created_at,
    })),
  ].sort((a, b) => (a.happened_at < b.happened_at ? 1 : -1));

  const from = (page - 1) * pageSize;
  const windowRows = rows.slice(from, from + pageSize);
  const hasMore = rows.length > from + pageSize;
  const items = await hydrateFeedItems(supabase, windowRows, userId);
  return { items, page, pageSize, hasMore, followsNothing: false };
}

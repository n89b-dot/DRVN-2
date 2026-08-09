import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

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
    }
  | {
      kind: "part";
      id: string;
      created_at: string;
      title: string;
      price_cents: number;
      cover_url: string | null;
    };

export type FeedTab = "all" | "cars" | "parts";

export type FeedPage = {
  items: FeedItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

const DEFAULT_PAGE_SIZE = 20;
// Deep-paging a feed assembled from three separately-sorted tables (rather
// than one materialised, globally-ordered timeline) means paging further in
// means pulling proportionally more from each table and re-merging — this
// caps how far that's allowed to grow, rather than letting a page number
// walk the query cost up without bound.
const MAX_FETCH_PER_TABLE = 200;

/**
 * Explore feed (PRD §8.2): mixed feed of build updates, cars, and — for
 * logged-in viewers only — parts. Recency-ordered for MVP; personalization
 * comes later.
 *
 * Pagination note: items come from three tables (cars, activity_posts,
 * listings) merged and sorted in memory, not one globally-ordered query —
 * there's no single `created_at` column spanning all three. So each page is
 * produced by re-pulling the top `page * pageSize` rows from every table,
 * re-merging, and slicing the requested window. Correct, but the query cost
 * grows with page number rather than staying flat — capped at
 * MAX_FETCH_PER_TABLE so it can't run away on deep paging.
 */
export async function fetchFeed(
  supabase: SupabaseClient<Database>,
  tab: FeedTab,
  isLoggedIn: boolean,
  opts: { page?: number; pageSize?: number } = {}
): Promise<FeedPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  // Pull one extra row past the window so `hasMore` can be answered without
  // a second round trip.
  const fetchLimit = Math.min(MAX_FETCH_PER_TABLE, page * pageSize + 1);

  const wantCars = tab === "all" || tab === "cars";
  const wantParts = (tab === "all" || tab === "parts") && isLoggedIn;

  const [carsRes, postsRes, listingsRes] = await Promise.all([
    wantCars
      ? supabase
          .from("cars")
          .select("id, slug, name, make, model, year, cover_image_url, owner_id, created_at")
          .eq("is_public", true)
          .order("created_at", { ascending: false })
          .limit(fetchLimit)
      : Promise.resolve({ data: [] }),
    wantCars
      ? supabase
          .from("activity_posts")
          .select("id, title, intro, car_id, author_id, published_at")
          .not("published_at", "is", null)
          .order("published_at", { ascending: false })
          .limit(fetchLimit)
      : Promise.resolve({ data: [] }),
    wantParts
      ? supabase
          .from("listings")
          .select("id, title, price_cents, created_at")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(fetchLimit)
      : Promise.resolve({ data: [] }),
  ]);

  const cars = carsRes.data ?? [];
  const posts = postsRes.data ?? [];
  const listings = listingsRes.data ?? [];

  // Resolve names for posts (car + author) and listing covers.
  const postCarIds = [...new Set(posts.map((p) => p.car_id))];
  const ownerIds = [
    ...new Set([...cars.map((c) => c.owner_id), ...posts.map((p) => p.author_id)]),
  ];
  const listingIds = listings.map((l) => l.id);

  const postIds = posts.map((p) => p.id);
  const [{ data: postCars }, { data: owners }, { data: listingImages }, { data: postImages }, { data: reactionRows }] =
    await Promise.all([
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
    ]);

  const carById = new Map((postCars ?? []).map((c) => [c.id, c]));
  const ownerById = new Map((owners ?? []).map((o) => [o.id, o.display_name ?? `@${o.username}`]));
  const cover = new Map<string, string>();
  for (const img of listingImages ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }
  const postCover = new Map<string, string>();
  for (const img of postImages ?? []) {
    if (!postCover.has(img.post_id)) postCover.set(img.post_id, img.url);
  }
  const reactionCount = new Map<string, number>();
  for (const row of reactionRows ?? []) {
    reactionCount.set(row.post_id, (reactionCount.get(row.post_id) ?? 0) + 1);
  }

  const items: FeedItem[] = [
    ...posts
      .filter((p) => carById.get(p.car_id)?.is_public)
      .map((p) => ({
        kind: "update" as const,
        id: p.id,
        created_at: p.published_at!,
        title: p.title,
        intro: p.intro,
        carName: carById.get(p.car_id)!.name,
        carSlug: carById.get(p.car_id)!.slug,
        ownerName: ownerById.get(p.author_id) ?? null,
        cover_url: postCover.get(p.id) ?? null,
        avatar_url: carById.get(p.car_id)!.cover_image_url ?? null,
        reactions: reactionCount.get(p.id) ?? 0,
      })),
    ...cars.map((c) => ({
      kind: "car" as const,
      id: c.id,
      created_at: c.created_at,
      name: c.name,
      slug: c.slug,
      meta: [c.year, c.make, c.model].filter(Boolean).join(" "),
      cover_url: c.cover_image_url,
      ownerName: ownerById.get(c.owner_id) ?? null,
    })),
    ...listings.map((l) => ({
      kind: "part" as const,
      id: l.id,
      created_at: l.created_at,
      title: l.title,
      price_cents: l.price_cents,
      cover_url: cover.get(l.id) ?? null,
    })),
  ];

  const sorted = items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const from = (page - 1) * pageSize;
  const windowItems = sorted.slice(from, from + pageSize);
  const hasMore = sorted.length > from + pageSize;

  return { items: windowItems, page, pageSize, hasMore };
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
 * Same in-memory-merge caveat as `fetchFeed` — see its comment — plus one
 * more: "followed" only covers cars and build updates (what `follows` can
 * target), not parts. A followed *seller's* new listing doesn't show up here
 * as a followed item; it would need a `follows` row per-seller-listing that
 * doesn't exist. That's a real gap, not a rounding error, and worth a
 * dedicated follows-aware listings query if sellers ask for it.
 */
export async function fetchFollowedFeed(
  supabase: SupabaseClient<Database>,
  userId: string,
  opts: { page?: number; pageSize?: number } = {}
): Promise<FollowedFeedPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const fetchLimit = Math.min(MAX_FETCH_PER_TABLE, page * pageSize + 1);

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
    .select("id, slug, name, make, model, year, cover_image_url, owner_id, created_at")
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
    .select("id, title, intro, car_id, author_id, published_at")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(fetchLimit);
  const postClauses = [
    followedCarIds.length ? `car_id.in.(${followedCarIds.join(",")})` : null,
    followedProfileIds.length ? `author_id.in.(${followedProfileIds.join(",")})` : null,
  ].filter(Boolean) as string[];
  postsQuery = postClauses.length ? postsQuery.or(postClauses.join(",")) : postsQuery.eq("id", "");

  const [carsRes, postsRes] = await Promise.all([carsQuery, postsQuery]);
  const cars = carsRes.data ?? [];
  const posts = postsRes.data ?? [];

  const postCarIds = [...new Set(posts.map((p) => p.car_id))];
  const ownerIds = [...new Set([...cars.map((c) => c.owner_id), ...posts.map((p) => p.author_id)])];

  const postIds = posts.map((p) => p.id);
  const [{ data: postCars }, { data: owners }, { data: postImages }, { data: reactionRows }] =
    await Promise.all([
      postCarIds.length
        ? supabase.from("cars").select("id, slug, name, is_public, cover_image_url").in("id", postCarIds)
        : Promise.resolve({ data: [] }),
      ownerIds.length
        ? supabase.from("profiles").select("id, display_name, username").in("id", ownerIds)
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
    ]);

  const carById = new Map((postCars ?? []).map((c) => [c.id, c]));
  const ownerById = new Map((owners ?? []).map((o) => [o.id, o.display_name ?? `@${o.username}`]));
  const postCover = new Map<string, string>();
  for (const img of postImages ?? []) {
    if (!postCover.has(img.post_id)) postCover.set(img.post_id, img.url);
  }
  const reactionCount = new Map<string, number>();
  for (const row of reactionRows ?? []) {
    reactionCount.set(row.post_id, (reactionCount.get(row.post_id) ?? 0) + 1);
  }

  const items: FeedItem[] = [
    ...posts
      .filter((p) => carById.get(p.car_id)?.is_public)
      .map((p) => ({
        kind: "update" as const,
        id: p.id,
        created_at: p.published_at!,
        title: p.title,
        intro: p.intro,
        carName: carById.get(p.car_id)!.name,
        carSlug: carById.get(p.car_id)!.slug,
        ownerName: ownerById.get(p.author_id) ?? null,
        cover_url: postCover.get(p.id) ?? null,
        avatar_url: carById.get(p.car_id)!.cover_image_url ?? null,
        reactions: reactionCount.get(p.id) ?? 0,
      })),
    ...cars.map((c) => ({
      kind: "car" as const,
      id: c.id,
      created_at: c.created_at,
      name: c.name,
      slug: c.slug,
      meta: [c.year, c.make, c.model].filter(Boolean).join(" "),
      cover_url: c.cover_image_url,
      ownerName: ownerById.get(c.owner_id) ?? null,
    })),
  ];

  const sorted = items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const from = (page - 1) * pageSize;
  const windowItems = sorted.slice(from, from + pageSize);
  const hasMore = sorted.length > from + pageSize;

  return { items: windowItems, page, pageSize, hasMore, followsNothing: false };
}

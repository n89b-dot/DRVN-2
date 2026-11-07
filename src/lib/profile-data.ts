import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { GalleryImage } from "@/components/ui";
import { platformLabel } from "@/lib/vehicles/label";
import { orderCars } from "@/lib/cars/order";
import { postHeadline } from "@/lib/activity/headline";
import { boundedPage, MAX_PAGE } from "@/lib/page-param";

export type ProfileVehicle = {
  id: string;
  slug: string;
  name: string;
  year: string;
  colorLabel: string;
  tags: string[];
  gallery: GalleryImage[];
  /** The card's photo: the chosen cover, else the first gallery image. */
  cover: string | null;
  /** Year make model — the line under the name on a garage card. */
  platform: string;
};

export type ProfileActivity = {
  id: string;
  carSlug: string;
  /** The car the update is about — the chip on its card. */
  carName: string | null;
  /** That car's cover — the card's photo when the post has none of its own
   *  (legacy posts predate "every post has a photo"). */
  carCover: string | null;
  date: string;
  title: string;
  intro: string | null;
  gallery: GalleryImage[];
};

export type ProfileListing = {
  id: string;
  title: string;
  price: string;
  status: string;
  cover: string | null;
};

export type ProfileReview = {
  id: string;
  rating: number;
  body: string | null;
  date: string;
  reviewerName: string;
  reviewerUsername: string | null;
};

export type ProfileView = {
  vehicles: ProfileVehicle[];
  activity: ProfileActivity[];
  /** The shopfront: what this keeper currently has for sale. */
  listings: ProfileListing[];
  reviews: ProfileReview[];
  /** Null until they've been reviewed at least once. */
  rating: number | null;
  reviewCount: number;
  salesCount: number;
  followerCount: number;
  followingCount: number;
  /** Every published post (the Updates tab's number), and whether the
   *  loaded list stops short of it — "Show more updates". */
  activityTotal: number;
  activityPage: number;
  activityHasMore: boolean;
  /** Pagination — "Show more" on the For sale / Reviews tabs. */
  listingsPage: number;
  listingsPageSize: number;
  listingsHasMore: boolean;
  reviewsPage: number;
  reviewsPageSize: number;
  reviewsHasMore: boolean;
};

export const PROFILE_LISTINGS_PAGE_SIZE = 24;
export const PROFILE_REVIEWS_PAGE_SIZE = 20;
export const PROFILE_UPDATES_PAGE_SIZE = 12;
/** "Show more updates" reads every page so far in one query (page × size),
 *  so its pages stop sooner than the offset-paged lists: 600 updates. */
export const PROFILE_UPDATES_MAX_PAGE = 50;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * Loads everything a keeper's page shows.
 *
 * This used to return vehicles and activity only, which meant a buyer who
 * clicked the seller from a listing landed on a page that could not answer
 * "what else are they selling?" or "are they credible?" — the two questions the
 * whole trust layer exists to answer. Listings, reviews, rating and sales count
 * are all now included; the tables were always there and simply unread.
 *
 * `publicOnly` restricts to public cars and live listings for /u/[username].
 */
export async function loadProfileView(
  supabase: SupabaseClient<Database>,
  profileId: string,
  {
    publicOnly,
    listingsPage: listingsPageAsked = 1,
    reviewsPage: reviewsPageAsked = 1,
    updatesPage: updatesPageAsked = 1,
  }: { publicOnly: boolean; listingsPage?: number; reviewsPage?: number; updatesPage?: number }
): Promise<ProfileView> {
  // Whole pages within bounds before any offset or limit is computed (N79).
  const listingsPage = boundedPage(listingsPageAsked);
  const reviewsPage = boundedPage(reviewsPageAsked);
  const updatesPage = boundedPage(updatesPageAsked, PROFILE_UPDATES_MAX_PAGE);
  const listingsFrom = (listingsPage - 1) * PROFILE_LISTINGS_PAGE_SIZE;
  const reviewsFrom = (reviewsPage - 1) * PROFILE_REVIEWS_PAGE_SIZE;

  // Everything below depends only on the profile id, so it goes out as one
  // parallel round, with photos and reviewer names embedded in the rows that
  // own them. This used to be seven dependent round trips (cars → images and
  // posts → post images → listings and reviews → all ratings → listing
  // covers → reviewer names), the deepest chain on the site.
  // P-5: main car first, then newest. Sorting by model year had the
  // profile lead with whichever car happened to be oldest on paper.
  let carsQuery = supabase
    .from("cars")
    .select(
      "id, slug, name, year, make, model, color, tags, created_at, cover_image_url, is_public, car_images(url, alt, position)"
    )
    .eq("owner_id", profileId)
    .order("position", { referencedTable: "car_images" });
  if (publicOnly) carsQuery = carsQuery.eq("is_public", true);

  // Posts this keeper wrote — by author, not by car, so a post about a part
  // (no car) is on their profile too. On /u/… a post about a private car
  // stays off: the car is embedded only when it is public, and a post keeps
  // its place only if it has no car or its car came through. The Updates tab
  // shows them a page at a time; the count is every published post.
  const updatesLimit = updatesPage * PROFILE_UPDATES_PAGE_SIZE;
  let postsQuery = supabase
    .from("activity_posts")
    .select("id, car_id, title, body, intro, published_at, cars(is_public), activity_images(url, alt, position)", {
      count: "exact",
    })
    .eq("author_id", profileId)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .order("position", { referencedTable: "activity_images" })
    .limit(updatesLimit);
  if (publicOnly) postsQuery = postsQuery.eq("cars.is_public", true).or("car_id.is.null,cars.not.is.null");

  // ---- Shopfront and credibility ----
  let listingsQuery = supabase
    .from("listings")
    .select("id, title, price_cents, status, created_at, listing_images(url, position)", { count: "exact" })
    .eq("seller_id", profileId)
    .order("created_at", { ascending: false })
    .order("position", { referencedTable: "listing_images" })
    .range(listingsFrom, listingsFrom + PROFILE_LISTINGS_PAGE_SIZE - 1);
  listingsQuery = publicOnly
    ? listingsQuery.in("status", ["active", "sold"])
    : listingsQuery.not("status", "eq", "archived");

  const [
    { data: cars },
    { data: mainCar },
    { data: posts, count: postsTotal },
    { data: listingRows, count: listingsTotal },
    { data: reviewRows, count: reviewsTotal },
    { data: salesCount },
    { data: followCounts },
    { data: allRatingRows },
  ] = await Promise.all([
    carsQuery,
    supabase.from("profiles").select("main_car_id").eq("id", profileId).maybeSingle(),
    postsQuery,
    listingsQuery,
    supabase
      .from("reviews")
      .select(
        "id, rating, body, created_at, reviewer_id, reviewer:profiles!reviews_reviewer_id_fkey(display_name, username)",
        { count: "exact" }
      )
      .eq("reviewee_id", profileId)
      .order("created_at", { ascending: false })
      .range(reviewsFrom, reviewsFrom + PROFILE_REVIEWS_PAGE_SIZE - 1),
    // Orders are private to their buyer and seller, so a visitor counting
    // them through RLS saw 0 sold. The function returns the total only.
    supabase.rpc("profile_sales_count", { p_profile: profileId }),
    // `follows` rows are private to the two people in them, so a visitor
    // counting through RLS saw 0. The function returns the totals only.
    supabase.rpc("profile_follow_counts", { p_profile: profileId }).maybeSingle(),
    // Average rating has to look at every review, not just the current page —
    // otherwise it would drift as the reviewer paged through history. Just
    // the rating column, so it stays cheap even with many reviews.
    supabase.from("reviews").select("rating").eq("reviewee_id", profileId),
  ]);

  const carList = orderCars(cars ?? [], mainCar?.main_car_id);

  const galleryByCar = new Map<string, GalleryImage[]>(
    carList.map((c) => [c.id, (c.car_images ?? []).map((img) => ({ url: img.url, alt: img.alt }))])
  );

  const slugByCar = new Map(carList.map((c) => [c.id, c.slug]));
  const nameByCar = new Map(carList.map((c) => [c.id, c.name]));
  const coverByCar = new Map(
    carList.map((c) => [c.id, c.cover_image_url ?? galleryByCar.get(c.id)?.[0]?.url ?? null])
  );

  const vehicles: ProfileVehicle[] = carList.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    year: c.year ? String(c.year) : "—",
    colorLabel: c.color ?? platformLabel(c),
    tags: c.tags ?? [],
    gallery: galleryByCar.get(c.id) ?? [],
    cover: c.cover_image_url ?? galleryByCar.get(c.id)?.[0]?.url ?? null,
    platform: platformLabel(c),
  }));

  const activity: ProfileActivity[] = (posts ?? []).map((p) => ({
    id: p.id,
    carSlug: p.car_id ? (slugByCar.get(p.car_id) ?? "") : "",
    carName: p.car_id ? (nameByCar.get(p.car_id) ?? null) : null,
    carCover: p.car_id ? (coverByCar.get(p.car_id) ?? null) : null,
    date: formatDate(p.published_at),
    title: postHeadline(p),
    intro: p.intro,
    gallery: (p.activity_images ?? []).map((img) => ({ url: img.url, alt: img.alt })),
  }));

  const coverByListing = new Map<string, string>();
  for (const l of listingRows ?? []) {
    const first = l.listing_images?.[0];
    if (first) coverByListing.set(l.id, first.url);
  }

  const listings: ProfileListing[] = (listingRows ?? []).map((l) => ({
    id: l.id,
    title: l.title,
    price: currency.format(l.price_cents / 100),
    status: l.status,
    cover: coverByListing.get(l.id) ?? null,
  }));

  const reviews: ProfileReview[] = (reviewRows ?? []).map((r) => {
    const reviewer = r.reviewer;
    return {
      id: r.id,
      rating: r.rating,
      body: r.body,
      date: formatDate(r.created_at),
      reviewerName: reviewer?.display_name ?? (reviewer?.username ? `@${reviewer.username}` : "A buyer"),
      reviewerUsername: reviewer?.username ?? null,
    };
  });

  const ratings = (allRatingRows ?? []).map((r) => r.rating);
  const rating = ratings.length
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
    : null;

  return {
    vehicles,
    activity,
    listings,
    reviews,
    rating,
    reviewCount: reviewsTotal ?? ratings.length,
    salesCount: Number(salesCount ?? 0),
    followerCount: Number(followCounts?.followers ?? 0),
    followingCount: Number(followCounts?.following ?? 0),
    activityTotal: postsTotal ?? activity.length,
    activityPage: updatesPage,
    activityHasMore: updatesPage < PROFILE_UPDATES_MAX_PAGE && (postsTotal ?? 0) > activity.length,
    listingsPage,
    listingsPageSize: PROFILE_LISTINGS_PAGE_SIZE,
    listingsHasMore: listingsPage < MAX_PAGE && (listingsTotal ?? 0) > listingsFrom + PROFILE_LISTINGS_PAGE_SIZE,
    reviewsPage,
    reviewsPageSize: PROFILE_REVIEWS_PAGE_SIZE,
    reviewsHasMore: reviewsPage < MAX_PAGE && (reviewsTotal ?? 0) > reviewsFrom + PROFILE_REVIEWS_PAGE_SIZE,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { GalleryImage } from "@/components/ui";

export type ProfileVehicle = {
  id: string;
  slug: string;
  name: string;
  year: string;
  colorLabel: string;
  tags: string[];
  gallery: GalleryImage[];
};

export type ProfileActivity = {
  id: string;
  carSlug: string;
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
};

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
  { publicOnly }: { publicOnly: boolean }
): Promise<ProfileView> {
  let carsQuery = supabase
    .from("cars")
    .select("id, slug, name, year, make, model, color, tags")
    .eq("owner_id", profileId)
    .order("year", { ascending: false, nullsFirst: false });
  if (publicOnly) carsQuery = carsQuery.eq("is_public", true);

  const { data: cars } = await carsQuery;
  const carList = cars ?? [];
  const carIds = carList.map((c) => c.id);

  const [{ data: carImages }, { data: posts }] = await Promise.all([
    carIds.length
      ? supabase
          .from("car_images")
          .select("car_id, url, alt, position")
          .in("car_id", carIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    carIds.length
      ? supabase
          .from("activity_posts")
          .select("id, car_id, title, intro, published_at")
          .in("car_id", carIds)
          .not("published_at", "is", null)
          .order("published_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [] }),
  ]);

  const galleryByCar = new Map<string, GalleryImage[]>();
  for (const img of carImages ?? []) {
    const list = galleryByCar.get(img.car_id) ?? [];
    list.push({ url: img.url, alt: img.alt });
    galleryByCar.set(img.car_id, list);
  }

  const postIds = (posts ?? []).map((p) => p.id);
  const { data: postImages } = postIds.length
    ? await supabase
        .from("activity_images")
        .select("post_id, url, alt, position")
        .in("post_id", postIds)
        .order("position")
    : { data: [] };
  const galleryByPost = new Map<string, GalleryImage[]>();
  for (const img of postImages ?? []) {
    const list = galleryByPost.get(img.post_id) ?? [];
    list.push({ url: img.url, alt: img.alt });
    galleryByPost.set(img.post_id, list);
  }

  const slugByCar = new Map(carList.map((c) => [c.id, c.slug]));

  const vehicles: ProfileVehicle[] = carList.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    year: c.year ? String(c.year) : "—",
    colorLabel: c.color ?? [c.make, c.model].filter(Boolean).join(" "),
    tags: c.tags ?? [],
    gallery: galleryByCar.get(c.id) ?? [],
  }));

  const activity: ProfileActivity[] = (posts ?? []).map((p) => ({
    id: p.id,
    carSlug: slugByCar.get(p.car_id) ?? "",
    date: formatDate(p.published_at),
    title: p.title,
    intro: p.intro,
    gallery: galleryByPost.get(p.id) ?? [],
  }));

  // ---- Shopfront and credibility ----
  let listingsQuery = supabase
    .from("listings")
    .select("id, title, price_cents, status, created_at")
    .eq("seller_id", profileId)
    .order("created_at", { ascending: false })
    .limit(24);
  listingsQuery = publicOnly
    ? listingsQuery.in("status", ["active", "sold"])
    : listingsQuery.not("status", "eq", "archived");

  const [
    { data: listingRows },
    { data: reviewRows },
    { count: salesCount },
    { count: followerCount },
  ] = await Promise.all([
    listingsQuery,
    supabase
      .from("reviews")
      .select("id, rating, body, created_at, reviewer_id")
      .eq("reviewee_id", profileId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", profileId)
      .in("status", ["paid", "shipped", "delivered", "completed"]),
    supabase
      .from("follows")
      .select("target_id", { count: "exact", head: true })
      .eq("target_type", "profile")
      .eq("target_id", profileId),
  ]);

  const listingIds = (listingRows ?? []).map((l) => l.id);
  const { data: listingImages } = listingIds.length
    ? await supabase
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", listingIds)
        .order("position")
    : { data: [] };
  const coverByListing = new Map<string, string>();
  for (const img of listingImages ?? []) {
    if (!coverByListing.has(img.listing_id)) coverByListing.set(img.listing_id, img.url);
  }

  const reviewerIds = [...new Set((reviewRows ?? []).map((r) => r.reviewer_id))];
  const { data: reviewers } = reviewerIds.length
    ? await supabase.from("profiles").select("id, display_name, username").in("id", reviewerIds)
    : { data: [] };

  const listings: ProfileListing[] = (listingRows ?? []).map((l) => ({
    id: l.id,
    title: l.title,
    price: currency.format(l.price_cents / 100),
    status: l.status,
    cover: coverByListing.get(l.id) ?? null,
  }));

  const reviews: ProfileReview[] = (reviewRows ?? []).map((r) => {
    const reviewer = (reviewers ?? []).find((p) => p.id === r.reviewer_id);
    return {
      id: r.id,
      rating: r.rating,
      body: r.body,
      date: formatDate(r.created_at),
      reviewerName: reviewer?.display_name ?? (reviewer?.username ? `@${reviewer.username}` : "A buyer"),
      reviewerUsername: reviewer?.username ?? null,
    };
  });

  const ratings = (reviewRows ?? []).map((r) => r.rating);
  const rating = ratings.length
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
    : null;

  return {
    vehicles,
    activity,
    listings,
    reviews,
    rating,
    reviewCount: ratings.length,
    salesCount: salesCount ?? 0,
    followerCount: followerCount ?? 0,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * Everything the garage knows about one car, measured — the numbers a
 * build sheet dimensions, plus the facts that decide its work orders.
 * One round of bounded queries over the owner's car ids; no per-car N+1.
 */
export type GarageSheet = {
  id: string;
  slug: string;
  name: string;
  year: number | null;
  make: string | null;
  model: string | null;
  cover_image_url: string | null;
  is_public: boolean;
  created_at: string;
  /** Sheet number in the garage — order the cars were added. */
  index: number;
  photos: number;
  mods: number;
  updates: number;
  latestUpdate: { id: string; title: string; published_at: string; cover_url: string | null } | null;
  partsLive: number;
  partsSold: number;
  earnedCents: number;
  openOffers: number;
  followers: number;
  likes: number;
};

export async function loadGarageSheets(
  supabase: SupabaseClient<Database>,
  ownerId: string
): Promise<GarageSheet[]> {
  const { data: cars } = await supabase
    .from("cars")
    .select("id, slug, name, make, model, year, cover_image_url, is_public, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });
  if (!cars?.length) return [];
  const ids = cars.map((c) => c.id);

  const [
    { data: images },
    { data: mods },
    { data: posts },
    { data: listings },
    { data: follows },
    { data: likes },
  ] = await Promise.all([
    supabase.from("car_images").select("car_id").in("car_id", ids),
    supabase.from("mod_items").select("car_id").in("car_id", ids),
    supabase
      .from("activity_posts")
      .select("id, car_id, title, published_at")
      .in("car_id", ids)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false }),
    supabase
      .from("listings")
      .select("id, source_car_id, status, price_cents")
      .in("source_car_id", ids)
      .in("status", ["active", "reserved", "sold"]),
    supabase.from("follows").select("target_id").eq("target_type", "car").in("target_id", ids),
    supabase.from("likes").select("target_id").eq("target_type", "car").in("target_id", ids),
  ]);

  // Open offers on the live parts off these cars, and the cover of each
  // car's latest update — both keyed off the first round.
  const liveListingIds = (listings ?? []).filter((l) => l.status !== "sold").map((l) => l.id);
  const latestPostIds = new Map<string, string>();
  for (const p of posts ?? []) if (!latestPostIds.has(p.car_id)) latestPostIds.set(p.car_id, p.id);
  const [{ data: offers }, { data: postImages }] = await Promise.all([
    liveListingIds.length
      ? supabase.from("offers").select("listing_id").eq("status", "open").in("listing_id", liveListingIds)
      : Promise.resolve({ data: [] as { listing_id: string }[] }),
    latestPostIds.size
      ? supabase
          .from("activity_images")
          .select("post_id, url, position")
          .in("post_id", [...latestPostIds.values()])
          .order("position")
      : Promise.resolve({ data: [] as { post_id: string; url: string; position: number }[] }),
  ]);

  const count = (rows: { [k: string]: unknown }[] | null, key: string) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const k = r[key] as string;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const photosBy = count(images, "car_id");
  const modsBy = count(mods, "car_id");
  const followsBy = count(follows, "target_id");
  const likesBy = count(likes, "target_id");
  const listingCar = new Map((listings ?? []).map((l) => [l.id, l.source_car_id]));
  const offersBy = new Map<string, number>();
  for (const o of offers ?? []) {
    const car = listingCar.get(o.listing_id);
    if (car) offersBy.set(car, (offersBy.get(car) ?? 0) + 1);
  }
  const postCover = new Map<string, string>();
  for (const img of postImages ?? []) if (!postCover.has(img.post_id)) postCover.set(img.post_id, img.url);

  return cars.map((car, index) => {
    const carPosts = (posts ?? []).filter((p) => p.car_id === car.id);
    const latest = carPosts[0] ?? null;
    const carListings = (listings ?? []).filter((l) => l.source_car_id === car.id);
    const sold = carListings.filter((l) => l.status === "sold");
    return {
      id: car.id,
      slug: car.slug,
      name: car.name,
      year: car.year,
      make: car.make,
      model: car.model,
      cover_image_url: car.cover_image_url,
      is_public: car.is_public,
      created_at: car.created_at,
      index: index + 1,
      photos: photosBy.get(car.id) ?? 0,
      mods: modsBy.get(car.id) ?? 0,
      updates: carPosts.length,
      latestUpdate: latest
        ? {
            id: latest.id,
            title: latest.title,
            published_at: latest.published_at as string,
            cover_url: postCover.get(latest.id) ?? null,
          }
        : null,
      partsLive: carListings.length - sold.length,
      partsSold: sold.length,
      earnedCents: sold.reduce((s, l) => s + l.price_cents, 0),
      openOffers: offersBy.get(car.id) ?? 0,
      followers: followsBy.get(car.id) ?? 0,
      likes: likesBy.get(car.id) ?? 0,
    };
  });
}

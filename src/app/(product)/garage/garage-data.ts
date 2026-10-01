import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/database.types";
import { orderCars } from "@/lib/cars/order";
import { postHeadline } from "@/lib/activity/headline";
import { requiredRead } from "@/lib/supabase/required-read";

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
  /** G-3's stat strip reads these. They come from the VIN decode or the
   *  owner's own entry; a car with none of them simply has no strip. */
  trim: string | null;
  engine: string | null;
  drivetrain: string | null;
  /** Sheet number in the garage — order the cars were added. */
  index: number;
  photos: number;
  /** Every photo on the car, cover first — the plate swipes through them. */
  photoUrls: string[];
  mods: number;
  updates: number;
  latestUpdate: { id: string; title: string; published_at: string; cover_url: string | null } | null;
  /** Listed and buyable now. */
  partsLive: number;
  /** Reserved by a checkout in progress — not live, not sold yet. */
  partsHeld: number;
  /** Every sold listing, including ones the seller marked sold elsewhere. */
  partsSold: number;
  /** DRVN sales only (RR-09): what buyers paid for parts off this car on
   *  paid orders, less refunds, before fees and shipping. Never asking
   *  prices, and never a part marked sold somewhere else. */
  salesCents: number;
  salesCount: number;
  openOffers: number;
  followers: number;
  likes: number;
};

export type GarageCar = {
  id: string;
  slug: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  cover_image_url: string | null;
  is_public: boolean;
  created_at: string;
  trim: string | null;
  engine: string | null;
  drivetrain: string | null;
};

/** The owner's cars, main car first — step one of the garage. Split from
 *  the measuring so the page can start the focused car's editors as soon as
 *  it knows which car that is, beside the measuring rather than after it. */
export async function loadGarageCars(
  supabase: SupabaseClient<Database>,
  ownerId: string
): Promise<GarageCar[]> {
  // P-5: the member's own answer to "which car comes first?", not the
  // accident of which they added first.
  // RR-11: a failed read is not an empty garage — that would offer "add the
  // car you're building" to someone who already has three.
  const [carsResult, profileResult] = await Promise.all([
    supabase
      .from("cars")
      .select("id, slug, name, make, model, year, cover_image_url, is_public, created_at, trim, engine, drivetrain")
      .eq("owner_id", ownerId),
    supabase.from("profiles").select("main_car_id").eq("id", ownerId).maybeSingle(),
  ]);
  const carRows = requiredRead(carsResult, "your cars");
  const profile = requiredRead(profileResult, "your profile");
  return orderCars(carRows ?? [], profile?.main_car_id);
}

export async function loadGarageSheets(
  supabase: SupabaseClient<Database>,
  ownerId: string
): Promise<GarageSheet[]> {
  return measureGarageSheets(supabase, await loadGarageCars(supabase, ownerId));
}

/** One round over the cars' ids: the photos the plate swipes through, and
 *  everything else counted by the database (RR-25) — the sheet used to fetch
 *  every mod, post, listing, follow and like row to count them here. */
export async function measureGarageSheets(
  supabase: SupabaseClient<Database>,
  cars: GarageCar[]
): Promise<GarageSheet[]> {
  if (!cars.length) return [];
  const ids = cars.map((c) => c.id);

  const [imagesResult, statsResult] = await Promise.all([
    supabase.from("car_images").select("car_id, url, position").in("car_id", ids).order("position"),
    supabase.rpc("garage_car_stats", { p_cars: ids }),
  ]);
  // RR-11: these are the sheet's own numbers — a failed read is shown as a
  // failed page with "Try again", never as a zero nobody counted.
  const images = requiredRead(imagesResult, "your cars' photos");
  const stats = requiredRead(statsResult, "your cars' numbers");

  const photoUrlsBy = new Map<string, string[]>();
  for (const img of images ?? []) {
    const list = photoUrlsBy.get(img.car_id) ?? [];
    list.push(img.url);
    photoUrlsBy.set(img.car_id, list);
  }
  const statsBy = new Map((stats ?? []).map((row) => [row.car_id, row]));

  return cars.map((car, index) => {
    const row = statsBy.get(car.id);
    const latest = row?.latest_update as
      | { id: string; title: string | null; intro: string | null; body: Json; published_at: string; cover_url: string | null }
      | null
      | undefined;
    const photos = photoUrlsBy.get(car.id) ?? [];
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
      photos: photos.length,
      photoUrls: (() => {
        const rest = photos.filter((u) => u !== car.cover_image_url);
        return car.cover_image_url ? [car.cover_image_url, ...rest] : rest;
      })(),
      trim: car.trim,
      engine: car.engine,
      drivetrain: car.drivetrain,
      mods: row?.mods ?? 0,
      updates: row?.updates ?? 0,
      latestUpdate: latest
        ? {
            id: latest.id,
            title: postHeadline(latest),
            published_at: latest.published_at,
            cover_url: latest.cover_url,
          }
        : null,
      partsLive: row?.parts_live ?? 0,
      partsHeld: row?.parts_held ?? 0,
      partsSold: row?.parts_sold ?? 0,
      salesCents: Number(row?.sales_cents ?? 0),
      salesCount: row?.sales_count ?? 0,
      openOffers: row?.open_offers ?? 0,
      followers: row?.followers ?? 0,
      likes: row?.likes ?? 0,
    };
  });
}

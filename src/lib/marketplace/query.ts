import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { ListingCardData } from "@/components/ui";

export type ListingFilters = {
  q?: string;
  category?: string;
  subcategory?: string;
  condition?: string;
  min?: string;
  max?: string;
  fit?: string;
};

/**
 * Fetches active listings with cover images and (when logged in) a
 * metadata-based "fits your car" hint: the listing's source car shares
 * make+model with a car in the viewer's garage. Never derived from seller
 * compatibility notes (PRD §7.1).
 */
export async function fetchListings(
  supabase: SupabaseClient<Database>,
  filters: ListingFilters,
  viewerId?: string
): Promise<ListingCardData[]> {
  let query = supabase
    .from("listings")
    .select("id, title, price_cents, condition, location, source_car_id")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(48);

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.subcategory) query = query.eq("subcategory", filters.subcategory);
  if (filters.condition) {
    query = query.eq(
      "condition",
      filters.condition as "new" | "like_new" | "used" | "for_parts"
    );
  }
  if (filters.q) query = query.ilike("title", `%${filters.q}%`);
  const min = Number(filters.min);
  const max = Number(filters.max);
  if (filters.min && Number.isFinite(min)) query = query.gte("price_cents", Math.round(min * 100));
  if (filters.max && Number.isFinite(max)) query = query.lte("price_cents", Math.round(max * 100));

  const { data: listings } = await query;
  if (!listings?.length) return [];

  const ids = listings.map((l) => l.id);
  const { data: images } = await supabase
    .from("listing_images")
    .select("listing_id, url, position")
    .in("listing_id", ids)
    .order("position");

  const coverByListing = new Map<string, string>();
  for (const image of images ?? []) {
    if (!coverByListing.has(image.listing_id)) coverByListing.set(image.listing_id, image.url);
  }

  // Metadata-based fitment hint via source car make/model vs viewer's garage.
  const fitByListing = new Map<string, string>();
  const sourceCarIds = listings.map((l) => l.source_car_id).filter(Boolean) as string[];
  if (viewerId && sourceCarIds.length) {
    const [{ data: sourceCars }, { data: garageCars }] = await Promise.all([
      supabase.from("cars").select("id, make, model").in("id", sourceCarIds),
      supabase.from("cars").select("name, make, model").eq("owner_id", viewerId),
    ]);
    const garageByKey = new Map(
      (garageCars ?? [])
        .filter((c) => c.make && c.model)
        .map((c) => [`${c.make}`.toLowerCase() + "|" + `${c.model}`.toLowerCase(), c.name])
    );
    const sourceById = new Map((sourceCars ?? []).map((c) => [c.id, c]));
    for (const listing of listings) {
      const source = listing.source_car_id ? sourceById.get(listing.source_car_id) : null;
      if (source?.make && source.model) {
        const match = garageByKey.get(
          source.make.toLowerCase() + "|" + source.model.toLowerCase()
        );
        if (match) fitByListing.set(listing.id, match);
      }
    }
  }

  let results = listings.map((l) => ({
    id: l.id,
    title: l.title,
    price_cents: l.price_cents,
    condition: l.condition,
    location: l.location,
    cover_url: coverByListing.get(l.id) ?? null,
    fits_car_name: fitByListing.get(l.id) ?? null,
  }));

  if (filters.fit === "1") {
    results = results.filter((r) => r.fits_car_name);
  }

  return results;
}

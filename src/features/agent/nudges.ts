import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { NUDGE_MIN_AGE_DAYS, NUDGE_MIN_VIEWS, priceNudge, type PriceNudge } from "@/lib/agent/nudges";
import type { Database } from "@/lib/database.types";

export type ListingNudge = PriceNudge & { listingId: string; title: string; priceCents: number; image: string | null };

const DAY = 86_400_000;

/**
 * The seller's own live listings that a price-drop suggestion fits (A5), at
 * most three: read as the member (their minimum through its owner-only
 * function), sales through price_comparables, the rule in lib/agent/nudges.
 */
export async function loadPriceNudges(supabase: SupabaseClient<Database>, ownerId: string, now: number): Promise<ListingNudge[]> {
  const before = new Date(now - NUDGE_MIN_AGE_DAYS * DAY).toISOString();
  const { data: listings } = await supabase
    .from("listings")
    .select("id, title, price_cents, created_at, view_count, brand, part_number")
    .eq("seller_id", ownerId)
    .eq("status", "active")
    .lte("created_at", before)
    .gte("view_count", NUDGE_MIN_VIEWS)
    .order("view_count", { ascending: false })
    .limit(10);
  if (!listings?.length) return [];
  const ids = listings.map((listing) => listing.id);
  const [{ data: offers }, { data: images }] = await Promise.all([
    supabase.from("offers").select("listing_id").in("listing_id", ids),
    supabase.from("listing_images").select("listing_id, url, position").in("listing_id", ids).order("position"),
  ]);
  const offered = new Set((offers ?? []).map((offer) => offer.listing_id));
  const cover = new Map<string, string>();
  for (const image of images ?? []) if (!cover.has(image.listing_id)) cover.set(image.listing_id, image.url);

  const out: ListingNudge[] = [];
  for (const listing of listings) {
    if (out.length >= 3) break;
    if (offered.has(listing.id)) continue;
    const [{ data: floor }, comparables] = await Promise.all([
      supabase.rpc("my_listing_offer_floor", { p_listing: listing.id }),
      listing.brand && listing.part_number
        ? supabase.rpc("price_comparables", { p_brand: listing.brand, p_part_number: listing.part_number, p_exclude_listing: listing.id })
        : Promise.resolve({ data: null }),
    ]);
    const sold = (comparables.data as { sold?: { enough?: boolean; median_cents?: number } } | null)?.sold;
    const nudge = priceNudge({
      priceCents: listing.price_cents,
      floorCents: typeof floor === "number" ? floor : null,
      soldMedianCents: sold?.enough && typeof sold.median_cents === "number" ? sold.median_cents : null,
      ageDays: (now - new Date(listing.created_at).getTime()) / DAY,
      views: listing.view_count,
      offers: offered.has(listing.id) ? 1 : 0,
    });
    if (nudge) out.push({ ...nudge, listingId: listing.id, title: listing.title, priceCents: listing.price_cents, image: cover.get(listing.id) ?? null });
  }
  return out;
}

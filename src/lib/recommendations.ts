import "server-only";

import type { ListingCardData } from "@/components/ui";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * P1 rule-based recommendations (PRD §7.6 — no LLM):
 *  1. Platform match: active listings whose source car shares make+model with
 *     a car in the user's garage (car metadata, never seller notes).
 *  2. Co-save: listings saved by people who saved the same things as you.
 *  3. Fallback: most-saved active listings.
 * Uses the admin client for aggregate save counts (RLS keeps individual saves
 * private to actors/target-owners; aggregates are anonymous).
 */
export async function recommendListings(
  userId: string,
  limit = 8
): Promise<ListingCardData[]> {
  const admin = createAdminClient();
  const picks = new Map<string, number>(); // listing_id → score

  const [{ data: garage }, { data: mySaves }] = await Promise.all([
    admin.from("cars").select("make, model").eq("owner_id", userId),
    admin.from("saves").select("target_type, target_id").eq("user_id", userId),
  ]);

  // Rule 1 — platform match via source car metadata.
  const platforms = (garage ?? []).filter((c) => c.make && c.model);
  if (platforms.length) {
    const { data: candidateListings } = await admin
      .from("listings")
      .select("id, seller_id, source_car_id, status")
      .eq("status", "active")
      .not("source_car_id", "is", null)
      .limit(200);
    const sourceIds = [...new Set((candidateListings ?? []).map((l) => l.source_car_id!))];
    const { data: sourceCars } = sourceIds.length
      ? await admin.from("cars").select("id, make, model").in("id", sourceIds)
      : { data: [] };
    const platformKeys = new Set(
      platforms.map((c) => `${c.make!.toLowerCase()}|${c.model!.toLowerCase()}`)
    );
    const sourceById = new Map((sourceCars ?? []).map((c) => [c.id, c]));
    for (const listing of candidateListings ?? []) {
      if (listing.seller_id === userId) continue;
      const source = sourceById.get(listing.source_car_id!);
      if (
        source?.make &&
        source.model &&
        platformKeys.has(`${source.make.toLowerCase()}|${source.model.toLowerCase()}`)
      ) {
        picks.set(listing.id, (picks.get(listing.id) ?? 0) + 10);
      }
    }
  }

  // Rule 2 — co-save neighbors.
  const savedListingIds = (mySaves ?? [])
    .filter((s) => s.target_type === "listing")
    .map((s) => s.target_id);
  if (savedListingIds.length) {
    const { data: coSavers } = await admin
      .from("saves")
      .select("user_id")
      .eq("target_type", "listing")
      .in("target_id", savedListingIds)
      .neq("user_id", userId)
      .limit(100);
    const neighborIds = [...new Set((coSavers ?? []).map((s) => s.user_id))];
    if (neighborIds.length) {
      const { data: neighborSaves } = await admin
        .from("saves")
        .select("target_id")
        .eq("target_type", "listing")
        .in("user_id", neighborIds)
        .limit(300);
      for (const save of neighborSaves ?? []) {
        if (!savedListingIds.includes(save.target_id)) {
          picks.set(save.target_id, (picks.get(save.target_id) ?? 0) + 3);
        }
      }
    }
  }

  // Rule 3 — popularity fallback.
  if (picks.size < limit) {
    const { data: popular } = await admin
      .from("saves")
      .select("target_id")
      .eq("target_type", "listing")
      .limit(300);
    for (const save of popular ?? []) {
      picks.set(save.target_id, (picks.get(save.target_id) ?? 0) + 1);
    }
  }

  if (!picks.size) return [];

  const ranked = [...picks.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  // Hydrate, keeping only active listings not sold by the user themselves.
  const { data: listings } = await admin
    .from("listings")
    .select("id, title, price_cents, condition, location, seller_id, status")
    .in("id", ranked.slice(0, limit * 3));
  const { data: images } = listings?.length
    ? await admin
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", listings.map((l) => l.id))
        .order("position")
    : { data: [] };
  const cover = new Map<string, string>();
  for (const img of images ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }

  const byId = new Map((listings ?? []).map((l) => [l.id, l]));
  const results: ListingCardData[] = [];
  for (const id of ranked) {
    const listing = byId.get(id);
    if (!listing || listing.status !== "active" || listing.seller_id === userId) continue;
    results.push({
      id: listing.id,
      title: listing.title,
      price_cents: listing.price_cents,
      condition: listing.condition,
      location: listing.location,
      cover_url: cover.get(listing.id) ?? null,
    });
    if (results.length >= limit) break;
  }
  return results;
}

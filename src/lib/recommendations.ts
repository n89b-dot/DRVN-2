import "server-only";

import type { ListingCardData } from "@/components/ui";
import { hydrateListingCards } from "@/lib/marketplace/query";
import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformLabel } from "@/lib/vehicles/label";

const CANDIDATE_CAP = 50;

/**
 * P1 rule-based recommendations (PRD §7.6 — no LLM):
 *  1. Platform match: active listings whose source car shares make+model with
 *     a car in the user's garage (car metadata, never seller notes).
 *  2. Co-save: listings saved by people who saved the same things as you.
 *  3. Fallback: most-saved active listings.
 * Uses the admin client for aggregate save counts (RLS keeps individual saves
 * private to actors/target-owners; aggregates are anonymous).
 *
 * Each rule only pulls the rows it can score — matches, co-savers, and
 * fallback candidates are filtered in the query itself (.eq/.in/.not/.limit)
 * so the JS scoring pass below works over a bounded candidate set rather
 * than a wide unfiltered scan.
 */
export async function recommendListings(
  userId: string,
  limit = 8
): Promise<ListingCardData[]> {
  // #105: the cards it hydrates carry listing photos, shown on Home.
  const admin = createAdminClient({ signPhotos: true });
  // One statement: `recommend_listings` (migration 20260928121000) runs the
  // three rules below in the database — the chain here was up to eight
  // dependent reads. Service-role only, like the reads it replaces.
  const { data: ranked, error } = await admin.rpc("recommend_listings", { p_user: userId, p_limit: limit });
  if (!error && ranked) {
    if (!ranked.length) return [];
    const cards = await hydrateListingCards(admin, ranked);
    const reasons = new Map(ranked.map((r) => [r.id, r.reason]));
    return cards.map((card): ListingCardData => ({ ...card, reason: reasons.get(card.id) ?? null }));
  }
  reportError("[recommendations] recommend_listings unavailable, falling back to per-rule reads", error);
  return recommendListingsByRule(admin, userId, limit);
}

/** The per-rule reads `recommend_listings` replaced — kept as the fallback
 *  for a database without that function. */
async function recommendListingsByRule(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  limit: number
): Promise<ListingCardData[]> {
  const picks = new Map<string, number>(); // listing_id → score
  const reasons = new Map<string, string>(); // listing_id → why it was picked

  const [{ data: garage }, { data: mySaves }] = await Promise.all([
    admin.from("cars").select("make, model").eq("owner_id", userId),
    // Newest first: rule 2 slices this list to CANDIDATE_CAP, and a stable
    // most-recent sample beats whatever order Postgres happens to return.
    admin
      .from("saves")
      .select("target_type, target_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  // Rule 1 — platform match via source car metadata. Resolve which source
  // cars actually match the user's garage first (make+model is not a
  // single indexable equality, so this is a superset-then-refine narrowing:
  // fetch cars sharing a make or model with the garage, then keep exact
  // pairs — a far smaller set than every car in the table), then query only
  // the listings built on those cars.
  const platforms = (garage ?? []).filter((c) => c.make && c.model);
  if (platforms.length) {
    const makes = [...new Set(platforms.map((c) => c.make!))];
    const models = [...new Set(platforms.map((c) => c.model!))];
    const platformKeys = new Set(
      platforms.map((c) => `${c.make!.toLowerCase()}|${c.model!.toLowerCase()}`)
    );
    const { data: candidateCars } = await admin
      .from("cars")
      .select("id, make, model")
      .in("make", makes)
      .in("model", models);
    const matchedCars = (candidateCars ?? []).filter(
      (c) =>
        c.make && c.model && platformKeys.has(`${c.make.toLowerCase()}|${c.model.toLowerCase()}`)
    );
    const matchedCarIds = matchedCars.map((c) => c.id);
    const nameByCarId = new Map(matchedCars.map((c) => [c.id, platformLabel(c)]));

    if (matchedCarIds.length) {
      const { data: platformListings } = await admin
        .from("listings")
        .select("id, source_car_id")
        .eq("status", "active")
        .neq("seller_id", userId)
        .in("source_car_id", matchedCarIds)
        .order("created_at", { ascending: false })
        .limit(CANDIDATE_CAP);
      for (const listing of platformListings ?? []) {
        picks.set(listing.id, (picks.get(listing.id) ?? 0) + 10);
        const carName = nameByCarId.get(listing.source_car_id!);
        if (carName && !reasons.has(listing.id)) reasons.set(listing.id, `Fits your ${carName}`);
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
      .in("target_id", savedListingIds.slice(0, CANDIDATE_CAP))
      .neq("user_id", userId)
      .limit(CANDIDATE_CAP);
    const neighborIds = [...new Set((coSavers ?? []).map((s) => s.user_id))].slice(
      0,
      CANDIDATE_CAP
    );
    if (neighborIds.length) {
      const { data: neighborSaves } = await admin
        .from("saves")
        .select("target_id")
        .eq("target_type", "listing")
        .in("user_id", neighborIds)
        .not("target_id", "in", `(${savedListingIds.join(",")})`)
        .limit(CANDIDATE_CAP);
      for (const save of neighborSaves ?? []) {
        picks.set(save.target_id, (picks.get(save.target_id) ?? 0) + 3);
        if (!reasons.has(save.target_id)) {
          reasons.set(save.target_id, "Because you saved similar parts");
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
      .limit(CANDIDATE_CAP);
    for (const save of popular ?? []) {
      picks.set(save.target_id, (picks.get(save.target_id) ?? 0) + 1);
      if (!reasons.has(save.target_id)) {
        reasons.set(save.target_id, "Popular with the DRVN community");
      }
    }
  }

  if (!picks.size) return [];

  const ranked = [...picks.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  // Keep only active listings not sold by the user themselves, in rank
  // order, then hydrate through the same path as the Marketplace grid so a
  // recommendation carries the identical card data — cover, source car,
  // seller trust, watch count — plus its reason.
  const { data: listings } = await admin
    .from("listings")
    .select(
      "id, title, price_cents, shipping_cents, condition, location, part_number, seller_id, source_car_id, status"
    )
    .in("id", ranked.slice(0, limit * 3));
  const byId = new Map((listings ?? []).map((l) => [l.id, l]));
  const chosen: NonNullable<typeof listings> = [];
  for (const id of ranked) {
    const listing = byId.get(id);
    if (!listing || listing.status !== "active" || listing.seller_id === userId) continue;
    chosen.push(listing);
    if (chosen.length >= limit) break;
  }
  if (!chosen.length) return [];

  const cards = await hydrateListingCards(admin, chosen);
  return cards.map((card): ListingCardData => ({ ...card, reason: reasons.get(card.id) ?? null }));
}

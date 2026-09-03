import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { typesenseConfigured, typesenseDelete, typesenseUpsert } from "@/lib/search/typesense";
import { vehicleLabel } from "@/lib/vehicles/label";

import { activitySearchText } from "./extract";
import {
  EXPLORE_COLLECTIONS,
  type CarSearchDocument,
  type ProfileSearchDocument,
  type UpdateSearchDocument,
} from "./typesense";

/**
 * Explore index lifecycle (brief §28) — the same doctrine as
 * syncListingToSearch: fire-and-forget (`void syncCarToSearch(id)`), no-op
 * without an engine, never on a mutation's critical path, and delete-on-
 * ineligibility so the index only ever holds public material. Full rebuilds:
 * scripts/reindex-explore.mjs.
 *
 * Call sites:
 *   syncCarToSearch      car created / edited / visibility toggled / mods
 *                        changed — a car turning private also cascades a
 *                        resync of its posts (they become ineligible).
 *   syncUpdateToSearch   post published / edited / deleted / unpublished.
 *   syncProfileToSearch  username, display name or headline changed;
 *                        suspension state changes.
 */
export async function syncCarToSearch(carId: string): Promise<void> {
  if (!typesenseConfigured()) return;
  const admin = createAdminClient();
  const { data: car } = await admin
    .from("cars")
    .select("id, name, make, model, year, tags, about, is_public, created_at")
    .eq("id", carId)
    .maybeSingle();
  if (!car) {
    await typesenseDelete(EXPLORE_COLLECTIONS.car, carId);
    return;
  }
  if (!car.is_public) {
    // Ineligible car: remove it AND its posts — a published post on a
    // now-private build is no longer search material either.
    await typesenseDelete(EXPLORE_COLLECTIONS.car, carId);
    const { data: posts } = await admin
      .from("activity_posts")
      .select("id")
      .eq("car_id", carId)
      .limit(500);
    await Promise.all(
      (posts ?? []).map((p) => typesenseDelete(EXPLORE_COLLECTIONS.update, p.id))
    );
    return;
  }

  const { data: mods } = await admin
    .from("mod_items")
    .select("brand, product, part_number")
    .eq("car_id", carId)
    .limit(500);

  const doc: CarSearchDocument = {
    id: car.id,
    name: car.name,
    vehicle: vehicleLabel({
      year: car.year ?? undefined,
      make: car.make ?? undefined,
      model: car.model ?? undefined,
    }),
    tags: car.tags ?? [],
    about: car.about ?? "",
    mods: (mods ?? [])
      .map((m) => [m.brand, m.product, m.part_number].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(" "),
    created_at_unix: Math.floor(new Date(car.created_at).getTime() / 1000),
  };
  await typesenseUpsert(EXPLORE_COLLECTIONS.car, doc);

  // A car flipping public makes its already-published posts eligible again.
  const { data: posts } = await admin
    .from("activity_posts")
    .select("id")
    .eq("car_id", carId)
    .not("published_at", "is", null)
    .limit(500);
  await Promise.all((posts ?? []).map((p) => syncUpdateToSearch(p.id)));
}

export async function syncUpdateToSearch(postId: string): Promise<void> {
  if (!typesenseConfigured()) return;
  const admin = createAdminClient();
  const { data: post } = await admin
    .from("activity_posts")
    .select("id, title, intro, body, published_at, car_id")
    .eq("id", postId)
    .maybeSingle();
  if (!post || !post.published_at) {
    await typesenseDelete(EXPLORE_COLLECTIONS.update, postId);
    return;
  }
  const { data: car } = await admin
    .from("cars")
    .select("name, make, model, year, is_public")
    .eq("id", post.car_id)
    .maybeSingle();
  if (!car?.is_public) {
    await typesenseDelete(EXPLORE_COLLECTIONS.update, postId);
    return;
  }

  const doc: UpdateSearchDocument = {
    id: post.id,
    title: post.title,
    intro: post.intro ?? "",
    body_text: activitySearchText(post.body),
    vehicle: [
      vehicleLabel({
        year: car.year ?? undefined,
        make: car.make ?? undefined,
        model: car.model ?? undefined,
      }),
      car.name,
    ]
      .filter(Boolean)
      .join(" "),
    published_at_unix: Math.floor(new Date(post.published_at).getTime() / 1000),
  };
  await typesenseUpsert(EXPLORE_COLLECTIONS.update, doc);
}

export async function syncProfileToSearch(profileId: string): Promise<void> {
  if (!typesenseConfigured()) return;
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, username, display_name, headline, suspended_at, created_at")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile || profile.suspended_at || (!profile.username && !profile.display_name)) {
    await typesenseDelete(EXPLORE_COLLECTIONS.profile, profileId);
    return;
  }
  const doc: ProfileSearchDocument = {
    id: profile.id,
    username: profile.username ?? "",
    display_name: profile.display_name ?? "",
    headline: profile.headline ?? "",
    created_at_unix: Math.floor(new Date(profile.created_at).getTime() / 1000),
  };
  await typesenseUpsert(EXPLORE_COLLECTIONS.profile, doc);
}

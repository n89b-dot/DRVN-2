import { enqueueSearch } from "@/lib/search/enqueue";
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
 * syncListingToSearch: durable queue delivery, no-op
 * without an engine, retry on query or delivery failure, and delete-on-
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
export async function indexCarNow(carId: string, assertLease: () => Promise<void> = async () => {}): Promise<void> {
  if (!typesenseConfigured()) return;
  const admin = createAdminClient();
  const { data: car } = await admin
    .from("cars")
    .select("id, owner_id, name, make, model, year, tags, about, is_public, created_at")
    .eq("id", carId)
    .maybeSingle().throwOnError();
  if (!car) {
    await assertLease();
    await typesenseDelete(EXPLORE_COLLECTIONS.car, carId);
    return;
  }
  const owner = await admin.from("profiles").select("suspended_at").eq("id", car.owner_id).maybeSingle().throwOnError();
  if (!car.is_public || !owner.data || owner.data.suspended_at) {
    // Ineligible car: remove it AND its posts — a published post on a
    // now-private build is no longer search material either.
    await assertLease();
    await typesenseDelete(EXPLORE_COLLECTIONS.car, carId);
    return;
  }

  const mods: { brand: string | null; product: string | null; part_number: string | null }[] = [];
  let cursor: string | undefined;
  for (;;) {
    await assertLease();
    // Removed parts leave the index with the car: a build should not keep
    // matching a part it no longer has. They stay readable on the build
    // sheet under "came off this car" (see 20260919171500 for the SQL lane).
    let query = admin.from("mod_items").select("id, brand, product, part_number")
      .eq("car_id", carId).eq("status", "installed").order("id").limit(500);
    if (cursor) query = query.gt("id", cursor);
    const { data } = await query.throwOnError();
    const page = data ?? [];
    mods.push(...page);
    if (page.length < 500) break;
    cursor = page[page.length - 1].id;
  }

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
  await assertLease();
  await typesenseUpsert(EXPLORE_COLLECTIONS.car, doc);

  // Transactional queue triggers schedule dependent posts.

}

export async function indexUpdateNow(postId: string, assertLease: () => Promise<void> = async () => {}): Promise<void> {
  if (!typesenseConfigured()) return;
  const admin = createAdminClient();
  const { data: post } = await admin
    .from("activity_posts")
    .select("id, title, intro, body, published_at, car_id")
    .eq("id", postId)
    .maybeSingle().throwOnError();
  if (!post || !post.published_at) {
    await assertLease();
    await typesenseDelete(EXPLORE_COLLECTIONS.update, postId);
    return;
  }
  const { data: car } = await admin
    .from("cars")
    .select("name, make, model, year, is_public, owner_id")
    .eq("id", post.car_id)
    .maybeSingle().throwOnError();
  const owner = car ? await admin.from("profiles").select("suspended_at").eq("id", car.owner_id).maybeSingle().throwOnError() : null;
  if (!car?.is_public || !owner?.data || owner.data.suspended_at) {
    await assertLease();
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
  await assertLease();
  await typesenseUpsert(EXPLORE_COLLECTIONS.update, doc);
}

export async function indexProfileNow(profileId: string, assertLease: () => Promise<void> = async () => {}): Promise<void> {
  if (!typesenseConfigured()) return;
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, username, display_name, headline, suspended_at, created_at")
    .eq("id", profileId)
    .maybeSingle().throwOnError();
  if (!profile || profile.suspended_at || (!profile.username && !profile.display_name)) {
    await assertLease();
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
  await assertLease();
  await typesenseUpsert(EXPLORE_COLLECTIONS.profile, doc);
}

export function syncCarToSearch(id: string) { return enqueueSearch("car", id); }
export function syncProfileToSearch(id: string) { return enqueueSearch("profile", id); }
export function syncUpdateToSearch(id: string) { return enqueueSearch("update", id); }

"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";

import { mapListingCategoryToMod } from "@/lib/mods/category-map";
import { createClient } from "@/lib/supabase/server";

export type AddToCarState = { error?: string; ok?: string };

type CommercialSnapshot = {
  listing?: { id?: string; title?: string; category?: string; subcategory?: string };
  part?: { part_number?: string; brand?: string };
  seller?: { username?: string; display_name?: string };
};

/**
 * C-1 — add a part you bought to one of your cars.
 *
 * Built from `order_items.commercial_snapshot` (0049) and never from the live
 * listing. That is the whole point: by the time somebody fits the part, the
 * seller may have edited the listing, re-shot it, relisted it as something
 * else or deleted it outright. What goes on the build sheet has to be what
 * was actually bought, which is exactly what the snapshot froze at purchase.
 *
 * Idempotent through `mod_items.source_order_item_id`, which is unique where
 * set. A second tap adds nothing and says so — the member gets the same
 * answer either way rather than a duplicate line or an error.
 *
 * Per order item, because an order can hold several parts and they may not
 * all be going on the same car.
 */
export async function addPurchaseToCar(
  _previous: AddToCarState,
  formData: FormData
): Promise<AddToCarState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orderItemId = String(formData.get("order_item_id") ?? "");
  const carId = String(formData.get("car_id") ?? "");
  if (!orderItemId || !carId) return { error: "Choose a car for this part." };

  // Both halves checked on the server: the order is theirs to have bought
  // from, and the car is theirs to put something on.
  const [{ data: item }, { data: car }] = await Promise.all([
    supabase
      .from("order_items")
      .select("id, order_id, commercial_snapshot, orders!inner(id, buyer_id, status)")
      .eq("id", orderItemId)
      .maybeSingle(),
    supabase.from("cars").select("id, slug, owner_id").eq("id", carId).maybeSingle(),
  ]);

  if (!car || car.owner_id !== user.id) return { error: "That car isn't in your garage." };

  const order = (item as unknown as { orders?: { buyer_id: string; status: string } } | null)?.orders;
  if (!item || !order || order.buyer_id !== user.id) {
    return { error: "That purchase isn't yours." };
  }
  // A part that hasn't arrived isn't on the car yet. Delivered or completed
  // only — the same window the review and return flows use.
  if (!["delivered", "completed"].includes(order.status)) {
    return { error: "You can add this once the order has arrived." };
  }

  const snapshot = (item.commercial_snapshot ?? {}) as CommercialSnapshot;
  const title = snapshot.listing?.title?.trim();
  if (!title) return { error: "This purchase has no record to build a part from." };

  // The provenance line is NOT baked into the text. `source_order_item_id` is
  // the durable fact — "this came from a DRVN order" — and the source car is
  // read back from the same frozen snapshot at render time, where its
  // CURRENT visibility can be checked. A car that goes private afterwards
  // must stop being named, and text written once can't do that.
  const { error } = await supabase.from("mod_items").insert({
    car_id: carId,
    group_label: "Other",
    category: mapListingCategoryToMod(snapshot.listing?.category, snapshot.listing?.subcategory),
    // The brand is part of what was bought: with the part number it is the
    // part's identity (B1 products), so the build line keeps both. Snapshots
    // from before 20261020110000 have no brand, and get none rather than
    // today's listing's.
    brand: snapshot.part?.brand?.trim().slice(0, 80) || null,
    product: title.slice(0, 200),
    part_number: snapshot.part?.part_number?.slice(0, 80) ?? null,
    raw_text: title.slice(0, 200),
    position: 0,
    source_order_item_id: orderItemId,
  });

  if (error) {
    // The unique index doing its job: they already added this one.
    // It may be on a DIFFERENT car of theirs, so say which rather than
    // claiming it's on the one they just picked.
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("mod_items")
        .select("car_id, cars!inner(name, year, make, model)")
        .eq("source_order_item_id", orderItemId)
        .maybeSingle();
      const held = (existing as unknown as {
        car_id: string;
        cars: { name: string | null; year: number | null; make: string | null; model: string | null };
      } | null);
      if (!held || held.car_id === carId) return { ok: "That part is already on this car." };
      const label =
        held.cars.name || [held.cars.year, held.cars.make, held.cars.model].filter(Boolean).join(" ");
      return { ok: `That part is already on ${label || "another of your cars"}.` };
    }
    if (error.code === "42501") return { error: "That purchase isn't yours." };
    return { error: error.message };
  }

  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath(`/cars/${car.slug}`);
  return { ok: "Added to your build." };
}

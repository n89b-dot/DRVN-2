import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * "Bought on DRVN · off {car}" (C-1).
 *
 * Read back from the order item's frozen purchase record rather than written
 * into the mod line at insert time, for one reason: the source car's
 * visibility can change afterwards. A build that was public when the part
 * sold and is private now must stop being named, and a sentence written once
 * into `raw_text` can't do that.
 *
 * Same rule as everywhere else a source car appears (contract 6): a private
 * car is not named here at all, and a public one is named and linked.
 */

export type ModProvenance = {
  /** Always true when a mod came from a purchase. */
  bought: true;
  /** The car it came off, when that build is public right now. */
  sourceCar: { name: string; slug: string } | null;
};

type Snapshot = {
  source_car?: { id?: string; name?: string; year?: number; make?: string; model?: string };
};

export async function fetchModProvenance(
  supabase: SupabaseClient<Database>,
  orderItemIds: string[]
): Promise<Map<string, ModProvenance>> {
  const out = new Map<string, ModProvenance>();
  const ids = [...new Set(orderItemIds.filter(Boolean))];
  if (!ids.length) return out;

  // `order_items` is readable only by the buyer and seller, and this line is
  // for everyone looking at the build. The function answers one thing — which
  // car a fitted part came off — and only for order items a mod points at.
  const { data: items } = await supabase.rpc("mod_purchase_sources", {
    p_order_item_ids: ids,
  });

  const carIds = new Set<string>();
  const snapshotByItem = new Map<string, Snapshot>();
  for (const item of items ?? []) {
    snapshotByItem.set(item.order_item_id, { source_car: { id: item.source_car_id ?? undefined } });
    if (item.source_car_id) carIds.add(item.source_car_id);
  }

  // Current visibility, not the visibility frozen at sale.
  const { data: cars } = carIds.size
    ? await supabase
        .from("cars")
        .select("id, slug, name, year, make, model")
        .in("id", [...carIds])
        .eq("is_public", true)
    : { data: [] };
  const publicCars = new Map((cars ?? []).map((c) => [c.id, c]));

  for (const [itemId, snapshot] of snapshotByItem) {
    const car = snapshot.source_car?.id ? publicCars.get(snapshot.source_car.id) : undefined;
    out.set(itemId, {
      bought: true,
      sourceCar: car
        ? {
            name: [car.year, car.make, car.model].filter(Boolean).join(" ") || car.name,
            slug: car.slug,
          }
        : null,
    });
  }
  return out;
}

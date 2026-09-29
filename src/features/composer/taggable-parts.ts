import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { formatPrice } from "@/lib/marketplace/taxonomy";

import type { TaggablePart } from "./part-picker";

/**
 * The author's own active listings, shaped for the part picker (W-3) — what
 * the full editor offers to tag, the same list the quick box reads on Home.
 * Covers ride along as an embed so no row is an empty grey square.
 */
export async function loadTaggableParts(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<TaggablePart[]> {
  const { data } = await supabase
    .from("listings")
    .select("id, title, price_cents, source_car_id, listing_images(url, position)")
    .eq("seller_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .order("position", { referencedTable: "listing_images" })
    .limit(1, { referencedTable: "listing_images" })
    .limit(40);
  return (data ?? []).map((l) => ({
    id: l.id,
    title: l.title,
    price: formatPrice(l.price_cents),
    cover: l.listing_images?.[0]?.url ?? null,
    sourceCarId: l.source_car_id,
  }));
}

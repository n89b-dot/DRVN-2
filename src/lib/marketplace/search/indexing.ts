import { enqueueSearch } from "@/lib/search/enqueue";
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { vehicleLabel } from "@/lib/vehicles/label";

import { deleteSearchDocument, upsertSearchDocument, typesenseConfigured, type ListingSearchDocument } from "./typesense";

/**
 * The synchronization path (brief §B1): after a listing is created, edited or
 * changes status, its search document follows — fire-and-forget, no-op when
 * no engine is configured, and never on the request's critical path. Full
 * rebuilds: scripts/reindex-search.mjs.
 */
export async function indexListingNow(listingId: string, assertLease: () => Promise<void> = async () => {}): Promise<void> {
  if (!typesenseConfigured()) return;
  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("listings")
    .select(
      "id, seller_id, title, description, compatibility_notes, part_number, part_number_compact, category, subcategory, status, price_cents, created_at, source_car_id",
    )
    .eq("id", listingId)
    .maybeSingle().throwOnError();
  if (!listing) { await assertLease(); await deleteSearchDocument(listingId); return; }
  const owner = await admin.from("profiles").select("suspended_at").eq("id", listing.seller_id).maybeSingle().throwOnError();
  if (listing.status !== "active" || !owner.data || owner.data.suspended_at) {
    await assertLease(); await deleteSearchDocument(listingId);
    return;
  }

  const [{ data: fitments }, { data: altNumbers }, { data: sourceCar }] = await Promise.all([
    admin
      .from("listing_fitments")
      .select("make, model, year_start, year_end")
      .eq("listing_id", listingId).throwOnError(),
    admin.from("listing_part_numbers").select("number").eq("listing_id", listingId).throwOnError(),
    listing.source_car_id
      ? admin
          .from("cars")
          .select("make, model, year")
          .eq("id", listing.source_car_id)
          .maybeSingle().throwOnError()
      : Promise.resolve({ data: null }),
  ]);

  const doc: ListingSearchDocument = {
    id: listing.id,
    title: listing.title,
    description: listing.description ?? "",
    compatibility_notes: listing.compatibility_notes ?? "",
    part_numbers: [
      ...(listing.part_number ? [listing.part_number] : []),
      ...(listing.part_number_compact ? [listing.part_number_compact] : []),
      ...(altNumbers ?? []).map((row) => row.number),
    ],
    category: listing.category ?? "",
    subcategory: listing.subcategory ?? "",
    fitment: (fitments ?? []).map((f) =>
      [f.make, f.model, f.year_start, f.year_end].filter(Boolean).join(" "),
    ),
    source_car: sourceCar
      ? vehicleLabel({
          year: sourceCar.year ?? undefined,
          make: sourceCar.make ?? undefined,
          model: sourceCar.model ?? undefined,
        })
      : "",
    status: listing.status,
    price_cents: listing.price_cents,
    created_at_unix: Math.floor(new Date(listing.created_at).getTime() / 1000),
  };
  await assertLease();
  await upsertSearchDocument(doc);
}

export function syncListingToSearch(id: string) { return enqueueSearch("listing", id); }

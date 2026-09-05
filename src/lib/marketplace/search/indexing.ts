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
export async function syncListingToSearch(listingId: string): Promise<void> {
  if (!typesenseConfigured()) return;
  const admin = createAdminClient();
  const { data: listing } = await admin
    .from("listings")
    .select(
      "id, title, description, compatibility_notes, part_number, part_number_compact, category, subcategory, status, price_cents, created_at, source_car_id",
    )
    .eq("id", listingId)
    .maybeSingle().throwOnError();
  if (!listing) { await deleteSearchDocument(listingId); return; }
  if (listing.status !== "active") {
    await deleteSearchDocument(listingId);
    return;
  }

  const [{ data: fitments }, { data: altNumbers }, { data: sourceCar }] = await Promise.all([
    admin
      .from("listing_fitments")
      .select("make, model, year_start, year_end")
      .eq("listing_id", listingId),
    admin.from("listing_part_numbers").select("number").eq("listing_id", listingId),
    listing.source_car_id
      ? admin
          .from("cars")
          .select("make, model, year")
          .eq("id", listing.source_car_id)
          .maybeSingle()
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
  await upsertSearchDocument(doc);
}

import { enqueueSearch } from "@/lib/search/enqueue";
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { vehicleLabel } from "@/lib/vehicles/label";

import { deleteSearchDocument, deleteSearchDocuments, importSearchDocuments, upsertSearchDocument, typesenseConfigured, type ListingSearchDocument } from "./typesense";

/**
 * The synchronization path (brief §B1): after a listing is created, edited or
 * changes status, its search document follows — fire-and-forget, no-op when
 * no engine is configured, and never on the request's critical path. Full
 * rebuilds: scripts/reindex-search.mjs.
 */
export async function indexListingNow(listingId: string, assertLease: () => Promise<void> = async () => {}): Promise<void> {
  if (!typesenseConfigured()) return;
  // The same document the batches build; the code below is for a database
  // without search_listing_documents (before migration 20261011130000).
  if (await indexListingsNow([listingId], assertLease)) return;
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

  const doc: LegacyListingSearchDocument = {
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

/**
 * Many parts at once: one database call builds every document
 * (search_listing_documents, migration 20261011130000), one request imports
 * them, one deletes the parts that should no longer be found. Returns false
 * when the database doesn't have the batch builder yet — the caller then
 * indexes one at a time.
 */
export async function indexListingsNow(listingIds: string[], assertLease: () => Promise<void> = async () => {}): Promise<boolean> {
  if (!typesenseConfigured() || !listingIds.length) return true;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("search_listing_documents", { p_ids: listingIds });
  if (error?.code === "PGRST202") return false;
  if (error) throw new Error("Search documents could not be built");
  const docs = (data ?? []).map((row) => row.doc as unknown as ListingSearchDocument);
  const kept = new Set(docs.map((doc) => doc.id));
  await assertLease();
  await importSearchDocuments(docs);
  await deleteSearchDocuments(listingIds.filter((id) => !kept.has(id)));
  return true;
}

type LegacyListingSearchDocument = Pick<ListingSearchDocument,
  "id" | "title" | "description" | "compatibility_notes" | "part_numbers" | "category" | "subcategory" | "fitment" | "source_car" | "status" | "price_cents" | "created_at_unix">;

export function syncListingToSearch(id: string) { return enqueueSearch("listing", id); }

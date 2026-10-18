import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Alert, ButtonLink, Foot, Media, PageHead } from "@/components/ui";
import { formatPrice } from "@/lib/payments/fee";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";
import { requiredRead } from "@/lib/supabase/required-read";
import { getVehicleMakes } from "@/lib/vehicles/vpic";
import {
  fulfillmentProfileReady,
  loadFulfillmentProfile,
} from "@/features/commerce/fulfillment";
import { integratedShippingEnabled } from "@/lib/shipping/provider";
import type { ChecklistAnswer } from "@/lib/marketplace/grading";

import { SellForm } from "../../../sell/sell-form";
import { DeleteListing } from "../../delete-listing";
import { ListingStatusActions } from "../../status-actions";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Edit listing - DRVN" };

export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;

  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  const { data: listing, error } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    reportError("[listings/edit] failed to load listing", { id, error });
    throw new Error("Could not load this listing");
  }
  if (!listing || listing.seller_id !== user.id) notFound();

  const [carsResult, imagesResult, fitmentsResult, altNumbersResult, floorResult, makes] =
    await Promise.all([
      supabase
        .from("cars")
        .select("id, name, make, model, year")
        .eq("owner_id", user.id)
        .order("created_at"),
      supabase
        .from("listing_images")
        .select("url, alt, position")
        .eq("listing_id", id)
        .order("position"),
      supabase
        .from("listing_fitments")
        .select("make, model, year_start, year_end")
        .eq("listing_id", id)
        .order("created_at"),
      supabase
        .from("listing_part_numbers")
        .select("number")
        .eq("listing_id", id)
        .order("created_at"),
      // The minimum is private (20261017130000): only the seller's own
      // function returns it, never the listings row.
      supabase.rpc("my_listing_offer_floor", { p_listing: id }),
      getVehicleMakes(createAdminClient()),
    ]);

  // RR-11: the form saves photos, fitment and alternate numbers whole — a
  // failed read here must never reach it as an empty list.
  const cars = requiredRead(carsResult, "your cars");
  const images = requiredRead(imagesResult, "this listing's photos");
  const fitments = requiredRead(fitmentsResult, "this listing's fitment");
  const altNumbers = requiredRead(altNumbersResult, "this listing's part numbers");
  // The form saves the minimum it was given, so an unread one would be cleared.
  const offerFloorCents = requiredRead(floorResult, "this listing's offer minimum") ?? null;

  const locked = ["sold", "reserved"].includes(listing.status);
  const statusLabel: Record<string, string> = {
    draft: "Draft, not public",
    active: "Live",
    paused: "Paused",
    archived: "Archived",
    reserved: "Reserved",
    sold: "Sold",
  };
  const sourceCar = (cars ?? []).find((c) => c.id === listing.source_car_id);
  const cover = images?.[0]?.url;

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 pb-10">
      {/* A task head names the thing being edited — photo, title, price,
          where it came off — with a way back to the public page. */}
      <PageHead
        className="pagehead--task"
        eyebrow={`Editing · ${statusLabel[listing.status] ?? listing.status}`}
        title={listing.title}
      >
        <p className="sub sub--keep flex items-center gap-3">
          <Media
            src={cover}
            alt={listing.title}
            className="order__img"
            role="thumb"
          />
          <span>
            {formatPrice(listing.price_cents)}
            {sourceCar && <> · Off {sourceCar.name}</>}
          </span>
        </p>
        <div className="jumprow !mb-0 !mt-4">
          {listing.status !== "draft" && (
            <Link href={`/listings/${listing.id}`} className="jumplink">
              View listing →
            </Link>
          )}
          <Link href="/listings" className="jumplink">
            All listings
          </Link>
          {/* "Publish it from here" has to be true: the ledger's own
              Publish / Relist control, for a listing that isn't live. */}
          {(listing.status === "draft" || listing.status === "paused" || listing.status === "archived") && (
            <ListingStatusActions id={listing.id} status={listing.status} />
          )}
        </div>
      </PageHead>

      {saved === "draft" && (
        <Alert tone="ok" ico="✓" title="Draft saved" className="mb-6">
          Nothing is public yet. Publish it from here or from your listings.
        </Alert>
      )}

      {locked ? (
        <>
          <Alert title={`This part is ${listing.status}`}>
            A sold or reserved listing can&apos;t be edited — its details are part of an order
            record. List a replacement instead.
          </Alert>
          <ButtonLink variant="ghost" href="/sell" className="mt-4">
            List another part
          </ButtonLink>
        </>
      ) : (
        <SellForm
          cars={cars ?? []}
          makes={makes.map((m) => m.name)}
          userId={user.id}
          drvnShipping={{
            enabled: integratedShippingEnabled(),
            profileReady: fulfillmentProfileReady(
              await loadFulfillmentProfile(user.id).catch(() => null),
            ),
          }}
          listing={{
            id: listing.id,
            title: listing.title,
            description: listing.description,
            category: listing.category,
            subcategory: listing.subcategory,
            brand: listing.brand,
            part_miles: listing.part_miles,
            part_miles_unit: listing.part_miles_unit,
            condition: listing.condition,
            grade: listing.grade,
            condition_checklist: listing.condition_checklist as Record<
              string,
              ChecklistAnswer
            > | null,
            part_number: listing.part_number,
            price_cents: listing.price_cents,
            shipping_cents: listing.shipping_cents ?? 0,
            shipping_mode: listing.shipping_mode ?? "flat",
            weight_oz: listing.weight_oz,
            length_in: listing.length_in,
            width_in: listing.width_in,
            height_in: listing.height_in,
            offer_floor_cents: offerFloorCents,
            show_offer_floor: listing.show_offer_floor,
            allows_collection: listing.allows_collection ?? false,
            location: listing.location,
            compatibility_notes: listing.compatibility_notes,
            source_car_id: listing.source_car_id,
            updated_at: listing.updated_at,
            status: listing.status,
            images: (images ?? []).map((i) => ({ url: i.url, alt: i.alt })),
            fitments: fitments ?? [],
            alt_part_numbers: (altNumbers ?? []).map((n) => n.number),
          }}
        />
      )}

      {/* A sold or reserved part is part of an order record: deleting it is
          refused, so it isn't offered (the ledger's rule). */}
      {!locked && (
      <section className="deck mt-10">
        <Rv className="tile">
          <span className="microlabel microlabel--ink">Remove it entirely</span>
          <p className="spec-note">
            Deleting takes the listing off DRVN for good. Past orders keep their record, so
            receipts and reviews survive.
          </p>
          <div className="mt-3">
            <DeleteListing listingId={listing.id} />
          </div>
        </Rv>
      </section>
      )}

      <Foot
        left="DRVN — edits publish immediately"
        right={<Link href="/listings">← All your listings</Link>}
      />
    </div>
  );
}

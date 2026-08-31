import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { Alert } from "@/components/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getVehicleMakes } from "@/lib/vehicles/vpic";
import {
  fulfillmentProfileReady,
  loadFulfillmentProfile,
} from "@/features/commerce/fulfillment";
import { integratedShippingEnabled } from "@/lib/shipping/provider";
import type { ChecklistAnswer } from "@/lib/marketplace/grading";

import { SellForm } from "../../../sell/sell-form";
import { DeleteListing } from "../../delete-listing";
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const [{ data: cars }, { data: images }, { data: fitments }, { data: altNumbers }, makes] =
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
      getVehicleMakes(createAdminClient()),
    ]);

  const locked = ["sold", "reserved"].includes(listing.status);

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Editing · {listing.status === "draft" ? "draft, not public" : listing.status}
        </span>
        <h1>
          Redraw the <span className="live-word">line.</span>
        </h1>
      </Rv>

      {saved === "draft" && (
        <Alert tone="ok" ico="✓" title="Draft saved" className="mb-6">
          Nothing is public yet. Publish it from here or from your listings.
        </Alert>
      )}

      {locked ? (
        <Rv className="alert">
          <h4>This part is {listing.status}</h4>
          <p>
            A sold or reserved listing can&apos;t be edited — its details are part of an order
            record. List a replacement instead.
          </p>
          <Link href="/sell" className="btn btn--ghost">
            List another part
          </Link>
        </Rv>
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
            offer_floor_cents: listing.offer_floor_cents,
            allows_collection: listing.allows_collection ?? false,
            location: listing.location,
            compatibility_notes: listing.compatibility_notes,
            source_car_id: listing.source_car_id,
            status: listing.status,
            images: (images ?? []).map((i) => ({ url: i.url, alt: i.alt })),
            fitments: fitments ?? [],
            alt_part_numbers: (altNumbers ?? []).map((n) => n.number),
          }}
        />
      )}

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

      <Foot
        left="DRVN / Livesheet — edits publish immediately"
        right={<Link href="/listings">← All your listings</Link>}
      />
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { ButtonLink, EmptyState, Foot } from "@/components/ui";
import { getBetaAccess } from "@/lib/beta-access";
import { capture } from "@/lib/analytics";
import { sourceLabelFor } from "@/lib/listing-import/engine";
import {
  parseExtraction,
  parseImportedImages,
  parseNormalizedSource,
} from "@/lib/listing-import/schema";
import { mapModCategoryToListing } from "@/lib/mods/category-map";
import { sellerCanPublish } from "@/lib/payments/connect";
import {
  fulfillmentProfileReady,
  loadFulfillmentProfile,
} from "@/features/commerce/fulfillment";
import { integratedShippingEnabled } from "@/lib/shipping/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getVehicleMakes } from "@/lib/vehicles/vpic";

import { SellForm, type SellFormInitialValues } from "./sell-form";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Sell a part - DRVN" };

const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? undefined : (cents / 100).toFixed(2);

/** Maps a `ready` import row into the form's initial values. Null = the row
 *  isn't reviewable (wrong state / unparseable) — callers bounce to /sell/import. */
function importInitialValues(row: {
  id: string;
  status: string;
  source_mode: string;
  source_adapter: string | null;
  source_domain: string | null;
  selected_item: number | null;
  normalized_source: unknown;
  extracted: unknown;
  imported_images: unknown;
}): SellFormInitialValues | null {
  if (row.status !== "ready") return null;
  const extraction = parseExtraction(row.extracted);
  if (!extraction || (extraction.multipleItems && row.selected_item === null)) return null;
  const source = parseNormalizedSource(row.normalized_source);
  const images = parseImportedImages(row.imported_images).map((img) => ({
    url: img.url,
    alt: null,
  }));

  const issues = [...extraction.needsReview];
  if (!images.length) {
    issues.push({
      field: "photos",
      message:
        row.source_mode === "paste"
          ? "Add the photos from your original listing — text came over, photos don't."
          : "We couldn't bring over the photos — add your original photos.",
    });
  }

  return {
    origin: "import",
    title: extraction.title,
    category: extraction.category,
    subcategory: extraction.subcategory,
    condition: extraction.condition,
    description: extraction.description,
    partNumber: extraction.partNumber,
    price: money(extraction.priceCents),
    shipping:
      extraction.shippingCents !== undefined
        ? money(extraction.shippingCents)
        : extraction.shippingIncluded
          ? "0.00"
          : undefined,
    allowsCollection: extraction.allowsCollection,
    location: extraction.location,
    compatibilityNotes: extraction.compatibilityNotes,
    images,
    fitment: (extraction.resolvedFitments ?? []).map((f) => ({
      make: f.make,
      model: f.model,
      year_start: f.year_start,
      year_end: f.year_end,
    })),
    importReview: {
      id: row.id,
      sourceLabel: sourceLabelFor({
        source_adapter: row.source_adapter,
        source_domain: row.source_domain,
        source_mode: row.source_mode as "url" | "paste",
      }),
      originalText: source?.text.slice(0, 4000),
      issues,
    },
  };
}

export default async function SellPage({
  searchParams,
}: {
  // `car` and `mod` arrive from "list a part" on a build page or the garage;
  // `import` is a ready listing import coming in for review.
  searchParams: Promise<{ car?: string; mod?: string; import?: string }>;
}) {
  const { car: carParam, mod: modParam, import: importParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const betaAccess = await getBetaAccess(user.id, "seller");
  if (!betaAccess.eligible) {
    return (
      <div className="wrap pb-10">
        <EmptyState
          mark="β"
          title="Selling is limited to invited members"
          action={<ButtonLink href="/marketplace">Browse the marketplace</ButtonLink>}
        >
          Your account can keep working on existing orders. Creating or republishing listings requires active seller access.
        </EmptyState>
      </div>
    );
  }

  const [{ data: cars, error }, makes, canPublish, fulfillment] = await Promise.all([
    supabase
      .from("cars")
      .select("id, name, make, model, year")
      .eq("owner_id", user.id)
      .order("created_at"),
    getVehicleMakes(createAdminClient()),
    // Fail open for the UI gate only: a payments misconfig must not 500 the
    // sell page (resolvePaymentsMode throws by design). The server action
    // re-checks on publish either way.
    sellerCanPublish(user.id).catch(() => true),
    loadFulfillmentProfile(user.id).catch(() => null),
  ]);
  const drvnShipping = {
    enabled: integratedShippingEnabled(),
    profileReady: fulfillmentProfileReady(fulfillment),
  };

  if (error) reportError("[sell] failed to load cars", error);

  let initialValues: SellFormInitialValues | undefined;

  if (importParam) {
    const admin = createAdminClient();
    const { data: importRow } = await admin
      .from("listing_imports")
      .select("*")
      .eq("id", importParam)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!importRow) redirect("/sell/import");
    if (importRow.status === "consumed" && importRow.listing_id) {
      redirect(`/listings/${importRow.listing_id}/edit`);
    }
    const fromImport = importInitialValues(importRow);
    if (!fromImport) redirect(`/sell/import?resume=${importRow.id}`);
    initialValues = fromImport;
    capture(user.id, {
      event: "listing_import_review_opened",
      props: { adapter: importRow.source_adapter ?? importRow.source_mode },
    });
  }

  // Only honour the pre-fill if this really is the seller's own car.
  const sourceCar = carParam ? cars?.find((c) => c.id === carParam) : undefined;

  if (!initialValues && sourceCar) {
    initialValues = { origin: "garage", carId: sourceCar.id };

    if (modParam) {
      // Unfiltered by status: selling a part is what usually FOLLOWS taking
      // it off, so a removed line is the normal case here, not the exception.
      const { data: mod } = await supabase
        .from("mod_items")
        .select("id, brand, product, raw_text, category, confidence, part_number, car_id")
        .eq("id", modParam)
        .eq("car_id", sourceCar.id)
        .maybeSingle();

      if (mod) {
        const title = [mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "";
        // The build sheet's own category vocabulary isn't the storefront
        // taxonomy (see src/lib/mods/category-map.ts) — translate it rather
        // than handing the raw mod category to a <select> that doesn't have
        // it as an option.
        const { category, subcategory } = mapModCategoryToListing(mod.category);
        initialValues = {
          origin: "garage",
          carId: sourceCar.id,
          title: title.slice(0, 140),
          category,
          subcategory,
          modItemId: mod.id,
          // The mod entry already knows the part number — carry it across so
          // the seller isn't retyping what the build already recorded.
          partNumber: mod.part_number ?? undefined,
          // Listings have no confidence column (see database.types.ts) — this
          // rides along only to tell the seller the category is a guess, it
          // is never persisted.
          modConfidence: mod.confidence,
        };
      }
    }

    // Automate before asking (brief §G): a part released off a known car starts
    // with its fitment inferred — one editable row, not a form to fill.
    if (sourceCar.make && sourceCar.model) {
      initialValues.fitment = [
        {
          make: sourceCar.make,
          model: sourceCar.model,
          year_start: sourceCar.year ?? null,
          year_end: sourceCar.year ?? null,
        },
      ];
    }
  }

  const isImportReview = initialValues?.origin === "import";

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 pb-10">
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">
          {isImportReview
            ? `Imported from ${initialValues?.importReview?.sourceLabel} — not public yet`
            : initialValues?.modItemId
              ? `Listing a part off your ${sourceCar?.name}`
              : "New listing — draft, not public yet"}
        </span>
        <h1>
          {isImportReview ? (
            <>
              Check your <span className="live-word">listing.</span>
            </>
          ) : (
            <>
              List a <span className="live-word">part.</span>
            </>
          )}
        </h1>
        <p className="sub">
          {isImportReview
            ? "We organized your existing post into a DRVN listing. Look it over — you publish, we never do."
            : "Takes a few minutes. Link it to a car in your garage so buyers can see the build it came off — it's the difference between a listing and a shrug."}
        </p>
        {!isImportReview && (
          <p className="sub">
            Already posted this somewhere else?{" "}
            <Link href="/sell/import" className="jumplink">
              Import an existing listing →
            </Link>
          </p>
        )}
      </Rv>

      <SellForm
        cars={cars ?? []}
        makes={makes.map((m) => m.name)}
        userId={user.id}
        initialValues={initialValues}
        canPublish={canPublish}
        drvnShipping={drvnShipping}
      />

      <div className="mt-8">
        <Link href="/listings" className="jumplink inline-flex">
          Manage all your listings
        </Link>
      </div>

      <Foot
        left="DRVN — drafts stay private until you publish"
        right={<Link href="/marketplace">← Back to the marketplace</Link>}
      />
    </div>
  );
}

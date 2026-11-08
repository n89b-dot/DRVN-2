import { agentStepOpen } from "@/lib/agent/beta";
import { loadAgentMode } from "@/lib/agent/member-mode";
import { agentModeAllowsMandates, agentModeRefusal } from "@/lib/agent/mode";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, Foot, PageHead } from "@/components/ui";
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
import { getPageClient, getViewer } from "@/lib/supabase/page-context";
import { getVehicleMakes } from "@/lib/vehicles/vpic";

import { SellForm, type SellFormInitialValues } from "./sell-form";
import { SellerAccessNotice } from "./seller-access-notice";
import { reportError } from "@/lib/monitoring";
import { orderCars } from "@/lib/cars/order";
import type { TurnCard } from "@/lib/ai/run";
import { publishChatPhotos } from "@/lib/agent/chat-photos";
import { isOwnedStorageUrl } from "@/lib/media-url";

/** AG-7: why "Let DRVN handle offers" can't be turned on, when it can't. */
async function sellerAgentRefusal(userId: string): Promise<string | null> {
  if (!(await agentStepOpen("seller"))) return null;
  const mode = await loadAgentMode(userId);
  return agentModeAllowsMandates(mode) ? null : agentModeRefusal(mode);
}

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
    brand: extraction.brand,
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
  // `agent` is a "Listing from photos" draft from the member's agent chat (A3d).
  searchParams: Promise<{ car?: string; mod?: string; import?: string; agent?: string }>;
}) {
  const { car: carParam, mod: modParam, import: importParam, agent: agentParam } = await searchParams;

  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  // One parallel round. The access check, the form's data, the import under
  // review and the pre-fill mod line used to load in up to six steps.
  const [
    betaAccess,
    { data: cars, error },
    makes,
    canPublish,
    fulfillment,
    { data: sellerProfile },
    { data: offerFloorPct },
    { data: importRow },
    { data: prefillMod },
  ] = await Promise.all([
    getBetaAccess(user.id, "seller"),
    supabase
      .from("cars")
      .select("id, name, make, model, year, created_at")
      .eq("owner_id", user.id),
    getVehicleMakes(createAdminClient()),
    // Fail open for the UI gate only: a payments misconfig must not 500 the
    // sell page (resolvePaymentsMode throws by design). The server action
    // re-checks on publish either way.
    sellerCanPublish(user.id).catch(() => true),
    loadFulfillmentProfile(user.id).catch(() => null),
    // P-5: main car first, so the picker's default is the car the seller
    // actually means rather than whichever they added first.
    supabase.from("profiles").select("main_car_id").eq("id", user.id).maybeSingle(),
    // P-9: no client select grant on the floor; see `my_default_offer_floor`.
    supabase.rpc("my_default_offer_floor"),
    importParam
      ? createAdminClient()
          .from("listing_imports")
          .select("*")
          .eq("id", importParam)
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Fetched against the requested car now; only used below once that car
    // is confirmed to be this seller's own.
    //
    // Unfiltered by status: selling a part is what usually FOLLOWS taking
    // it off, so a removed line is the normal case here, not the exception.
    //
    // L-4: `image_url` is deliberately NOT selected. A link-added mod
    // carries the shop's own product photo, and that photo must never
    // become a listing photo — it shows a new part in a studio, not the
    // used one in this seller's garage, and it isn't theirs to republish.
    // The seller photographs what they are actually selling. Not selecting
    // the column is the guard: there is nothing here to pass along by
    // accident, and `sell-form-prefill.test.ts` holds that line.
    carParam && modParam
      ? supabase
          .from("mod_items")
          .select("id, brand, product, raw_text, category, confidence, part_number, car_id, linked_listing_id")
          .eq("id", modParam)
          .eq("car_id", carParam)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!betaAccess.eligible) return <SellerAccessNotice unavailable={betaAccess.unavailable} />;

  const drvnShipping = {
    enabled: integratedShippingEnabled(),
    profileReady: fulfillmentProfileReady(fulfillment),
  };

  if (error) reportError("[sell] failed to load cars", error);

  let initialValues: SellFormInitialValues | undefined;

  if (importParam) {
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
  const orderedCars = orderCars(cars ?? [], sellerProfile?.main_car_id);
  const sourceCar = carParam ? orderedCars.find((c) => c.id === carParam) : undefined;

  if (!initialValues && sourceCar) {
    initialValues = { origin: "garage", carId: sourceCar.id };

    if (modParam) {
      const mod = prefillMod;

      // A-1: a line that already has a listing — a draft counts — opens that
      // listing. Starting a second one here would re-point the line at the
      // new listing and orphan the first, with its photos and its offers.
      if (mod?.linked_listing_id) redirect(`/listings/${mod.linked_listing_id}/edit`);

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
          // M-6: the sheet already knows who made it.
          brand: mod.brand?.trim().slice(0, 80) || undefined,
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

  // A3d "Listing from photos": the draft is read from the member's own chat
  // (so only their agent's cards open here), and only what it holds is
  // filled in: a title, brand, part number, a category and the photos (their
  // own uploads, checked again). Price and condition stay the member's.
  let fromAgent = false;
  if (!initialValues && agentParam && /^[0-9a-f-]{36}$/i.test(agentParam)) {
    const { data: messages } = await supabase
      .from("agent_messages")
      .select("cards")
      .eq("owner_id", user.id)
      .contains("cards", JSON.stringify([{ id: agentParam }]))
      .limit(1);
    const card = ((messages?.[0]?.cards ?? []) as TurnCard[]).find(
      (c): c is Extract<TurnCard, { kind: "listing_draft" }> => c.kind === "listing_draft" && c.id === agentParam,
    );
    if (card) {
      const { category, subcategory } = mapModCategoryToListing(card.category);
      initialValues = {
        origin: "garage",
        title: card.title.slice(0, 140),
        brand: card.brand ?? undefined,
        partNumber: card.part_number ?? undefined,
        category,
        subcategory,
        // R81: the chat's photos are private; the listing gets its own public
        // copies, made now, in the member's listing-images folder.
        images: (await publishChatPhotos(createAdminClient(), user.id, card.images, "listing-images"))
          .filter((url) => isOwnedStorageUrl(url, user.id))
          .map((url) => ({ url, alt: null })),
      };
      fromAgent = true;
    }
  }

  const isImportReview = initialValues?.origin === "import";

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 pb-10">
      <PageHead
        className="pagehead--task"
        eyebrow={
          isImportReview
            ? `Imported from ${initialValues?.importReview?.sourceLabel} — not public yet`
            : initialValues?.modItemId
              ? `Listing a part off your ${sourceCar?.name}`
              : fromAgent
                ? "From your photos — add the price and condition; nothing is public until you publish"
                : "New listing — draft, not public yet"
        }
        title={
          isImportReview ? (
            <>
              Check your <span className="live-word">listing.</span>
            </>
          ) : (
            <>
              List a <span className="live-word">part.</span>
            </>
          )
        }
        sub={
          isImportReview
            ? "We organized your existing post into a DRVN listing. Look it over — you publish, we never do."
            : "Link it to a car in your garage and buyers see the build it came off."
        }
      />

      {/* An alternative start, not body copy: it sat in the head as a second
          paragraph before a single field. */}
      {!isImportReview && (
        <Alert ico="↗" title="Already posted it somewhere else?" className="mb-6">
          Paste the link or the post and we&apos;ll do the formatting.{" "}
          <Link href="/sell/import" className="jumplink">
            Import an existing listing →
          </Link>
        </Alert>
      )}

      <SellForm
        agentBeta={await agentStepOpen("seller")}
        agentRefusal={await sellerAgentRefusal(user.id)}
        defaultOfferFloorPct={offerFloorPct ?? null}
        cars={orderedCars}
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

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  fulfillmentProfileReady,
  loadFulfillmentProfile,
} from "@/features/commerce/fulfillment";
import { checklistFor, sanitizeChecklist } from "@/lib/marketplace/grading";
import { integratedShippingEnabled } from "@/lib/shipping/provider";
import { getCategory } from "@/lib/marketplace/taxonomy";
import { sellerCanPublish } from "@/lib/payments/connect";
import { deleteMediaIfUnreferenced, finalizeMediaUrls } from "@/lib/media-lifecycle";
import { keepValidGalleryImages } from "@/lib/media-url";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { capture } from "@/lib/analytics";
import { consumeListingImport } from "@/lib/listing-import/consume";
import type { ListingStatus } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";
import { betaCommerceError, getBetaAccess } from "@/lib/beta-access";

export type SellState = { error?: string; ok?: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/** Shared field parsing for create and update. */
async function readListingFields(formData: FormData, userId: string) {
  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "");
  const priceRaw = String(formData.get("price") ?? "").trim();
  const price = Math.round(Number(priceRaw) * 100);
  const shippingRaw = String(formData.get("shipping") ?? "").trim();
  const shipping = shippingRaw ? Math.round(Number(shippingRaw) * 100) : 0;
  const floorRaw = String(formData.get("offer_floor") ?? "").trim();
  const floor = floorRaw ? Math.round(Number(floorRaw) * 100) : null;

  if (!title) return { error: "Title is required." };
  if (title.length > 140) return { error: "Keep the title under 140 characters." };
  if (!getCategory(category)) return { error: "Pick a category." };
  if (!priceRaw || !Number.isFinite(price) || price < 0) return { error: "Enter a valid price." };
  if (price > 100_000_000) return { error: "That price is above the maximum we handle." };
  if (!Number.isFinite(shipping) || shipping < 0) return { error: "Enter a valid shipping cost." };
  if (floor !== null && (!Number.isFinite(floor) || floor <= 0 || floor > price)) {
    return { error: "The offer floor must be above zero and no more than your asking price." };
  }

  const description = String(formData.get("description") ?? "").trim();
  if (description.length > 8000) return { error: "Keep the description under 8000 characters." };

  const compatibility = String(formData.get("compatibility_notes") ?? "").trim();
  if (compatibility.length > 2000) {
    return { error: "Keep the compatibility notes under 2000 characters." };
  }

  const partNumber = String(formData.get("part_number") ?? "").trim();
  if (partNumber.length > 120) return { error: "Keep the part number under 120 characters." };

  // A source car is a provenance claim, so it must be a car this seller owns.
  // Without this check any seller could attach someone else's well-known build.
  const sourceCarId = String(formData.get("source_car_id") ?? "") || null;
  if (sourceCarId) {
    const supabase = await createClient();
    const { data: car } = await supabase
      .from("cars")
      .select("id, owner_id")
      .eq("id", sourceCarId)
      .maybeSingle();
    if (!car || car.owner_id !== userId) {
      return { error: "You can only list parts from a car in your own garage." };
    }
  }

  const subcategory = String(formData.get("subcategory") ?? "") || null;
  const condition = String(formData.get("condition") ?? "used") as
    | "new"
    | "like_new"
    | "used"
    | "for_parts";

  // Grade + checklist (0024): the checklist arrives as one radio group per
  // question (chk_<key>); collect and validate against the catalog for this
  // category. New parts carry neither.
  const gradeRaw = String(formData.get("grade") ?? "");
  const grade =
    condition !== "new" && ["a", "b", "c"].includes(gradeRaw)
      ? (gradeRaw as "a" | "b" | "c")
      : null;

  // Seller-accuracy attestation: a graded used part is a specific condition
  // claim buyers rely on, so publishing one requires an explicit "this is
  // accurate" confirmation — not just a client-side nudge.
  if (grade && formData.get("attest_accurate") !== "on") {
    return { error: "Confirm the condition disclosure is accurate before saving a graded part." };
  }

  const rawAnswers: Record<string, unknown> = {};
  for (const q of checklistFor(category, subcategory)) {
    const answer = formData.get(`chk_${q.key}`);
    if (typeof answer === "string" && answer) rawAnswers[q.key] = answer;
  }
  const checklist =
    condition !== "new" ? sanitizeChecklist(category, subcategory, rawAnswers) : null;

  // Shipping mode (0053). 'drvn' needs a complete positive parcel and — since
  // rating starts from the seller's ship-from — a saved fulfillment profile.
  // 'pickup_only' zeroes shipping and requires the collection flag.
  const allowsCollection = formData.get("allows_collection") === "on";
  const modeRaw = String(formData.get("shipping_mode") ?? "flat");
  const shippingMode = (
    ["flat", "drvn", "pickup_only"].includes(modeRaw) ? modeRaw : "flat"
  ) as "flat" | "drvn" | "pickup_only";

  const parcelField = (name: string): number | null => {
    const raw = String(formData.get(name) ?? "").trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  };
  const weightOz = parcelField("weight_oz");
  const lengthIn = parcelField("length_in");
  const widthIn = parcelField("width_in");
  const heightIn = parcelField("height_in");

  if (shippingMode === "drvn") {
    if (!integratedShippingEnabled()) {
      return { error: "DRVN Shipping isn't available yet — use a flat shipping price for now." };
    }
    if (!weightOz || !lengthIn || !widthIn || !heightIn) {
      return { error: "DRVN Shipping needs the packed weight and all three box dimensions." };
    }
    if (weightOz > 1_120 || lengthIn > 108 || widthIn > 108 || heightIn > 108) {
      return {
        error:
          "That parcel is beyond what DRVN Shipping handles (70 lb / 108 in) — use seller-arranged shipping or local pickup.",
      };
    }
    const profile = await loadFulfillmentProfile(userId);
    if (!fulfillmentProfileReady(profile)) {
      return {
        error:
          "DRVN Shipping needs your verified ship-from address first — add it in Settings → Shipping.",
      };
    }
  }
  if (shippingMode === "pickup_only" && !allowsCollection) {
    return { error: "Pickup-only listings need the local pickup option ticked." };
  }

  return {
    fitments: readFitments(formData),
    altNumbers: readAltPartNumbers(formData),
    fields: {
      title,
      description: description || null,
      category,
      subcategory,
      condition,
      grade,
      condition_checklist: checklist,
      price_cents: price,
      shipping_cents: shippingMode === "pickup_only" ? 0 : shipping,
      shipping_mode: shippingMode,
      weight_oz: shippingMode === "drvn" ? weightOz : null,
      length_in: shippingMode === "drvn" ? lengthIn : null,
      width_in: shippingMode === "drvn" ? widthIn : null,
      height_in: shippingMode === "drvn" ? heightIn : null,
      offer_floor_cents: floor,
      allows_collection: shippingMode === "pickup_only" ? true : allowsCollection,
      location: String(formData.get("location") ?? "").trim() || null,
      compatibility_notes: compatibility || null,
      part_number: partNumber || null,
      source_car_id: sourceCarId,
    },
  };
}

export async function createListing(_prev: SellState, formData: FormData): Promise<SellState> {
  const { supabase, user } = await requireUser();

  const betaAccess = await getBetaAccess(user.id, "seller");
  if (!betaAccess.eligible) return { error: betaCommerceError("seller") };

  if (!(await allowAction(RATE_LIMITS.createListing, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.createListing) };
  }

  const parsed = await readListingFields(formData, user.id);
  if ("error" in parsed) return { error: parsed.error };

  // The page promises "nothing reaches the market until you publish it", so
  // honour it: saving a draft is a real, separate outcome.
  const asDraft = formData.get("save_draft") !== null;

  if (!asDraft && !(await sellerCanPublish(user.id))) {
    return {
      error:
        "Publishing needs payouts set up first (Settings → Payments), so a sale has somewhere to send your money. You can still save this as a draft.",
    };
  }

  const { data: listing, error } = await supabase
    .from("listings")
    .insert({
      seller_id: user.id,
      ...parsed.fields,
      status: asDraft ? "draft" : "active",
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Array order is the gallery order: index 0 is the cover, everything else
  // is `position` — reorder and "set as cover" are both just moves within
  // this list on the client, resolved here on save.
  const images = keepValidGalleryImages(safeParseJson(formData.get("image_urls")), 12, user.id);
  let imagesFailed = false;
  if (images.length) {
    const { error: imageError } = await supabase.from("listing_images").insert(
      images.map((img, index) => ({
        listing_id: listing.id,
        url: img.url,
        alt: img.alt,
        position: index,
      }))
    );
    if (imageError) {
      reportError("[sell] listing images failed", { listingId: listing.id, imageError });
      imagesFailed = true;
    } else {
      // The URLs are referenced now — release them from the staged-upload GC.
      await finalizeMediaUrls(supabase, images.map((img) => img.url));
    }
  }

  const { error: fitmentError } = await saveFitments(supabase, listing.id, parsed.fitments);
  await saveAltPartNumbers(supabase, listing.id, parsed.altNumbers);

  // Close the loop from the build sheet: if this part came off a specific mod
  // line, link them so the car page can show it as listed.
  const modItemId = String(formData.get("mod_item_id") ?? "");
  if (modItemId && parsed.fields.source_car_id) {
    await supabase
      .from("mod_items")
      .update({ linked_listing_id: listing.id })
      .eq("id", modItemId)
      .eq("car_id", parsed.fields.source_car_id);
  }

  // An imported listing is done once it becomes a real listing — mark the
  // import consumed and record which fields the seller edited (names only).
  const importId = String(formData.get("import_id") ?? "");
  if (importId) {
    await consumeListingImport({
      userId: user.id,
      importId,
      listingId: listing.id,
      published: !asDraft,
      submitted: {
        title: parsed.fields.title,
        description: parsed.fields.description,
        category: parsed.fields.category,
        subcategory: parsed.fields.subcategory,
        condition: parsed.fields.condition,
        price_cents: parsed.fields.price_cents,
        shipping_cents: parsed.fields.shipping_cents,
        part_number: parsed.fields.part_number,
        location: parsed.fields.location,
      },
    });
  }

  capture(user.id, asDraft
    ? { event: "listing_started" }
    : {
        event: "listing_published",
        props: {
          category: parsed.fields.category,
          has_source_car: Boolean(parsed.fields.source_car_id),
          fitment_rows: parsed.fitments.length,
        },
      });

  // Search follows the listing (§B1) — fire-and-forget, no-op without an engine.

  revalidatePath("/marketplace");
  revalidatePath("/sell");
  if (parsed.fields.source_car_id) revalidatePath(`/garage/${parsed.fields.source_car_id}/edit`);

  // Photos failing to save must not look like a clean success — the listing
  // exists either way, so keep it and send the seller to fix the gallery
  // rather than redirecting them past a silent data loss.
  if (imagesFailed) {
    return {
      error:
        "Listing created, but the photos couldn't be saved. Open it from My Listings and re-add them from Edit.",
    };
  }
  if (fitmentError) {
    return { error: `Listing created, but: ${fitmentError}` };
  }

  if (asDraft) redirect(`/listings/${listing.id}/edit?saved=draft`);
  redirect(`/listings/${listing.id}`);
}

/**
 * Edits a published listing. Previously impossible — title, price, photos and
 * copy were immutable after posting, so a mistyped price could only be fixed by
 * marking the part sold and re-listing from scratch.
 */
export async function updateListing(_prev: SellState, formData: FormData): Promise<SellState> {
  const { supabase, user } = await requireUser();

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing listing." };

  const { data: existing } = await supabase
    .from("listings")
    .select("id, seller_id, status, price_cents")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.seller_id !== user.id) return { error: "Listing not found." };
  if (["sold", "reserved"].includes(existing.status)) {
    return { error: "A sold or reserved part can't be edited." };
  }

  const parsed = await readListingFields(formData, user.id);
  if ("error" in parsed) return { error: parsed.error };

  const { error } = await supabase.from("listings").update(parsed.fields).eq("id", id);
  if (error) return { error: error.message };

  // Replace the gallery only when the form actually submitted one. Array
  // order carries reorder + cover choices (index 0 is the cover) and alt
  // text set in the editor, so a plain delete-and-reinsert on `position`
  // is enough — no separate reorder/cover/alt actions needed.
  const imagesField = formData.get("image_urls");
  if (typeof imagesField === "string" && imagesField) {
    const images = keepValidGalleryImages(safeParseJson(imagesField), 12, user.id);

    // Read the current gallery before touching anything, so a failed insert
    // below can be undone rather than leaving the listing with no photos
    // while still reporting success.
    const { data: previousImages } = await supabase
      .from("listing_images")
      .select("url, alt, position")
      .eq("listing_id", id)
      .order("position");

    await supabase.from("listing_images").delete().eq("listing_id", id);

    if (images.length) {
      const { error: imageError } = await supabase.from("listing_images").insert(
        images.map((img, index) => ({
          listing_id: id,
          url: img.url,
          alt: img.alt,
          position: index,
        }))
      );

      if (imageError) {
        if (previousImages?.length) {
          await supabase.from("listing_images").insert(
            previousImages.map((img) => ({
              listing_id: id,
              url: img.url,
              alt: img.alt,
              position: img.position,
            }))
          );
        }
        return { error: "Photos couldn't be saved — try again." };
      }
    }

    await finalizeMediaUrls(supabase, images.map((img) => img.url));

    // Photos dropped by this edit may have lost their last reference — GC
    // their storage objects. The helper re-checks every referencing table
    // (covers, other listings, activity posts) before touching storage, and
    // never fails the save.
    const kept = new Set(images.map((img) => img.url));
    for (const prev of previousImages ?? []) {
      if (!kept.has(prev.url)) await deleteMediaIfUnreferenced(prev.url);
    }
  }

  const { error: fitmentError } = await saveFitments(supabase, id, parsed.fitments);
  await saveAltPartNumbers(supabase, id, parsed.altNumbers);


  revalidatePath(`/listings/${id}`);
  revalidatePath(`/listings/${id}/edit`);
  revalidatePath("/marketplace");
  revalidatePath("/sell");
  if (fitmentError) return { error: `Listing updated, but: ${fitmentError}` };
  return { ok: "Listing updated." };
}

const SETTABLE_STATUSES: ListingStatus[] = ["draft", "active", "paused", "sold", "archived"];

/**
 * Typed outcome for the status/delete/unlink actions (Rev E item 8). These
 * used to return void with bare-return guards, so a blocked Publish — the
 * primary seller conversion step — did nothing with nothing said. Now every
 * refusal says why, and the onboarding gate carries a flag the UI turns into
 * a link to Settings → Payments.
 */
export type ListingActionState = {
  error?: string;
  ok?: string;
  /** The refusal is the payout-onboarding gate — link the seller there. */
  needsOnboarding?: boolean;
} | null;

export async function setListingStatus(
  _prev: ListingActionState,
  formData: FormData
): Promise<ListingActionState> {
  const { supabase, user } = await requireUser();

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as ListingStatus;
  if (!id || !SETTABLE_STATUSES.includes(status)) return { error: "Missing listing or status." };
  if (status === "active") {
    const betaAccess = await getBetaAccess(user.id, "seller");
    if (!betaAccess.eligible) return { error: betaCommerceError("seller") };
  }

  const { data: existing } = await supabase
    .from("listings")
    .select("id, status")
    .eq("id", id)
    .eq("seller_id", user.id)
    .maybeSingle();
  if (!existing) return { error: "Listing not found." };

  // A part that has actually sold must not be flipped back on sale — that used
  // to be possible and would re-sell something already paid for.
  if (existing.status === "sold" && status === "active") {
    const { data: paidItem } = await supabase
      .from("order_items")
      .select("order_id, orders!inner(status)")
      .eq("listing_id", id)
      .in("orders.status", ["paid", "shipped", "delivered", "completed"])
      .limit(1)
      .maybeSingle();
    if (paidItem) {
      return { error: "This part actually sold — create a new listing to sell another." };
    }
  }
  if (existing.status === "reserved") {
    return { error: "A checkout is holding this listing — it frees itself in a few minutes." };
  }
  if (existing.status === "removed") {
    return { error: "This listing was removed by moderation — check your notifications." };
  }

  // Same gate as createListing: going live requires a payable seller.
  if (status === "active" && !(await sellerCanPublish(user.id))) {
    return {
      error: "Publishing needs payouts set up first, so a sale has somewhere to send your money.",
      needsOnboarding: true,
    };
  }

  const { error } = await supabase
    .from("listings")
    .update({ status })
    .eq("id", id)
    .eq("seller_id", user.id);
  if (error) return { error: error.message };


  revalidatePath("/sell");
  revalidatePath("/listings");
  revalidatePath(`/listings/${id}`);
  revalidatePath("/marketplace");
  return {
    ok:
      status === "active"
        ? "Live — it's on the market."
        : status === "paused"
          ? "Paused and hidden from the market."
          : `Moved to ${status}.`,
  };
}

export async function deleteListing(
  _prev: ListingActionState,
  formData: FormData
): Promise<ListingActionState> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing listing." };

  // Order history references listings; 0007 made that FK ON DELETE SET NULL with
  // a title snapshot, so removing a sold listing no longer breaks receipts.
  const { error } = await supabase.from("listings").delete().eq("id", id).eq("seller_id", user.id);
  if (error) {
    // The 0012 delete guard refuses reserved/sold rows with a 42501.
    return {
      error: error.code === "42501"
        ? "A reserved or sold listing can't be deleted — the order history points at it."
        : error.message,
    };
  }


  revalidatePath("/sell");
  revalidatePath("/marketplace");
  revalidatePath("/listings");
  // The seller ledger is where "Listing deleted" actually renders — the old
  // /sell?deleted=1 landing had no handler for the param.
  redirect("/listings?deleted=1");
}

/**
 * Undoes the "release a part" link between a build line and the listing it
 * spawned. The car sheet was showing "For sale" against a line forever, with
 * no way back — a listing pulled down or repurposed left a stale link behind.
 * Ownership is enforced by RLS (the car update below only affects rows this
 * user owns), and checked here too for a clean error rather than a silent
 * no-op.
 */
export async function unlinkModListing(formData: FormData): Promise<ListingActionState> {
  const { supabase, user } = await requireUser();

  const modItemId = String(formData.get("mod_item_id") ?? "");
  const carId = String(formData.get("car_id") ?? "");
  if (!modItemId || !carId) return { error: "Missing build line." };

  const { data: car } = await supabase
    .from("cars")
    .select("id, slug, owner_id")
    .eq("id", carId)
    .maybeSingle();
  if (!car || car.owner_id !== user.id) return { error: "That car isn't in your garage." };

  const { data: mod } = await supabase
    .from("mod_items")
    .select("linked_listing_id")
    .eq("id", modItemId)
    .eq("car_id", carId)
    .maybeSingle();

  const { error } = await supabase
    .from("mod_items")
    .update({ linked_listing_id: null })
    .eq("id", modItemId)
    .eq("car_id", carId);
  if (error) return { error: error.message };

  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath(`/cars/${car.slug}`);
  if (mod?.linked_listing_id) revalidatePath(`/listings/${mod.linked_listing_id}`);
  return { ok: "Link removed." };
}

type FitmentInput = { make: string; model: string; year_start: number | null; year_end: number | null };

/**
 * Parses the fitment picker's hidden JSON field (0025) into clean rows.
 * Same tolerance stance as the checklist: malformed rows are dropped, never
 * fatal — the structured claims are additive to the freeform notes.
 */
function readFitments(formData: FormData): FitmentInput[] {
  const parsed = safeParseJson(formData.get("fitments"));
  if (!Array.isArray(parsed)) return [];
  const saneYear = (y: unknown): number | null =>
    typeof y === "number" && Number.isInteger(y) && y >= 1930 && y <= 2035 ? y : null;
  const rows: FitmentInput[] = [];
  const seen = new Set<string>();
  for (const row of parsed.slice(0, 10)) {
    if (!row || typeof row !== "object") continue;
    const make = String((row as Record<string, unknown>).make ?? "").trim().slice(0, 60);
    const model = String((row as Record<string, unknown>).model ?? "").trim().slice(0, 80);
    if (!make || !model) continue;
    let start = saneYear((row as Record<string, unknown>).year_start);
    let end = saneYear((row as Record<string, unknown>).year_end);
    if (start !== null && end !== null && end < start) [start, end] = [end, start];
    const key = `${make.toLowerCase()}|${model.toLowerCase()}|${start ?? ""}|${end ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ make, model, year_start: start, year_end: end });
  }
  return rows;
}

/**
 * Mirrors the picker's rows to listing_fitments — delete-and-reinsert, the
 * same shape the gallery uses. RLS ("sellers manage fitment") scopes both
 * statements to listings this user owns.
 */
async function saveFitments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listingId: string,
  fitments: FitmentInput[]
): Promise<{ error?: string }> {
  await supabase.from("listing_fitments").delete().eq("listing_id", listingId);
  if (!fitments.length) return {};
  const { error } = await supabase
    .from("listing_fitments")
    .insert(fitments.map((f) => ({ listing_id: listingId, ...f })));
  if (error) {
    reportError("[sell] fitment rows failed", { listingId, error });
    return { error: "Fitment rows couldn't be saved — re-add them from Edit." };
  }
  return {};
}

/**
 * Alternate part numbers (0042) — "also known as" identifiers, comma/space
 * separated in one optional field. Bounded (5 numbers, 2–64 chars each),
 * deduped on the compact form the search lane matches.
 */
function readAltPartNumbers(formData: FormData): string[] {
  const raw = String(formData.get("alt_part_numbers") ?? "").trim();
  if (!raw) return [];
  const seen = new Set<string>();
  const numbers: string[] = [];
  for (const piece of raw.split(/[,\n;]+/)) {
    const number = piece.trim().slice(0, 64);
    if (number.length < 2) continue;
    const compact = number.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!compact || seen.has(compact)) continue;
    seen.add(compact);
    numbers.push(number);
    if (numbers.length >= 5) break;
  }
  return numbers;
}

/** Delete-and-reinsert like saveFitments; RLS scopes both to the seller. */
async function saveAltPartNumbers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listingId: string,
  numbers: string[]
): Promise<void> {
  await supabase.from("listing_part_numbers").delete().eq("listing_id", listingId);
  if (!numbers.length) return;
  const { error } = await supabase
    .from("listing_part_numbers")
    .insert(numbers.map((number) => ({ listing_id: listingId, number })));
  if (error) reportError("[sell] alt part numbers failed", { listingId, error });
}

function safeParseJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || !value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

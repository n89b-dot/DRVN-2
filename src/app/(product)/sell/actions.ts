"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";

import {
  fulfillmentProfileReady,
  loadFulfillmentProfile,
} from "@/features/commerce/fulfillment";
import { checklistFor, sanitizeChecklist } from "@/lib/marketplace/grading";
import { integratedShippingEnabled } from "@/lib/shipping/provider";
import { getCategory, isValidListingCategory } from "@/lib/marketplace/taxonomy";
import { sellerCanPublish } from "@/lib/payments/connect";
import { deleteMediaIfUnreferenced, finalizeMediaUrls } from "@/lib/media-lifecycle";
import { keepValidGalleryImages } from "@/lib/media-url";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { capture } from "@/lib/analytics";
import { consumeListingImport } from "@/lib/listing-import/consume";
import type { ListingStatus } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";
import {
  CHARGE_OUT_OF_BOUNDS_CODE,
  LISTING_PRICE_OUT_OF_BOUNDS_MESSAGE,
  MAX_CHARGE_CENTS,
  MIN_CHARGE_CENTS,
  chargeWithinBounds,
} from "@/lib/payments/charge-bounds";
import { betaCommerceError, getBetaAccess } from "@/lib/beta-access";
import { saveListingAgent } from "@/features/agent/actions";

export type SellState = {
  error?: string;
  ok?: string;
  /** After an edit saves: the listing's new version, so the next save from
   *  the same form isn't refused as stale (RR-05). */
  version?: string;
  /** How an edit ended (R2-01). `unknown` means the save may have committed
   *  and its answer was lost — the form keeps the draft and its request id,
   *  and checks rather than claiming nothing changed. */
  outcome?: ListingEditOutcome;
};

export type ListingEditOutcome = "saved" | "conflict" | "rejected" | "unknown";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/**
 * "Let DRVN handle offers" (A3a). Present only when the form drew the block
 * (the agent beta is on). The agent's minimum is the listing's own minimum —
 * one number, written to the private floor and the mandate alike.
 */
type ListingAgentInput = { on: boolean; targetCents: number | null; style: "firm" | "balanced" | "flexible"; acknowledgeBinding: boolean };

function readListingAgent(formData: FormData, floor: number | null, price: number): ListingAgentInput | { error: string } | null {
  if (formData.get("agent_present") !== "1") return null;
  const on = formData.get("agent_on") === "on";
  const targetRaw = String(formData.get("agent_target") ?? "").trim();
  const targetCents = targetRaw ? Math.round(Number(targetRaw) * 100) : null;
  const styleRaw = String(formData.get("agent_style") ?? "balanced");
  const style = styleRaw === "firm" || styleRaw === "flexible" ? styleRaw : "balanced";
  const acknowledgeBinding = formData.get("agent_ack") === "on";
  if (!on) return { on, targetCents: null, style, acknowledgeBinding };
  if (floor === null) return { error: "Set a minimum: your agent never goes below it." };
  if (targetCents !== null && (!Number.isFinite(targetCents) || targetCents < floor || targetCents > price)) {
    return { error: "Set the target between your minimum and your asking price." };
  }
  if (!acknowledgeBinding) return { error: "Confirm that your agent's counters are binding offers to sell." };
  return { on, targetCents, style, acknowledgeBinding };
}

async function applyListingAgent(listingId: string, agent: ListingAgentInput | null, floor: number | null) {
  if (!agent) return null;
  const result = await saveListingAgent({ listingId, on: agent.on, minimumCents: floor, targetCents: agent.targetCents, style: agent.style, acknowledgeBinding: agent.acknowledgeBinding });
  if (result.error) reportError("[sell] listing agent not saved", { listingId, error: result.error });
  return result.error ? { error: result.error, stillPaused: Boolean(result.stillPaused) } : null;
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
  // Drafts may hold any price up to the ceiling; publishing needs at least
  // MIN_CHARGE_CENTS (checked by the callers, which know whether this is a
  // draft — and by the database for every write).
  if (price > MAX_CHARGE_CENTS) return { error: LISTING_PRICE_OUT_OF_BOUNDS_MESSAGE };
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

  // M-6: who made the part. Free text rather than an enum — the brand list
  // grows every time somebody lists a part nobody has listed before.
  const brand = String(formData.get("brand") ?? "").trim();
  if (brand.length > 120) return { error: "Keep the brand under 120 characters." };

  // M-7: how far this part has been driven. Optional, and refused on a new
  // part, where it would be a contradiction rather than a detail.
  const milesRaw = String(formData.get("part_miles") ?? "").trim();
  const milesUnit = String(formData.get("part_miles_unit") ?? "mi").trim();
  let partMiles: number | null = null;
  if (milesRaw) {
    const value = Number(milesRaw);
    if (!Number.isInteger(value) || value < 0 || value > 2_000_000) {
      return { error: "Miles on the part must be a whole number under 2,000,000." };
    }
    if (milesUnit !== "mi" && milesUnit !== "km") return { error: "Choose miles or kilometres." };
    partMiles = value;
  }

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
  if (!isValidListingCategory(category, subcategory)) return { error: "Choose a part type from the selected category, or leave it unknown." };
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
      // Showing it is the seller's choice, and only means something with a minimum (O-3).
      show_offer_floor: floor !== null && formData.get("show_offer_floor") === "on",
      allows_collection: shippingMode === "pickup_only" ? true : allowsCollection,
      location: String(formData.get("location") ?? "").trim() || null,
      compatibility_notes: compatibility || null,
      part_number: partNumber || null,
      brand: brand || null,
      part_miles: partMiles,
      part_miles_unit: partMiles === null ? null : (milesUnit as "mi" | "km"),
      source_car_id: sourceCarId,
    },
  };
}

const PHOTO_REQUIRED =
  "Add at least one photo before publishing — a listing goes public with its picture. Drafts can save without one.";

export async function createListing(_prev: SellState, formData: FormData): Promise<SellState> {
  const { supabase, user } = await requireUser();

  const betaAccess = await getBetaAccess(user.id, "seller");
  if (!betaAccess.eligible) return { error: betaCommerceError("seller") };

  const parsed = await readListingFields(formData, user.id);
  if ("error" in parsed) return { error: parsed.error };
  const agent = readListingAgent(formData, parsed.fields.offer_floor_cents, parsed.fields.price_cents);
  if (agent && "error" in agent) return { error: agent.error };

  // The page promises "nothing reaches the market until you publish it", so
  // honour it: saving a draft is a real, separate outcome.
  const asDraft = formData.get("save_draft") !== null;
  const requestId = String(formData.get("request_id") ?? "");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(requestId)) return { error: "Reload the listing form and try again." };

  if (!asDraft && parsed.fields.price_cents < MIN_CHARGE_CENTS) {
    return { error: LISTING_PRICE_OUT_OF_BOUNDS_MESSAGE };
  }

  const images = keepValidGalleryImages(safeParseJson(formData.get("image_urls")), 12, user.id);
  // M-5/W-2: a public listing leads with its photo, so publishing needs one.
  // Drafts are exempt — they're where the photos get added.
  if (!asDraft && images.length === 0) {
    return { error: PHOTO_REQUIRED };
  }
  const modItemId = String(formData.get("mod_item_id") ?? "");
  const importId = String(formData.get("import_id") ?? "");
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({
      asDraft,
      fields: parsed.fields,
      fitments: parsed.fitments,
      altNumbers: parsed.altNumbers,
      images,
      modItemId,
      importId,
    }))
    .digest("hex");
  const claimed = await supabase.rpc("claim_listing_creation", {
    p_request: requestId,
    p_payload_hash: payloadHash,
  });
  if (claimed.error) {
    return {
      error: claimed.error.code === "22023"
        ? "This save request no longer matches the listing form. Reload and try again."
        : "Couldn't prepare this listing. Try again.",
    };
  }
  const claim = claimed.data as unknown as {
    listing_id?: string;
    completed?: boolean;
    fresh?: boolean;
  } | null;
  if (!claim?.listing_id || !uuid.test(claim.listing_id)) {
    return { error: "Couldn't prepare this listing. Try again." };
  }
  // Completed delivery replays only recover the original destination. Every
  // unfinished attempt is admitted again; a denial releases an unused claim
  // so a second click cannot masquerade as a free recovery.
  if (!claim.completed && !(await allowAction(RATE_LIMITS.createListing, user.id))) {
    const discarded = await supabase.rpc(
      "discard_listing_creation",
      { p_request: requestId, p_payload_hash: payloadHash }
    );
    if (discarded.error || discarded.data !== true) {
      reportError("[sell] rate-limited listing claim wasn't discarded", {
        requestId,
        error: discarded.error,
      });
    }
    return { error: rateLimitMessage(RATE_LIMITS.createListing) };
  }

  if (!claim.completed && !asDraft && !(await sellerCanPublish(user.id))) {
    return {
      error:
        "Publishing needs payouts set up first (Selling → Payouts), so a sale has somewhere to send your money. You can still save this as a draft.",
    };
  }

  if (modItemId && !uuid.test(modItemId)) return { error: "The source build line is invalid." };
  const saved = await supabase.rpc(
    "save_listing_creation",
    {
      p_request: requestId,
      p_payload_hash: payloadHash,
      p_listing: { ...parsed.fields, status: asDraft ? "draft" : "active" },
      p_images: images,
      p_fitments: parsed.fitments,
      p_alt_numbers: parsed.altNumbers,
      p_mod_item: modItemId || undefined,
    }
  );
  if (saved.error) {
    reportError("[sell] atomic listing creation failed", { requestId, error: saved.error });
    return {
      error: saved.error.code === "40001"
        ? "This listing changed while the save was being recovered. Refresh before continuing."
        : saved.error.code === CHARGE_OUT_OF_BOUNDS_CODE
          ? LISTING_PRICE_OUT_OF_BOUNDS_MESSAGE
          : "Couldn't save the complete listing. Your form is still here — try again.",
    };
  }
  const saveResult = saved.data as unknown as {
    listing_id?: string;
    completed?: boolean;
    replayed?: boolean;
  } | null;
  const listingId = saveResult?.listing_id;
  if (!listingId || !uuid.test(listingId) || saveResult?.completed !== true) {
    return { error: "Couldn't confirm the complete listing. Try again." };
  }
  if (images.length) await finalizeMediaUrls(supabase, images.map((img) => img.url));

  // An imported listing is done once it becomes a real listing — mark the
  // import consumed and record which fields the seller edited (names only).
  if (importId) {
    await consumeListingImport({
      userId: user.id,
      importId,
      listingId,
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
        brand: parsed.fields.brand,
        location: parsed.fields.location,
      },
    });
  }

  if (!saveResult.replayed) capture(user.id, asDraft
    ? { event: "listing_started" }
    : {
        event: "listing_published",
        props: {
          category: parsed.fields.category,
          has_source_car: Boolean(parsed.fields.source_car_id),
          fitment_rows: parsed.fitments.length,
        },
      });

  revalidatePath("/marketplace");
  revalidatePath("/sell");
  if (parsed.fields.source_car_id) revalidatePath(`/garage/${parsed.fields.source_car_id}/edit`);

  // The listing is committed; its agent follows. A refusal here doesn't undo
  // the listing — the edit page says so and keeps the block to retry.
  const agentError = asDraft ? null : await applyListingAgent(listingId, agent, parsed.fields.offer_floor_cents);
  if (agentError) redirect(`/listings/${listingId}/edit?agent=failed`);
  if (asDraft) redirect(`/listings/${listingId}/edit?saved=draft`);
  redirect(`/listings/${listingId}`);
}

/**
 * Edits a published listing. Previously impossible — title, price, photos and
 * copy were immutable after posting, so a mistyped price could only be fixed by
 * marking the part sold and re-listing from scratch.
 */
export async function updateListing(_prev: SellState, formData: FormData): Promise<SellState> {
  const { supabase, user } = await requireUser();

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing listing.", outcome: "rejected" };
  // RR-05: the version the form was opened with. The save is refused if the
  // listing changed since — another tab, or a checkout reserving it.
  const expected = String(formData.get("expected_updated_at") ?? "");
  if (!expected || Number.isNaN(Date.parse(expected))) {
    return { error: "This form is out of date. Reload the page, then save again.", outcome: "rejected" };
  }
  // R2-01: the form keeps one request id per edit until its outcome is
  // known, so a retry after a lost answer replays instead of re-editing.
  const requestId = String(formData.get("request_id") ?? "");
  if (!UUID.test(requestId)) {
    return { error: "Reload the listing form and try again.", outcome: "rejected" };
  }

  const parsed = await readListingFields(formData, user.id);
  if ("error" in parsed) return { error: parsed.error, outcome: "rejected" };
  const agent = readListingAgent(formData, parsed.fields.offer_floor_cents, parsed.fields.price_cents);
  if (agent && "error" in agent) return { error: agent.error, outcome: "rejected" };

  // The gallery is replaced only when the form submitted one. Array order
  // carries reorder + cover choices (index 0 is the cover) and alt text.
  const imagesField = formData.get("image_urls");
  const images =
    typeof imagesField === "string" && imagesField
      ? keepValidGalleryImages(safeParseJson(imagesField), 12, user.id)
      : null;

  // Ownership, status (sold/reserved/removed), the live-listing photo rule
  // and the version are all decided inside the transaction — not by a read
  // here that a replay of an already-committed edit would trip over.
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({
      listing: id,
      expected,
      fields: parsed.fields,
      images,
      fitments: parsed.fitments,
      altNumbers: parsed.altNumbers,
    }))
    .digest("hex");

  // One transaction: the listing, its photos, fitment and alternate part
  // numbers all change, or none of them do — and the outcome is recorded
  // against the request in the same commit.
  const saved = await supabase.rpc("save_listing_edit", {
    p_request: requestId,
    p_payload_hash: payloadHash,
    p_listing: id,
    p_expected_updated_at: expected,
    p_fields: parsed.fields,
    p_images: images,
    p_fitments: parsed.fitments,
    p_alt_numbers: parsed.altNumbers,
  });

  let result = saved.data as unknown as EditResult | null;
  if (saved.error) {
    const code = saved.error.code ?? "";
    // The database answered: whatever it said, the transaction rolled back.
    if (code === "40001") {
      return {
        error: "This listing changed since you opened it — maybe in another tab. Reload to see the latest, then make your edit again.",
        outcome: "conflict",
      };
    }
    if (DATABASE_ANSWERED.test(code)) {
      const message =
        code === "55000"
          ? "A sold or reserved part can't be edited."
          : code === "23514"
            ? PHOTO_REQUIRED
            : code === CHARGE_OUT_OF_BOUNDS_CODE
              ? LISTING_PRICE_OUT_OF_BOUNDS_MESSAGE
            : code === "P0002"
              ? "Listing not found."
              : code === "22023"
                ? "This save no longer matches the form. Reload the page, then make your edit again."
                : code === "42501"
                  ? "This account can't edit listings right now."
                  : "Couldn't save your changes. Nothing was changed — try again.";
      if (!["55000", "23514", CHARGE_OUT_OF_BOUNDS_CODE, "P0002", "22023", "42501"].includes(code)) {
        reportError("[sell] atomic listing edit failed", { id, requestId, error: saved.error });
      }
      return { error: message, outcome: "rejected" };
    }
    // No database answer (a dropped connection, a timeout): the edit may
    // have committed. Ask once before saying anything about it.
    reportError("[sell] listing edit outcome unknown", { id, requestId, error: saved.error });
    const check = await readListingEdit(supabase, id, requestId);
    if (check.outcome !== "saved") return UNKNOWN_EDIT;
    result = check.result;
  }
  if (!result?.updated_at) return UNKNOWN_EDIT;

  // Storage follows the committed rows, never the other way round: kept
  // photos are marked used, and dropped ones are garbage-collected only now
  // that no saved row points at them. The helper re-checks every referencing
  // table before touching storage, and never fails the save. Both are safe
  // to repeat when a replay recovers an earlier commit.
  if (images?.length) await finalizeMediaUrls(supabase, images.map((img) => img.url));
  // Only the seller's own objects: the list comes back from a record the
  // seller's session can write, so it is not proof of whose photos they are.
  for (const url of result.removed_image_urls ?? []) await deleteMediaIfUnreferenced(url, false, user.id);

  revalidateListingEdit(id, parsed.fields.source_car_id);
  const agentError = await applyListingAgent(id, agent, parsed.fields.offer_floor_cents);
  return {
    // A paused agent that couldn't resume still had its limits saved; the
    // message says that, not that nothing was saved (readiness 71).
    ok: agentError
      ? agentError.stillPaused
        ? `Listing updated. ${agentError.error}`
        : `Listing updated, but your agent's limits weren't saved: ${agentError.error}`
      : "Listing updated.",
    version: result.updated_at,
    outcome: "saved",
  };
}

type EditResult = { updated_at?: string; removed_image_urls?: string[]; replayed?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A SQLSTATE or PostgREST code: the database (or its gateway) answered. */
const DATABASE_ANSWERED = /^([0-9A-Z]{5}|PGRST\d+)$/;
const UNKNOWN_EDIT: SellState = {
  error: "We couldn't confirm the save. Checking its status…",
  outcome: "unknown",
};

function revalidateListingEdit(id: string, sourceCarId: string | null | undefined) {
  revalidatePath(`/listings/${id}`);
  revalidatePath(`/listings/${id}/edit`);
  revalidatePath("/marketplace");
  revalidatePath("/sell");
  revalidatePath("/garage");
  if (sourceCarId) revalidatePath(`/garage/${sourceCarId}/edit`);
}

type EditCheck =
  | { outcome: "saved"; result: EditResult }
  | { outcome: "not_found" }
  | { outcome: "unavailable" };

async function readListingEdit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listingId: string,
  requestId: string
): Promise<EditCheck> {
  const { data, error } = await supabase.rpc("listing_edit_status", {
    p_request: requestId,
    p_listing: listingId,
  });
  if (error) {
    reportError("[sell] listing edit status unavailable", { listingId, requestId, error });
    return { outcome: "unavailable" };
  }
  const status = data as unknown as { committed?: boolean; result?: EditResult } | null;
  if (status?.committed && status.result?.updated_at) return { outcome: "saved", result: status.result };
  return { outcome: "not_found" };
}

/**
 * Read-only reconciliation for an edit whose outcome is unknown (R2-01): did
 * this request commit? Never edits anything. "not_found" isn't proof the
 * first attempt can't still land, which is why the form resubmits the same
 * request id — a replay, never a second edit.
 */
export async function checkListingEdit(
  listingId: string,
  requestId: string
): Promise<{ outcome: "saved"; version: string } | { outcome: "not_found" | "unavailable" }> {
  const { supabase } = await requireUser();
  if (!UUID.test(listingId) || !UUID.test(requestId)) return { outcome: "unavailable" };
  const check = await readListingEdit(supabase, listingId, requestId);
  if (check.outcome !== "saved") return check;
  revalidateListingEdit(listingId, null);
  return { outcome: "saved", version: check.result.updated_at! };
}

const SETTABLE_STATUSES: ListingStatus[] = ["draft", "active", "paused", "sold", "archived"];

/**
 * Typed outcome for the status/delete/unlink actions (Rev E item 8). These
 * used to return void with bare-return guards, so a blocked Publish — the
 * primary seller conversion step — did nothing with nothing said. Now every
 * refusal says why, and the onboarding gate carries a flag the UI turns into
 * a link to the Payouts page.
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
    .select("id, status, price_cents")
    .eq("id", id)
    .eq("seller_id", user.id)
    .maybeSingle();
  if (!existing) return { error: "Listing not found." };
  // A draft can hold a price no card could be charged; it can't go live with it.
  if (status === "active" && existing.status !== "active" && !chargeWithinBounds(existing.price_cents)) {
    return { error: LISTING_PRICE_OUT_OF_BOUNDS_MESSAGE };
  }

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

  // Same rule as createListing: a listing goes public with its photo.
  if (status === "active") {
    const { count: photoCount } = await supabase
      .from("listing_images")
      .select("listing_id", { count: "exact", head: true })
      .eq("listing_id", id);
    if (!photoCount) return { error: PHOTO_REQUIRED };
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
  // The editor holds the listing's version (RR-05); a status change from its
  // header bumps it, so the form must re-render with the new one.
  revalidatePath(`/listings/${id}/edit`);
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

function safeParseJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || !value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCategory } from "@/lib/marketplace/taxonomy";
import { keepValidImageUrls } from "@/lib/media-url";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { ListingStatus } from "@/lib/database.types";

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

  return {
    fields: {
      title,
      description: description || null,
      category,
      subcategory: String(formData.get("subcategory") ?? "") || null,
      condition: String(formData.get("condition") ?? "used") as
        | "new"
        | "like_new"
        | "used"
        | "for_parts",
      price_cents: price,
      shipping_cents: shipping,
      offer_floor_cents: floor,
      allows_collection: formData.get("allows_collection") === "on",
      location: String(formData.get("location") ?? "").trim() || null,
      compatibility_notes: compatibility || null,
      source_car_id: sourceCarId,
    },
  };
}

export async function createListing(_prev: SellState, formData: FormData): Promise<SellState> {
  const { supabase, user } = await requireUser();

  if (!(await allowAction(RATE_LIMITS.createListing, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.createListing) };
  }

  const parsed = await readListingFields(formData, user.id);
  if ("error" in parsed) return { error: parsed.error };

  // The page promises "nothing reaches the market until you publish it", so
  // honour it: saving a draft is a real, separate outcome.
  const asDraft = formData.get("save_draft") !== null;

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

  const urls = keepValidImageUrls(safeParseJson(formData.get("image_urls")));
  if (urls.length) {
    const { error: imageError } = await supabase.from("listing_images").insert(
      urls.map((url, index) => ({ listing_id: listing.id, url, position: index }))
    );
    if (imageError) {
      console.error("[sell] listing images failed", { listingId: listing.id, imageError });
    }
  }

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

  revalidatePath("/marketplace");
  revalidatePath("/sell");
  if (parsed.fields.source_car_id) revalidatePath(`/garage/${parsed.fields.source_car_id}/edit`);

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

  // Replace the gallery only when the form actually submitted one.
  const imagesField = formData.get("image_urls");
  if (typeof imagesField === "string" && imagesField) {
    const urls = keepValidImageUrls(safeParseJson(imagesField));
    await supabase.from("listing_images").delete().eq("listing_id", id);
    if (urls.length) {
      await supabase
        .from("listing_images")
        .insert(urls.map((url, index) => ({ listing_id: id, url, position: index })));
    }
  }

  revalidatePath(`/listings/${id}`);
  revalidatePath(`/listings/${id}/edit`);
  revalidatePath("/marketplace");
  revalidatePath("/sell");
  return { ok: "Listing updated." };
}

const SETTABLE_STATUSES: ListingStatus[] = ["draft", "active", "paused", "sold", "archived"];

export async function setListingStatus(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as ListingStatus;
  if (!id || !SETTABLE_STATUSES.includes(status)) return;

  const { data: existing } = await supabase
    .from("listings")
    .select("id, status")
    .eq("id", id)
    .eq("seller_id", user.id)
    .maybeSingle();
  if (!existing) return;

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
    if (paidItem) return;
  }
  if (existing.status === "reserved") return;

  await supabase.from("listings").update({ status }).eq("id", id).eq("seller_id", user.id);

  revalidatePath("/sell");
  revalidatePath(`/listings/${id}`);
  revalidatePath("/marketplace");
}

export async function deleteListing(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Order history references listings; 0007 made that FK ON DELETE SET NULL with
  // a title snapshot, so removing a sold listing no longer breaks receipts.
  await supabase.from("listings").delete().eq("id", id).eq("seller_id", user.id);

  revalidatePath("/sell");
  revalidatePath("/marketplace");
  redirect("/sell?deleted=1");
}

function safeParseJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || !value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

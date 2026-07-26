"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCategory } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

export type SellState = { error?: string };

export async function createListing(_prev: SellState, formData: FormData): Promise<SellState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "");
  const subcategory = String(formData.get("subcategory") ?? "") || null;
  const priceRaw = String(formData.get("price") ?? "").trim();
  const price = Math.round(Number(priceRaw) * 100);

  if (!title) return { error: "Title is required." };
  if (!getCategory(category)) return { error: "Pick a category." };
  if (!priceRaw || !Number.isFinite(price) || price < 0) {
    return { error: "Enter a valid price." };
  }

  const condition = String(formData.get("condition") ?? "used");
  const sourceCarId = String(formData.get("source_car_id") ?? "") || null;

  const { data: listing, error } = await supabase
    .from("listings")
    .insert({
      seller_id: user.id,
      source_car_id: sourceCarId,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      category,
      subcategory,
      condition: condition as "new" | "like_new" | "used" | "for_parts",
      price_cents: price,
      location: String(formData.get("location") ?? "").trim() || null,
      compatibility_notes: String(formData.get("compatibility_notes") ?? "").trim() || null,
      status: "active",
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Photos are uploaded client-side first; their URLs arrive as a JSON array.
  const imagesRaw = String(formData.get("image_urls") ?? "[]");
  try {
    const urls = JSON.parse(imagesRaw) as string[];
    if (Array.isArray(urls) && urls.length > 0) {
      await supabase.from("listing_images").insert(
        urls.slice(0, 12).map((url, index) => ({
          listing_id: listing.id,
          url,
          position: index,
        }))
      );
    }
  } catch {
    // Ignore malformed image payloads; the listing itself is created.
  }

  revalidatePath("/marketplace");
  redirect(`/listings/${listing.id}`);
}

export async function setListingStatus(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (id && ["active", "sold", "archived"].includes(status)) {
    await supabase
      .from("listings")
      .update({ status: status as "active" | "sold" | "archived", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("seller_id", user.id);
  }
  revalidatePath("/sell");
  revalidatePath(`/listings/${id}`);
  revalidatePath("/marketplace");
}

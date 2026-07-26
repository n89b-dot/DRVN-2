"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { slugify } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function createCar(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give your car a name." };

  const make = String(formData.get("make") ?? "").trim() || null;
  const model = String(formData.get("model") ?? "").trim() || null;
  const yearRaw = String(formData.get("year") ?? "").trim();
  const year = yearRaw ? Number(yearRaw) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
    return { error: "Enter a valid year." };
  }

  const slug = `${slugify(name)}-${crypto.randomUUID().slice(0, 6)}`;

  const { data, error } = await supabase
    .from("cars")
    .insert({ owner_id: user.id, slug, name, make, model, year })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/garage");
  redirect(`/garage/${data.id}/edit`);
}

export async function updateCar(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return { error: "Car name is required." };

  const yearRaw = String(formData.get("year") ?? "").trim();
  const tagsRaw = String(formData.get("tags") ?? "").trim();

  const { error } = await supabase
    .from("cars")
    .update({
      name,
      make: String(formData.get("make") ?? "").trim() || null,
      model: String(formData.get("model") ?? "").trim() || null,
      year: yearRaw ? Number(yearRaw) : null,
      color: String(formData.get("color") ?? "").trim() || null,
      about: String(formData.get("about") ?? "").trim() || null,
      tags: tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [],
      is_public: formData.get("is_public") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/garage");
  revalidatePath(`/garage/${id}/edit`);
  return {};
}

export async function deleteCar(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) {
    await supabase.from("cars").delete().eq("id", id);
  }
  revalidatePath("/garage");
  redirect("/garage");
}

export type ModItemInput = {
  group_label: string;
  brand: string | null;
  product: string | null;
  raw_text: string;
  position: number;
};

export async function saveModItems(carId: string, items: ModItemInput[]): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  // Ownership is enforced by RLS, but check up front for a clean error.
  const { data: car } = await supabase
    .from("cars")
    .select("id, slug, owner_id")
    .eq("id", carId)
    .single();
  if (!car || car.owner_id !== user.id) return { error: "Car not found." };

  const { error: delError } = await supabase.from("mod_items").delete().eq("car_id", carId);
  if (delError) return { error: delError.message };

  if (items.length > 0) {
    const { error } = await supabase.from("mod_items").insert(
      items.map((item, index) => ({
        car_id: carId,
        group_label: item.group_label || "Other",
        brand: item.brand,
        product: item.product,
        raw_text: item.raw_text,
        position: index,
      }))
    );
    if (error) return { error: error.message };
  }

  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath(`/cars/${car.slug}`);
  return {};
}

export async function addCarImage(carId: string, url: string): Promise<ActionState> {
  const { supabase } = await requireUser();

  const { count } = await supabase
    .from("car_images")
    .select("id", { count: "exact", head: true })
    .eq("car_id", carId);

  const { error } = await supabase
    .from("car_images")
    .insert({ car_id: carId, url, position: count ?? 0 });
  if (error) return { error: error.message };

  // First image becomes the cover automatically.
  if ((count ?? 0) === 0) {
    await supabase.from("cars").update({ cover_image_url: url }).eq("id", carId);
  }

  revalidatePath(`/garage/${carId}/edit`);
  return {};
}

export async function deleteCarImage(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("image_id") ?? "");
  const carId = String(formData.get("car_id") ?? "");
  if (id) await supabase.from("car_images").delete().eq("id", id);
  if (carId) revalidatePath(`/garage/${carId}/edit`);
}

export async function createActivityPost(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const carId = String(formData.get("car_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const intro = String(formData.get("intro") ?? "").trim();
  const bodyText = String(formData.get("body") ?? "").trim();
  const videoUrl = String(formData.get("video_url") ?? "").trim();

  if (!carId || !title) return { error: "A title is required." };
  if (videoUrl && !/^https?:\/\//.test(videoUrl)) {
    return { error: "Video URL must start with http(s)://" };
  }

  const { data: car } = await supabase.from("cars").select("slug").eq("id", carId).single();

  const { error } = await supabase.from("activity_posts").insert({
    car_id: carId,
    author_id: user.id,
    title,
    intro: intro || null,
    body: bodyText ? [{ heading: null, text: bodyText }] : [],
    video_url: videoUrl || null,
  });

  if (error) return { error: error.message };

  revalidatePath(`/garage/${carId}/edit`);
  if (car) revalidatePath(`/cars/${car.slug}`);
  return {};
}

export async function createRichActivityPost(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const carId = String(formData.get("car_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!carId || !title) return { error: "A title is required." };

  const { data: car } = await supabase
    .from("cars")
    .select("slug, owner_id")
    .eq("id", carId)
    .single();
  if (!car || car.owner_id !== user.id) return { error: "Car not found." };

  // Blocks arrive as JSON from the composer; re-validate via normalizeBlocks.
  const { normalizeBlocks } = await import("@/lib/activity-blocks");
  let blocks;
  try {
    blocks = normalizeBlocks(JSON.parse(String(formData.get("blocks") ?? "[]")));
  } catch {
    return { error: "Could not read the post content." };
  }
  if (blocks.length === 0) return { error: "Add at least one block." };

  const { data: post, error } = await supabase
    .from("activity_posts")
    .insert({ car_id: carId, author_id: user.id, title, intro: null, body: blocks })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Mirror image URLs into activity_images so feeds/profile strips get covers.
  const imageUrls = blocks.flatMap((b) => (b.type === "images" ? b.urls : []));
  if (imageUrls.length) {
    await supabase.from("activity_images").insert(
      imageUrls.map((url, index) => ({ post_id: post.id, url, position: index }))
    );
  }

  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath(`/cars/${car.slug}`);
  redirect(`/cars/${car.slug}/activity/${post.id}`);
}

export async function updateNotificationPrefs(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const { NOTIFICATION_PREFS } = await import("@/lib/notification-prefs");
  const prefs = Object.fromEntries(
    NOTIFICATION_PREFS.map((p) => [p.key, formData.get(`pref_${p.key}`) === "on"])
  );

  const { error } = await supabase
    .from("profiles")
    .update({ notification_prefs: prefs, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/notifications");
  revalidatePath("/settings");
  return {};
}

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const displayName = String(formData.get("display_name") ?? "").trim();
  if (!displayName) return { error: "Display name is required." };

  const links = ["website", "instagram", "youtube"]
    .map((label) => ({ label, url: String(formData.get(`link_${label}`) ?? "").trim() }))
    .filter((l) => l.url);

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      headline: String(formData.get("headline") ?? "").trim() || null,
      bio: String(formData.get("bio") ?? "").trim() || null,
      location: String(formData.get("location") ?? "").trim() || null,
      links,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/profile");
  return {};
}

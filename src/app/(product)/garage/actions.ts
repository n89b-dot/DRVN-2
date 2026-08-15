"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { slugify } from "@/lib/format";
import type { ActivityBlock } from "@/lib/activity-blocks";
import { deleteMediaIfUnreferenced, finalizeMediaUrls } from "@/lib/media-lifecycle";
import { isAllowedVideoUrl, isOwnedStorageUrl, keepValidImageUrls } from "@/lib/media-url";
import { MOD_CATEGORIES, type ModCategory } from "@/lib/mods/parse";
import { createClient } from "@/lib/supabase/server";
import { decodeVin } from "@/lib/vehicles/vpic";
import type { Car } from "@/lib/database.types";

export type ActionState = { error?: string; ok?: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/**
 * Drops any image URL that isn't our own storage (and any images block that
 * ends up empty as a result) before a block set is persisted as a post body.
 * Uploads happen client-side, so the URLs arriving here are user-controlled.
 */
function sanitizeActivityBlocks(blocks: ActivityBlock[], userId: string): ActivityBlock[] {
  return blocks
    .map((block) =>
      block.type === "images"
        ? { ...block, urls: keepValidImageUrls(block.urls, 12, userId) }
        : block
    )
    .filter((block) => block.type !== "images" || block.urls.length > 0);
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

  // VIN decode (0025): the VIN is the verification input, the decoded fields
  // are the fitment key. A new/changed VIN triggers one vPIC decode; decoded
  // identity fills make/model/year only where the form left them blank (the
  // owner's own words win), while trim/engine/drivetrain/body always come
  // from the decode — they have no manual fields to fight with.
  const vinRaw = String(formData.get("vin") ?? "").trim().toUpperCase();
  if (vinRaw && (vinRaw.length < 11 || vinRaw.length > 17)) {
    return { error: "That VIN doesn't look right — 17 characters on modern cars." };
  }
  const { data: existing } = await supabase
    .from("cars")
    .select("vin")
    .eq("id", id)
    .maybeSingle();

  let make = String(formData.get("make") ?? "").trim() || null;
  let model = String(formData.get("model") ?? "").trim() || null;
  let year = yearRaw ? Number(yearRaw) : null;
  let decodedFields: Partial<Car> = {};
  let decodeNote: string | undefined;
  if (vinRaw && vinRaw !== (existing?.vin ?? "")) {
    const decoded = await decodeVin(vinRaw);
    if (decoded) {
      make = make ?? decoded.make;
      model = model ?? decoded.model;
      year = year ?? decoded.year;
      decodedFields = {
        trim: decoded.trim,
        engine: decoded.engine,
        drivetrain: decoded.drivetrain,
        body_class: decoded.bodyClass,
        vin_decoded_at: new Date().toISOString(),
      };
    } else {
      decodeNote =
        "Saved — but the VIN couldn't be decoded right now, so check make/model/year yourself.";
    }
  } else if (!vinRaw && existing?.vin) {
    // VIN removed: keep make/model/year (they're the car's identity either
    // way) but drop the decode provenance.
    decodedFields = { vin_decoded_at: null };
  }

  const { error } = await supabase
    .from("cars")
    .update({
      name,
      make,
      model,
      year,
      vin: vinRaw || null,
      ...decodedFields,
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
  return decodeNote ? { error: decodeNote } : {};
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
  /** Present for rows that already exist, so their listing link survives a save. */
  id?: string | null;
  group_label: string;
  brand: string | null;
  product: string | null;
  /** Carried onto the listing when this line is released for sale. */
  part_number?: string | null;
  /** Heuristic-parser output; free text, no DB enum (see src/lib/mods/parse.ts). */
  category?: string | null;
  /** Heuristic-parser confidence 0–1, or null for hand-entered/legacy rows. */
  confidence?: number | null;
  raw_text: string;
  position: number;
};

/**
 * Saves the mod sheet.
 *
 * Deliberately not delete-and-reinsert: `mod_items.linked_listing_id` connects a
 * build line to the part listed off it, and wiping every row on each save
 * destroyed that link. Existing rows are updated in place, absent rows deleted,
 * new rows inserted.
 */
export async function saveModItems(carId: string, items: ModItemInput[]): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  // Ownership is enforced by RLS, but check up front for a clean error.
  const { data: car } = await supabase
    .from("cars")
    .select("id, slug, owner_id")
    .eq("id", carId)
    .single();
  if (!car || car.owner_id !== user.id) return { error: "Car not found." };

  const keepIds = items.map((i) => i.id).filter((id): id is string => Boolean(id));

  const deleteQuery = supabase.from("mod_items").delete().eq("car_id", carId);
  const { error: delError } = keepIds.length
    ? await deleteQuery.not("id", "in", `(${keepIds.join(",")})`)
    : await deleteQuery;
  if (delError) return { error: delError.message };

  for (const [index, item] of items.entries()) {
    const row = {
      group_label: item.group_label || "Other",
      brand: item.brand,
      product: item.product,
      part_number: item.part_number ?? null,
      // Client-supplied; the columns have no DB constraint, so gate here:
      // unknown categories become null, confidence is clamped to [0, 1].
      category: MOD_CATEGORIES.includes(item.category as ModCategory)
        ? (item.category as ModCategory)
        : null,
      confidence:
        typeof item.confidence === "number" && Number.isFinite(item.confidence)
          ? Math.min(1, Math.max(0, item.confidence))
          : null,
      raw_text: item.raw_text,
      position: index,
    };

    const { error } = item.id
      ? await supabase.from("mod_items").update(row).eq("id", item.id).eq("car_id", carId)
      : await supabase.from("mod_items").insert({ car_id: carId, ...row });

    if (error) return { error: error.message };
  }

  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath(`/cars/${car.slug}`);
  return {};
}

export async function addCarImage(carId: string, url: string): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  if (!isOwnedStorageUrl(url, user.id)) {
    return { error: "That image couldn't be verified. Try uploading it again." };
  }

  const { count } = await supabase
    .from("car_images")
    .select("id", { count: "exact", head: true })
    .eq("car_id", carId);

  const { error } = await supabase
    .from("car_images")
    .insert({ car_id: carId, url, position: count ?? 0 });
  if (error) return { error: error.message };

  // The URL is referenced now — release it from the staged-upload GC.
  await finalizeMediaUrls(supabase, [url]);

  // First image becomes the cover automatically; changeable via setCoverImage.
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

  if (id) {
    // If this was the cover, promote another image rather than leaving a
    // dangling cover_image_url.
    const { data: image } = await supabase
      .from("car_images")
      .select("url, car_id")
      .eq("id", id)
      .maybeSingle();

    await supabase.from("car_images").delete().eq("id", id);

    if (image) {
      const { data: car } = await supabase
        .from("cars")
        .select("cover_image_url")
        .eq("id", image.car_id)
        .maybeSingle();

      if (car?.cover_image_url === image.url) {
        const { data: next } = await supabase
          .from("car_images")
          .select("url")
          .eq("car_id", image.car_id)
          .order("position")
          .limit(1)
          .maybeSingle();
        await supabase
          .from("cars")
          .update({ cover_image_url: next?.url ?? null })
          .eq("id", image.car_id);
      }

      // With the row (and any cover pointer) gone, the storage object may be
      // orphaned — the helper re-checks every referencing table before
      // touching storage and never fails this action.
      await deleteMediaIfUnreferenced(image.url);
    }
  }

  if (carId) revalidatePath(`/garage/${carId}/edit`);
}

/** Lets the owner choose the cover instead of being stuck with the first upload. */
export async function setCoverImage(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const carId = String(formData.get("car_id") ?? "");
  const url = String(formData.get("url") ?? "");
  if (!carId || !isOwnedStorageUrl(url, user.id)) return;

  await supabase.from("cars").update({ cover_image_url: url }).eq("id", carId);
  revalidatePath(`/garage/${carId}/edit`);

  const { data: car } = await supabase.from("cars").select("slug").eq("id", carId).maybeSingle();
  if (car) revalidatePath(`/cars/${car.slug}`);
}

/**
 * Swaps an image with its immediate neighbour by `position`. Reorder was
 * previously drag-only in intent but had no implementation at all — this
 * gives keyboard/touch users an equivalent up/down control.
 */
export async function moveCarImage(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const carId = String(formData.get("car_id") ?? "");
  const imageId = String(formData.get("image_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!carId || !imageId || (direction !== "up" && direction !== "down")) return;

  const { data: images } = await supabase
    .from("car_images")
    .select("id, position")
    .eq("car_id", carId)
    .order("position");
  if (!images) return;

  const index = images.findIndex((img) => img.id === imageId);
  if (index === -1) return;
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= images.length) return;

  const a = images[index];
  const b = images[swapIndex];

  await supabase.from("car_images").update({ position: b.position }).eq("id", a.id);
  await supabase.from("car_images").update({ position: a.position }).eq("id", b.id);

  revalidatePath(`/garage/${carId}/edit`);
}

/** Lets the owner describe a photo for screen readers / SEO alt text. */
export async function updateCarImageAlt(formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const carId = String(formData.get("car_id") ?? "");
  const imageId = String(formData.get("image_id") ?? "");
  const alt = String(formData.get("alt") ?? "").trim().slice(0, 200);
  if (!imageId) return { error: "Missing image." };

  const { error } = await supabase
    .from("car_images")
    .update({ alt: alt || null })
    .eq("id", imageId);
  if (error) return { error: error.message };

  if (carId) revalidatePath(`/garage/${carId}/edit`);
  return { ok: "Saved" };
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

  // Blocks arrive as JSON from the composer; re-validate via normalizeBlocks,
  // then drop any image URL that isn't our own storage.
  const { normalizeBlocks } = await import("@/lib/activity-blocks");
  let blocks;
  try {
    blocks = sanitizeActivityBlocks(
      normalizeBlocks(JSON.parse(String(formData.get("blocks") ?? "[]"))),
      user.id
    );
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
    // The URLs are referenced now — release them from the staged-upload GC.
    await finalizeMediaUrls(supabase, imageUrls);
  }

  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath(`/cars/${car.slug}`);
  redirect(`/cars/${car.slug}/activity/${post.id}`);
}

/**
 * Edits an existing update. Posts were create-only, so a typo in a title was
 * permanent and images could never be added or removed after filing.
 */
export async function updateActivityPost(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const postId = String(formData.get("post_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!postId || !title) return { error: "A title is required." };
  if (title.length > 160) return { error: "Keep the title under 160 characters." };

  const { data: post } = await supabase
    .from("activity_posts")
    .select("id, car_id, author_id")
    .eq("id", postId)
    .maybeSingle();
  if (!post || post.author_id !== user.id) return { error: "Update not found." };

  const { data: car } = await supabase
    .from("cars")
    .select("slug")
    .eq("id", post.car_id)
    .maybeSingle();

  const videoUrl = String(formData.get("video_url") ?? "").trim();
  if (videoUrl && !isAllowedVideoUrl(videoUrl)) {
    return { error: "Video links must be YouTube URLs." };
  }

  // Body is only touched when the form actually submits content. A details-only
  // edit (title, intro, video) must not flatten a post's image and text blocks
  // into a single paragraph.
  const blocksRaw = formData.get("blocks");
  const bodyRaw = formData.get("body");
  let body: unknown | undefined;

  if (typeof blocksRaw === "string" && blocksRaw) {
    const { normalizeBlocks } = await import("@/lib/activity-blocks");
    try {
      body = sanitizeActivityBlocks(normalizeBlocks(JSON.parse(blocksRaw)), user.id);
    } catch {
      return { error: "Could not read the post content." };
    }
    if ((body as unknown[]).length === 0) return { error: "Add at least one block." };
  } else if (typeof bodyRaw === "string") {
    const text = bodyRaw.trim();
    body = text ? [{ heading: null, text }] : [];
  }

  const { error } = await supabase
    .from("activity_posts")
    .update({
      title,
      intro: String(formData.get("intro") ?? "").trim() || null,
      video_url: videoUrl || null,
      ...(body === undefined ? {} : { body: body as never }),
    })
    .eq("id", postId);
  if (error) return { error: error.message };

  // Keep activity_images in step so feed covers reflect the edit — but only when
  // the body was actually replaced, or a details edit would wipe the gallery.
  if (Array.isArray(body)) {
    const imageUrls = keepValidImageUrls(
      (body as { type?: string; urls?: string[] }[]).flatMap((b) =>
        b.type === "images" ? (b.urls ?? []) : []
      ),
      24,
      user.id
    );

    // Snapshot the outgoing gallery first, so photos this edit drops can be
    // GC'd once nothing references them anymore.
    const { data: previousImages } = await supabase
      .from("activity_images")
      .select("url")
      .eq("post_id", postId);

    await supabase.from("activity_images").delete().eq("post_id", postId);
    if (imageUrls.length) {
      await supabase
        .from("activity_images")
        .insert(imageUrls.map((url, index) => ({ post_id: postId, url, position: index })));
      await finalizeMediaUrls(supabase, imageUrls);
    }

    const kept = new Set(imageUrls);
    for (const prev of previousImages ?? []) {
      if (!kept.has(prev.url)) await deleteMediaIfUnreferenced(prev.url);
    }
  }

  revalidatePath(`/garage/${post.car_id}/edit`);
  if (car) {
    revalidatePath(`/cars/${car.slug}`);
    revalidatePath(`/cars/${car.slug}/activity/${postId}`);
  }
  return { ok: "Update saved." };
}

export async function deleteActivityPost(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const postId = String(formData.get("post_id") ?? "");
  if (!postId) return { error: "Missing entry." };

  const { data: post } = await supabase
    .from("activity_posts")
    .select("id, car_id, author_id")
    .eq("id", postId)
    .maybeSingle();
  if (!post || post.author_id !== user.id) return { error: "Entry not found." };

  const { data: car } = await supabase
    .from("cars")
    .select("slug")
    .eq("id", post.car_id)
    .maybeSingle();

  const { error } = await supabase.from("activity_posts").delete().eq("id", postId);
  if (error) return { error: error.message };

  revalidatePath(`/garage/${post.car_id}/edit`);
  if (car) revalidatePath(`/cars/${car.slug}`);
  redirect(`/garage/${post.car_id}/edit`);
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
  if (displayName.length > 80) return { error: "Keep the display name under 80 characters." };

  const bio = String(formData.get("bio") ?? "").trim();
  if (bio.length > 1000) return { error: "Keep the bio under 1000 characters." };

  const links = ["website", "instagram", "youtube"]
    .map((label) => ({ label, url: String(formData.get(`link_${label}`) ?? "").trim() }))
    .filter((l) => l.url)
    .filter((l) => /^https?:\/\//.test(l.url));

  // Avatar upload happens client-side into the `avatars` bucket; only the URL
  // arrives here. An empty value leaves the existing avatar alone.
  const avatarUrl = String(formData.get("avatar_url") ?? "").trim();
  if (avatarUrl && !isOwnedStorageUrl(avatarUrl, user.id)) {
    return { error: "That image couldn't be verified. Try uploading it again." };
  }

  // Snapshot the outgoing avatar before it's overwritten, so the replaced
  // object can be GC'd once nothing references it.
  let previousAvatarUrl: string | null = null;
  if (avatarUrl) {
    const { data: current } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    previousAvatarUrl = current?.avatar_url ?? null;
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      headline: String(formData.get("headline") ?? "").trim() || null,
      bio: bio || null,
      location: String(formData.get("location") ?? "").trim() || null,
      links,
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  if (avatarUrl) {
    await finalizeMediaUrls(supabase, [avatarUrl]);
    if (previousAvatarUrl && previousAvatarUrl !== avatarUrl) {
      await deleteMediaIfUnreferenced(previousAvatarUrl);
    }
  }

  revalidatePath("/profile");
  revalidatePath("/settings");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.username) revalidatePath(`/u/${profile.username}`);

  return { ok: "Sheet saved." };
}

/**
 * Account deletion. Orders are anonymised rather than cascaded (migration 0007),
 * so the counterparty keeps their history — before that change this would have
 * failed on a foreign-key violation for anyone who had ever traded.
 */
export async function deleteAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const confirmation = String(formData.get("confirm") ?? "").trim();
  if (confirmation !== "DELETE") {
    return { error: 'Type DELETE to confirm.' };
  }

  // Undispatched sales would leave buyers stranded.
  const { data: openOrders } = await supabase
    .from("orders")
    .select("id")
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .in("status", ["pending", "paid", "shipped"])
    .limit(1);

  if (openOrders?.length) {
    return {
      error:
        "You have orders in progress. Finish or cancel them first — deleting now would leave the other party stranded.",
    };
  }

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();

  // Remove uploaded media, which the row cascade doesn't reach. car-images
  // and activity-images nest one level deeper (`${uid}/${carId}/...`), and
  // storage list() is not recursive — a subfolder comes back as an entry
  // with no object id — so those folders get one level of descent.
  for (const bucket of ["avatars", "car-images", "activity-images", "listing-images"]) {
    const { data: entries } = await admin.storage.from(bucket).list(user.id);
    if (!entries?.length) continue;
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry.id) {
        paths.push(`${user.id}/${entry.name}`);
      } else {
        const { data: nested } = await admin.storage.from(bucket).list(`${user.id}/${entry.name}`);
        for (const file of nested ?? []) {
          if (file.id) paths.push(`${user.id}/${entry.name}/${file.name}`);
        }
      }
    }
    if (paths.length) await admin.storage.from(bucket).remove(paths);
  }

  // Cascades through profiles → cars, listings, activity, saves, follows.
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { error: error.message };

  await supabase.auth.signOut();
  redirect("/?deleted=1");
}

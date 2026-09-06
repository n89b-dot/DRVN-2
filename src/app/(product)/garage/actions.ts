"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { slugify } from "@/lib/format";
import { ACTIVITY_TITLE_MAX } from "@/lib/limits";
import { blockMediaUrls, normalizeBlocks, type ActivityBlock } from "@/lib/activity-blocks";
import { deleteMediaIfUnreferenced, finalizeMediaUrls } from "@/lib/media-lifecycle";
import { isAllowedVideoUrl, isOwnedStorageUrl, keepValidImageUrls } from "@/lib/media-url";
import { MOD_CATEGORIES, type ModCategory } from "@/lib/mods/parse";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { capture } from "@/lib/analytics";
import { reportError } from "@/lib/monitoring";

import { decodeVin } from "@/lib/vehicles/vpic";
import { matchCatalogByName, resolveCatalogSelection } from "@/lib/vehicles/catalog";
import type { Car, CarImage, Json } from "@/lib/database.types";

export type ActionState = { error?: string; ok?: string; href?: string };

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
    .map((block) => {
      if (block.type === "images") {
        return { ...block, urls: keepValidImageUrls(block.urls, 12, userId) };
      }
      if (block.type === "before_after") {
        // Both sides must be this user's own storage or the block drops.
        const [beforeUrl] = keepValidImageUrls([block.beforeUrl], 1, userId);
        const [afterUrl] = keepValidImageUrls([block.afterUrl], 1, userId);
        return beforeUrl && afterUrl ? { ...block, beforeUrl, afterUrl } : null;
      }
      return block;
    })
    .filter((block): block is ActivityBlock => block !== null)
    .filter((block) => block.type !== "images" || block.urls.length > 0);
}

function activityBlocksJson(blocks: ActivityBlock[]): Json {
  // normalizeBlocks has already constrained every union member. The JSON
  // round-trip also rejects values Postgres jsonb cannot represent.
  return JSON.parse(JSON.stringify(blocks)) as Json;
}

/**
 * Add Car (brief §E): three identity paths into one insert.
 *
 * - `picker` (primary): catalog make/model ids from the DRVN vehicle catalog
 *   (0041) — the car lands as a recognized vehicle, not invented strings.
 * - `vin` (secondary): one vPIC decode establishes identity; the VIN stays
 *   private on the row. Wording is "VIN decoded", never "verified".
 * - `manual` (always available): free text for kit/import/gray-market cars —
 *   quietly matched against the catalog when the words happen to line up.
 *
 * The display strings (make/model/year) are the frozen snapshot; catalog ids
 * are references. A personal name is optional — absent, the car is named by
 * what it is ("2024 Volkswagen Golf R").
 */
export async function createCar(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const mode = String(formData.get("mode") ?? "manual");
  const nameInput = String(formData.get("name") ?? "").trim();
  const yearRaw = String(formData.get("year") ?? "").trim();
  let year = yearRaw ? Number(yearRaw) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
    return { error: "Enter a valid year." };
  }

  let make: string | null = null;
  let model: string | null = null;
  let catalogMakeId: number | null = null;
  let catalogModelId: number | null = null;
  let identitySource: "picker" | "vin" | "manual" = "manual";
  let vin: string | null = null;
  let decoded: Awaited<ReturnType<typeof decodeVin>> = null;

  if (mode === "picker") {
    catalogMakeId = Number(formData.get("catalog_make_id")) || null;
    catalogModelId = Number(formData.get("catalog_model_id")) || null;
    if (!catalogMakeId || !catalogModelId) {
      return { error: "Pick the make and model — or switch to manual entry." };
    }
    const resolved = await resolveCatalogSelection(catalogMakeId, catalogModelId);
    if (!resolved) return { error: "That vehicle selection didn't resolve — try again." };
    make = resolved.make;
    model = resolved.model;
    identitySource = "picker";
  } else if (mode === "vin") {
    vin = String(formData.get("vin") ?? "").trim().toUpperCase() || null;
    if (!vin || vin.length < 11 || vin.length > 17) {
      return { error: "That VIN doesn't look right — 17 characters on modern cars." };
    }
    decoded = await decodeVin(vin);
    if (!decoded) {
      return {
        error:
          "That VIN didn't decode. Check it, or choose the vehicle from the list instead.",
      };
    }
    make = decoded.make;
    model = decoded.model;
    year = year ?? decoded.year;
    identitySource = "vin";
  } else {
    make = String(formData.get("make") ?? "").trim() || null;
    model = String(formData.get("model") ?? "").trim() || null;
  }

  // Manual words that happen to name a catalog vehicle quietly gain the
  // reference — automation without a prompt (brief principle 3).
  if (identitySource !== "picker" && make) {
    const match = await matchCatalogByName(make, model);
    catalogMakeId = match.makeId;
    catalogModelId = match.modelId;
  }

  const label = [year, make, model].filter(Boolean).join(" ").trim();
  const name = nameInput || label || "My car";

  const slug = `${slugify(name)}-${crypto.randomUUID().slice(0, 6)}`;

  const { data, error } = await supabase
    .from("cars")
    .insert({
      owner_id: user.id,
      slug,
      name,
      make,
      model,
      year,
      vin,
      trim: decoded?.trim ?? null,
      engine: decoded?.engine ?? null,
      drivetrain: decoded?.drivetrain ?? null,
      body_class: decoded?.bodyClass ?? null,
      vin_decoded_at: decoded ? new Date().toISOString() : null,
      catalog_make_id: catalogMakeId,
      catalog_model_id: catalogModelId,
      identity_source: identitySource,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  capture(user.id, { event: "vehicle_added", props: { identity_source: identitySource } });
  // Fire-and-forget search-index sync (brief §28) — never on the critical path.
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
  const { data: existing, error: existingError } = await supabase
    .from("cars")
    .select("vin, slug")
    .eq("id", id)
    .maybeSingle();
  if (existingError || !existing) return { error: "Car not found." };

  let make = String(formData.get("make") ?? "").trim() || null;
  let model = String(formData.get("model") ?? "").trim() || null;
  let year = yearRaw ? Number(yearRaw) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
    return { error: "Enter a valid year." };
  }
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

  const { data: updated, error } = await supabase
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
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!updated) return { error: "Car not found." };

  // Covers edits AND the public/private toggle: syncCarToSearch removes an
  // ineligible car (and its posts) from the index, or re-adds them.
  revalidatePath("/garage");
  revalidatePath(`/cars/${existing.slug}`);
  return { ok: decodeNote || "Changes saved." };
}

export async function deleteCar(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Car is missing." };
  const { error } = await supabase.from("cars").delete().eq("id", id);
  if (error) return { error: error.message };

  // Deleting an already-absent id is the desired state after a response was
  // lost. RLS still prevents this call from changing anybody else's car.
  revalidatePath("/garage");
  redirect("/garage");
}

export type ModItemInput = {
  /** Stable for saved and unfiled rows so response-loss replay converges. */
  id: string;
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
 * One database function applies the whole desired sheet transactionally.
 * Existing ids update in place so listing links survive; stable new ids make a
 * repeated request converge after a committed response is lost.
 */
export async function saveModItems(carId: string, items: ModItemInput[]): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!carId || items.length > 200 || items.some((item) => !uuid.test(item.id))) {
    return { error: "The modification sheet is invalid. Reload and try again." };
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    return { error: "The modification sheet contains duplicate lines." };
  }

  // Ownership is enforced by RLS, but check up front for a clean error.
  const { data: car, error: carError } = await supabase
    .from("cars")
    .select("id, slug, owner_id")
    .eq("id", carId)
    .maybeSingle();
  if (carError || !car || car.owner_id !== user.id) return { error: "Car not found." };

  const payload = items.map((item) => ({
    id: item.id,
    group_label: item.group_label || "Other",
    brand: item.brand,
    product: item.product,
    part_number: item.part_number ?? null,
    category: MOD_CATEGORIES.includes(item.category as ModCategory)
      ? (item.category as ModCategory)
      : null,
    confidence:
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? Math.min(1, Math.max(0, item.confidence))
        : null,
    raw_text: item.raw_text,
  }));
  const { data, error } = await supabase.rpc(
    "save_mod_items" as never,
    { p_car_id: carId, p_items: payload } as never
  );
  if (error) return { error: error.message };
  if ((data as unknown as { outcome?: string } | null)?.outcome !== "saved") {
    return { error: "The modification sheet was not saved." };
  }

  // Mods are searchable build content (brief §20) — resync the car's document.
  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath(`/cars/${car.slug}`);
  return { ok: "Build saved." };
}

async function galleryChange(carId: string, operation: string, payload: Record<string, string | string[]>) {
  const { supabase, user } = await requireUser();
  const client = operation === "add" ? createAdminClient() : supabase;
  const { data, error } = await client.rpc("edit_car_gallery", { p_car: carId, p_operation: operation, p_payload: operation === "add" ? { ...payload, actor: user.id } : payload });
  if (error) return { error: "Couldn't save the gallery change. Refresh if the gallery changed, then try again." };
  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath("/garage");
  const { data: car } = await supabase.from("cars").select("slug").eq("id", carId).maybeSingle();
  if (car) revalidatePath(`/cars/${car.slug}`);
  return { result: data as { ok: boolean; image?: CarImage; deleted_url?: string | null } };
}

export async function addCarImage(carId: string, url: string): Promise<ActionState & { image?: CarImage }> {
  const { supabase, user } = await requireUser();
  if (!isOwnedStorageUrl(url, user.id)) return { error: "That image couldn't be verified. Try uploading it again." };
  const changed = await galleryChange(carId, "add", { url });
  if (changed.error) return { error: changed.error };
  await finalizeMediaUrls(supabase, [url]);
  return { image: changed.result?.image };
}

export async function deleteCarImage(formData: FormData): Promise<ActionState> {
  const carId = String(formData.get("car_id") ?? "");
  const id = String(formData.get("image_id") ?? "");
  if (!carId || !id) return { error: "Missing image." };
  const changed = await galleryChange(carId, "delete", { id });
  if (changed.error) return { error: changed.error };
  if (changed.result?.deleted_url) await deleteMediaIfUnreferenced(changed.result.deleted_url);
  return { ok: "Photo deleted" };
}

export async function setCoverImage(formData: FormData): Promise<ActionState> {
  const { user } = await requireUser();
  const carId = String(formData.get("car_id") ?? "");
  const url = String(formData.get("url") ?? "");
  if (!carId || !isOwnedStorageUrl(url, user.id)) return { error: "Choose one of your gallery photos." };
  const changed = await galleryChange(carId, "cover", { url });
  return changed.error ? { error: changed.error } : { ok: "Cover saved" };
}

/** The complete desired order makes a retry idempotent, including arrow moves. */
export async function reorderCarImages(carId: string, orderedIds: string[]): Promise<ActionState> {
  if (!carId || orderedIds.length > 48) return { error: "Invalid gallery order." };
  const changed = await galleryChange(carId, "reorder", { ids: orderedIds });
  return changed.error ? { error: changed.error } : { ok: "Order saved" };
}

export type ShowcasePinInput = {
  x: number;
  y: number;
  modItemId: string | null;
  label: string;
};

/**
 * The annotated showcase (§U): ONE image, up to 8 pins, each snapshotting its
 * label. Delete-and-reinsert like the gallery/fitment savers; RLS scopes both
 * statements to the owner, and the image must be one of this car's photos.
 */
export async function saveShowcase(
  carId: string,
  imageUrl: string,
  pins: ShowcasePinInput[],
): Promise<ActionState> {
  const { supabase } = await requireUser();
  if (!carId) return { error: "Missing car." };

  const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
  const sane = pins
    .filter((pin) => Number.isFinite(pin.x) && Number.isFinite(pin.y) && pin.label.trim())
    .slice(0, 8)
    .map((pin) => ({
      x: clamp(pin.x),
      y: clamp(pin.y),
      mod_item_id: pin.modItemId,
      label: pin.label.trim().slice(0, 80),
    }));

  if (sane.length > 0) {
    const { data: image } = await supabase
      .from("car_images")
      .select("id")
      .eq("car_id", carId)
      .eq("url", imageUrl)
      .maybeSingle();
    if (!image) return { error: "Pick one of this car's photos for the showcase." };
  }

  await supabase.from("car_hotspots").delete().eq("car_id", carId);
  if (sane.length > 0) {
    const { error } = await supabase
      .from("car_hotspots")
      .insert(sane.map((pin) => ({ car_id: carId, image_url: imageUrl, ...pin })));
    if (error) return { error: "Couldn't save the showcase." };
  }

  const { data: car } = await supabase.from("cars").select("slug").eq("id", carId).maybeSingle();
  revalidatePath(`/garage/${carId}/edit`);
  if (car) revalidatePath(`/cars/${car.slug}`);
  return { ok: sane.length ? "Showcase saved" : "Showcase cleared" };
}

/** Cover framing (§S3): stores the 0..1 focal point; the photo is untouched. */
export async function setCoverFocal(formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const carId = String(formData.get("car_id") ?? "");
  const x = Number(formData.get("focal_x"));
  const y = Number(formData.get("focal_y"));
  if (!carId || !Number.isFinite(x) || !Number.isFinite(y)) return { error: "Bad focal point." };
  const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
  const { data, error } = await supabase
    .from("cars")
    .update({ cover_focal_x: clamp(x), cover_focal_y: clamp(y) })
    .eq("id", carId).select("id").maybeSingle();
  if (error || !data) return { error: "Couldn't save this change. Try again." };
  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath("/garage");
  return { ok: "Framing saved" };
}

/** Lets the owner describe a photo for screen readers / SEO alt text. */
export async function updateCarImageAlt(formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const carId = String(formData.get("car_id") ?? "");
  const imageId = String(formData.get("image_id") ?? "");
  const alt = String(formData.get("alt") ?? "").trim().slice(0, 200);
  if (!imageId) return { error: "Missing image." };

  const { data, error } = await supabase
    .from("car_images")
    .update({ alt: alt || null })
    .eq("id", imageId).eq("car_id", carId).select("id").maybeSingle();
  if (error || !data) return { error: "Couldn't save this change. Try again." };

  if (carId) revalidatePath(`/garage/${carId}/edit`);
  return { ok: "Saved" };
}

export async function createRichActivityPost(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const carId = String(formData.get("car_id") ?? "");
  const operationId = String(formData.get("operation_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!carId || !title) return { error: "A title is required." };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    return { error: "Refresh this page before publishing." };
  }

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

  const imageUrls = blocks.flatMap((b) => (b.type === "images" ? b.urls : []));
  const { data: post, error } = await supabase
    .rpc("write_activity_post", {
      p_mode: "publish",
      p_post_id: operationId,
      p_car_id: carId,
      p_title: title,
      p_body: activityBlocksJson(blocks),
      p_image_urls: imageUrls,
    })
    .single();
  if (error || !post) {
    reportError("[activity] publish failed", { carId, operationId, error });
    return { error: "Couldn't confirm this update was published. Try again with the same draft." };
  }

  // The post and its feed-cover projection commit together in SQL. Media
  // finalization follows safely: references are already durable, and the
  // staging sweeper rechecks those references before removing anything.
  const mediaUrls = blockMediaUrls(blocks);
  if (mediaUrls.length) await finalizeMediaUrls(supabase, mediaUrls);

  capture(user.id, {
    event: "update_published",
    props: {
      blocks: blocks.length,
      automotive_blocks: blocks.filter((b) =>
        ["mod", "before_after", "performance", "mileage"].includes(b.type)
      ).length,
    },
  });

  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath(`/cars/${car.slug}`);
  return { ok: "Published.", href: `/cars/${car.slug}/activity/${post.post_id}` };
}

/**
 * Saves the composer's state as the car's draft — one draft per car, by
 * design (the composer reopens it, publishing converts it). A second save
 * overwrites the first: the draft is "where I left off", not a stack.
 * Unlike publishing, a draft doesn't need blocks yet — a title alone is a
 * thought worth keeping.
 */
export async function saveActivityDraft(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  const carId = String(formData.get("car_id") ?? "");
  const operationId = String(formData.get("operation_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!carId || !title) return { error: "A title is required to save a draft." };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    return { error: "Refresh this page before saving the draft." };
  }

  const { data: car } = await supabase
    .from("cars")
    .select("id, owner_id")
    .eq("id", carId)
    .single();
  if (!car || car.owner_id !== user.id) return { error: "Car not found." };

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

  const { error } = await supabase.rpc("write_activity_post", {
    p_mode: "draft",
    p_post_id: operationId,
    p_car_id: carId,
    p_title: title,
    p_body: activityBlocksJson(blocks),
    p_image_urls: [],
  });
  if (error) {
    reportError("[activity] draft save failed", { carId, operationId, error });
    return { error: "Couldn't save this draft. Your local copy is still here — try again." };
  }

  // Draft media is referenced content now — release it from the
  // staged-upload GC so a draft that sits for a week keeps its photos.
  const draftMediaUrls = blockMediaUrls(blocks);
  if (draftMediaUrls.length) await finalizeMediaUrls(supabase, draftMediaUrls);

  return { ok: "Draft saved" };
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
  if (title.length > ACTIVITY_TITLE_MAX) return { error: `Keep the title under ${ACTIVITY_TITLE_MAX} characters.` };

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
  let body: ActivityBlock[] | undefined;

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
    body = text ? [{ type: "text", style: "normal", text }] : [];
  }

  let previousImages: { url: string }[] = [];
  let imageUrls: string[] | null = null;
  if (Array.isArray(body)) {
    imageUrls = keepValidImageUrls(
      (body as { type?: string; urls?: string[] }[]).flatMap((b) =>
        b.type === "images" ? (b.urls ?? []) : []
      ),
      24,
      user.id
    );

    // Snapshot the outgoing gallery first, so photos this edit drops can be
    // GC'd once nothing references them anymore.
    const previous = await supabase
      .from("activity_images")
      .select("url")
      .eq("post_id", postId);
    if (previous.error) {
      reportError("[activity] prior image projection lookup failed", { postId, error: previous.error });
    } else {
      previousImages = previous.data ?? [];
    }
  }

  const { error } = await supabase.rpc("write_activity_post", {
    p_mode: "update",
    p_post_id: postId,
    p_car_id: post.car_id,
    p_title: title,
    ...(body === undefined ? {} : {
      p_body: activityBlocksJson(body),
      p_image_urls: imageUrls ?? [],
    }),
    p_intro: String(formData.get("intro") ?? "").trim() || undefined,
    p_video_url: videoUrl || undefined,
  });
  if (error) {
    reportError("[activity] update failed", { postId, error });
    return { error: "Couldn't save this update. Try again." };
  }

  // SQL changed body + cover projection atomically. Finalize referenced media
  // and clean no-longer-used objects only after the transaction succeeds.
  if (Array.isArray(body) && imageUrls) {
    if (imageUrls.length) await finalizeMediaUrls(supabase, imageUrls);

    // Finalize non-gallery media too (before/after sides live only in the
    // body), and never GC a dropped gallery url the body still uses.
    const bodyMediaUrls = blockMediaUrls(normalizeBlocks(body));
    if (bodyMediaUrls.length) await finalizeMediaUrls(supabase, bodyMediaUrls);

    const kept = new Set([...imageUrls, ...bodyMediaUrls]);
    for (const prev of previousImages) {
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

  // Identity fields (display name, headline) are the account-search
  // projection — resync. Location/bio changes are indexed nowhere (§22).
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
  const { supabase } = await requireUser();

  const confirmation = String(formData.get("confirm") ?? "").trim();
  if (confirmation !== "DELETE") {
    return { error: 'Type DELETE to confirm.' };
  }

  const { data, error } = await supabase.rpc("request_account_deletion" as never, {} as never);
  if (error) return { error: error.message };
  const result = data as unknown as { outcome?: string; job_id?: string; message?: string };
  if (result.outcome !== "cleanup_pending" || !result.job_id) {
    return { error: result.message ?? "Deletion needs review before cleanup can begin." };
  }
  // Revoke refresh sessions immediately; the database tombstone also blocks
  // direct writes with already-issued access tokens until their expiry.
  await supabase.auth.signOut({ scope: "global" });
  redirect(`/login?deletion=requested&reference=${result.job_id}`);
}

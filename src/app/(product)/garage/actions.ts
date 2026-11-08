"use server";

import { STALE_MOD_SHEET } from "@/lib/mods/sheet-revision";
import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";

import { slugify } from "@/lib/format";
import { ACTIVITY_TITLE_MAX } from "@/lib/limits";
import { blockMediaUrls, normalizeBlocks, type ActivityBlock } from "@/lib/activity-blocks";
import { deleteMediaIfUnreferenced, finalizeMediaUrls, scheduleMediaCleanup } from "@/lib/media-lifecycle";
import { isAllowedVideoUrl, isOwnedStorageUrl, keepValidImageUrls } from "@/lib/media-url";
import { MOD_CATEGORIES, type ModCategory } from "@/lib/mods/parse";
import { allowAction, rateLimitMessage, RATE_LIMITS } from "@/lib/rate-limit";
import type { PartLinkFields } from "@/lib/mods/part-link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { capture } from "@/lib/analytics";
import { reportError } from "@/lib/monitoring";
import { confirmIdentity } from "@/lib/confirm-identity";
import { signsInWithPassword } from "@/lib/reauthentication";

import { decodeVin, decodeVinResult } from "@/lib/vehicles/vpic";
import { matchCatalogByName, resolveCatalogSelection } from "@/lib/vehicles/catalog";
import type { Car, CarImage, Json, ModStatus } from "@/lib/database.types";
import { isKnownPlace } from "@/lib/geo/regions";
import { postHref } from "@/lib/activity/href";
import { SUSPENDED_MESSAGE, isSuspended } from "@/lib/suspension";

export type ActionState = {
  error?: string;
  ok?: string;
  href?: string;
  /** Deletion needs fresh proof it's the owner (N41): which kind to offer. */
  reauth?: "password" | "oauth";
};

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
    const result = await decodeVinResult(vin);
    if (result.status === "unavailable") {
      return {
        error:
          "VIN lookup is unavailable right now — choose the vehicle from the list or try later.",
      };
    }
    if (result.status === "undecoded") {
      return {
        error:
          "That VIN didn't decode. Check it, or choose the vehicle from the list instead.",
      };
    }
    decoded = result.decoded;
    make = decoded.make;
    model = decoded.model;
    year = year ?? decoded.year;
    identitySource = "vin";
  } else {
    make = String(formData.get("make") ?? "").trim() || null;
    model = String(formData.get("model") ?? "").trim() || null;
    // An empty manual form used to create a nameless "My car".
    if (!make && !nameInput) {
      return { error: "Enter at least the make — or give the car a name." };
    }
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
  const { data: existingCar, error: existingError } = await supabase
    .from("cars")
    .select("slug")
    .eq("id", id)
    .maybeSingle();
  if (existingError || !existingCar) return { error: "Car not found." };
  // The VIN isn't a readable column (20261004160000); the owner gets it here.
  const { data: existingVin, error: vinError } = await supabase.rpc("my_car_vin", { p_car: id });
  if (vinError) return { error: "Couldn't load this car. Nothing was changed — try again." };
  const existing = { ...existingCar, vin: existingVin ?? null };

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

/**
 * Which generation is this car? Asked on the sheet on a changeover year
 * (readiness 83; vehicles.md, "Generations"). The owner updates their own car
 * (RLS); car_generation_before_write keeps the choice only when it fits the
 * car's model and year and marks it 'owner' — so the row is checked after the
 * write rather than trusted.
 */
export async function setCarGeneration(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const carId = String(formData.get("car_id") ?? "");
  const generationId = Number(formData.get("generation_id"));
  if (!carId || !Number.isInteger(generationId) || generationId <= 0) return { error: "Pick a generation." };

  const { data: updated, error } = await supabase
    .from("cars")
    .update({ generation_id: generationId, updated_at: new Date().toISOString() })
    .eq("id", carId)
    .select("slug, generation_id, generation_source")
    .maybeSingle();
  if (error) {
    reportError("[garage] set generation failed", { carId, code: error.code });
    return { error: "Couldn't save that. Try again." };
  }
  if (!updated) return { error: "Car not found." };
  if (updated.generation_id !== generationId || updated.generation_source !== "owner") {
    return { error: "That generation doesn't fit this car's model and year." };
  }
  revalidatePath("/garage");
  revalidatePath(`/cars/${updated.slug}`);
  return { ok: "Generation saved." };
}

export async function deleteCar(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Car is missing." };
  const { error } = await supabase.from("cars").delete().eq("id", id);
  if (error) return { error: error.message };
  // The delete queued the car's photos (and its posts') for removal
  // (20261107203000); take them down now rather than at the next daily run.
  scheduleMediaCleanup(user.id);

  // Deleting an already-absent id is the desired state after a response was
  // lost. RLS still prevents this call from changing anybody else's car.
  revalidatePath("/garage");
  return { ok: "Car deleted.", href: "/garage" };
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
  /**
   * Whether the part is still on the car. Removing is a state, not a delete
   * (A-2): the editor keeps sending a removed line with its id, and the
   * database keeps the record so the build sheet can say "came off this car".
   * Omitting the line entirely is still how a true delete is expressed.
   */
  status?: ModStatus;
  /** Link-added parts (L-1…L-4). Round-tripped by the editor because these
   *  columns ARE in save_mod_items' column lists — dropping them from a save
   *  would silently clear a thumbnail the owner imported. */
  product_url?: string | null;
  image_url?: string | null;
  source_domain?: string | null;
  ref_price_cents?: number | null;
  /** No currency means no price; the database refuses the half-state. */
  ref_price_currency?: string | null;
  /** "What came off": a factory part that came off when a mod went on. */
  origin?: "aftermarket" | "stock";
};

/** The sheet exactly as save_mod_items receives it, so a lost save can be
 *  compared with what the database holds (mod_sheet_revision_if_matches). */
function modSheetPayload(items: ModItemInput[], userId: string) {
  // These three render on the public build page, so none is taken as typed:
  // the link must be http(s), the thumbnail must be one this member uploaded
  // (an arbitrary host is a tracking pixel on somebody's build), and the
  // domain shown beside the link is always the link's own.
  const linkOf = (raw: string | null | undefined) => {
    if (!raw) return null;
    try {
      const url = new URL(raw);
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  };
  return items.map((item) => {
    const link = linkOf(item.product_url);
    return {
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
    // `removed_at` is deliberately absent: the function derives it, so a line
    // that came off last month keeps that date through every later save.
    status: item.status === "removed" ? "removed" : "installed",
    product_url: link ? link.toString() : null,
    image_url: item.image_url && isOwnedStorageUrl(item.image_url, userId) ? item.image_url : null,
    source_domain: link ? link.hostname.replace(/^www\./, "").toLowerCase() : null,
    ref_price_cents:
      typeof item.ref_price_cents === "number" && Number.isFinite(item.ref_price_cents)
        ? Math.max(0, Math.round(item.ref_price_cents))
        : null,
    ref_price_currency: item.ref_price_currency ?? null,
    origin: item.origin === "stock" ? "stock" : "aftermarket",
    };
  });
}

/** Every write to a build line takes the sheet's lock (20261108110200); a
 *  write made elsewhere at the same instant can make the database roll one of
 *  them back whole. Nothing was written, so trying again is safe. */
const SHEET_WRITE_COLLIDED = "Another change to this build was saving at the same moment. Nothing was saved — try again.";

/**
 * Undoes the "release a part" link between a build line and the listing it
 * spawned (a listing pulled down or repurposed left "For sale" on the line).
 *
 * One database call (OS-W23 follow-up): unlink_mod_listing checks the sheet is
 * still the revision this editor loaded, unlinks under the sheet's lock and
 * hands back the revision that write produced. Reading the revision before
 * and after in separate requests let a line another tab added in between be
 * folded into the revision the editor adopted, and its next save deleted it.
 */
export async function unlinkModListing(
  carId: string,
  modItemId: string,
  expectedRevision: string
): Promise<ActionState & { revision?: string; stale?: boolean }> {
  const { supabase } = await requireUser();
  if (!carId || !modItemId) return { error: "Missing build line." };
  if (!expectedRevision) return { error: "Reload the build before changing it." };

  const { data, error } = await supabase.rpc("unlink_mod_listing", {
    p_car: carId,
    p_mod_item: modItemId,
    p_expected_revision: expectedRevision,
  });
  if (error?.code === "40001" && error.hint === "stale_mod_sheet") return { error: STALE_MOD_SHEET, stale: true };
  if (error?.code === "40P01") return { error: SHEET_WRITE_COLLIDED };
  if (error?.code === "42501") return { error: "That car isn't in your garage." };
  if (error?.code === "P0002") return { error: "That line isn't on this build any more. Reload to see the latest." };
  if (error) return { error: "Couldn't remove the link. Nothing changed — try again." };
  const done = data as unknown as { revision?: string; listing_id?: string | null } | null;
  if (!done?.revision) return { error: "Couldn't remove the link. Nothing changed — try again." };

  const { data: car } = await supabase.from("cars").select("slug").eq("id", carId).maybeSingle();
  revalidatePath(`/garage/${carId}/edit`);
  if (car?.slug) revalidatePath(`/cars/${car.slug}`);
  if (done.listing_id) revalidatePath(`/listings/${done.listing_id}`);
  return { ok: "Link removed.", revision: done.revision };
}

/**
 * N65 follow-up: after a save's response was lost, the editor asks whether
 * the sheet is exactly what that save sent. If so it gets the current
 * revision (its own write committed); otherwise null, and its next save is
 * still checked against the revision it loaded.
 */
export async function confirmLostModSave(carId: string, items: ModItemInput[]): Promise<string | null> {
  const { supabase, user } = await requireUser();
  if (!carId || items.length > 200) return null;
  const { data, error } = await supabase.rpc("mod_sheet_revision_if_matches", {
    p_car: carId,
    p_items: modSheetPayload(items, user.id),
  });
  return error ? null : (data ?? null);
}

/**
 * Saves the mod sheet.
 *
 * One database function applies the whole desired sheet transactionally.
 * Existing ids update in place so listing links survive; stable new ids make a
 * repeated request converge after a committed response is lost.
 */
export async function saveModItems(
  carId: string,
  items: ModItemInput[],
  expectedRevision: string
): Promise<ActionState & { revision?: string; stale?: boolean }> {
  const { supabase, user } = await requireUser();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!carId || !expectedRevision || items.length > 200 || items.some((item) => !uuid.test(item.id))) {
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

  const payload = modSheetPayload(items, user.id);
  const { data, error } = await supabase.rpc("save_mod_items", {
    p_car_id: carId,
    p_items: payload,
    p_expected_revision: expectedRevision,
  });
  if (error?.code === "40001" && error.hint === "stale_mod_sheet") return { error: STALE_MOD_SHEET, stale: true };
  if (error?.code === "40P01") return { error: SHEET_WRITE_COLLIDED };
  if (error) return { error: error.message };
  const saved = data as unknown as { outcome?: string; revision?: string } | null;
  if (saved?.outcome !== "saved") {
    return { error: "The modification sheet was not saved." };
  }

  // Mods are searchable build content (brief §20) — resync the car's document.
  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath(`/cars/${car.slug}`);
  return { ok: "Build saved.", revision: saved.revision };
}

/**
 * L-1: "Add mod" opens on *Paste a product link*.
 *
 * Throttled well below the listing importer's limit in cost but above it in
 * count (`RATE_LIMITS.fetchPartLink`, 30/hour): one page fetch and one
 * thumbnail is cheap, and somebody filling in a build sheet in one sitting
 * pastes a lot of links. A refusal is never fatal — typing the part in stays
 * first-class, which is why every failure here returns a sentence the editor
 * can show beside the field rather than throwing.
 */
export async function readPartLink(url: string): Promise<
  { ok: true; part: PartLinkFields } | { ok: false; error: string }
> {
  const { user } = await requireUser();
  const trimmed = (url ?? "").trim();
  if (!trimmed || trimmed.length > 2000) {
    return { ok: false, error: "Paste a link to the part's page." };
  }
  if (!(await allowAction(RATE_LIMITS.fetchPartLink, user.id))) {
    return { ok: false, error: rateLimitMessage(RATE_LIMITS.fetchPartLink) };
  }
  const { fetchPartLink } = await import("@/lib/mods/part-link");
  const result = await fetchPartLink(trimmed, user.id);
  if (!result.ok) return { ok: false, error: result.error };
  // The mod line's fields only: where the fetch landed is the agent's provenance, not part of the line.
  const { ok, fetched_url: fetchedUrl, ...part } = result;
  void fetchedUrl;
  return { ok, part };
}

/**
 * P-5. Which car this member actually means.
 *
 * The database refuses a car that isn't theirs (the 20260919181500 trigger);
 * this checks first so the refusal is a sentence rather than a 500. Setting
 * it to null is ordinary — "no main car" is a real answer, and every reader
 * falls back to newest-first.
 */
export async function setMainCar(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const raw = String(formData.get("car_id") ?? "").trim();
  const carId = raw || null;

  if (carId) {
    const { data: car } = await supabase
      .from("cars")
      .select("id, owner_id")
      .eq("id", carId)
      .maybeSingle();
    if (!car || car.owner_id !== user.id) return { error: "That car isn't in your garage." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ main_car_id: carId })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/garage");
  revalidatePath("/home");
  revalidatePath("/profile");
  return { ok: carId ? "Main car set." : "Main car cleared." };
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
  return { result: data as { ok: boolean; image?: CarImage; deleted_url?: string | null }, userId: user.id };
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
  if (changed.result?.deleted_url) await deleteMediaIfUnreferenced(changed.result.deleted_url, false, changed.userId);
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
 * label. N66: replaced by one database function in one transaction
 * (replace_car_showcase), which checks the owner, the photo and every pin's
 * part before touching anything — a failed save leaves the old showcase.
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

  const { error } = await supabase.rpc("replace_car_showcase", {
    p_car: carId,
    p_image_url: imageUrl,
    p_pins: sane,
  });
  if (error) {
    // The function's own refusals are written for the member (22023).
    return { error: error.code === "22023" ? error.message : "Couldn't save the showcase. Your previous one is unchanged." };
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

/**
 * W-1 — a quick post: pick a car, one to six photos, a caption, Post.
 *
 * It uses the database's `quick` write mode, which returns before the draft
 * lookup that `publish` does. That is the whole point and it is
 * release-blocking: somebody halfway through a long update must not lose it
 * because they fired off a photo of their new wheels. The guard test
 * (`supabase/tests/activity_quick_post_guard.sql`) proves the draft survives
 * byte for byte.
 *
 * The operation id makes a lost response replay rather than double-post,
 * exactly as the full publish path does.
 */
/** The editor's tagged parts: null when the form didn't send the field. */
function parseListingIds(formData: FormData): string[] | null {
  const raw = formData.get("listing_ids");
  if (typeof raw !== "string") return null;
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export async function createQuickPost(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();

  // W-5: no car is a legitimate choice — the post is then about the parts it
  // tags. The empty string is what the picker sends for "no car".
  const carId = String(formData.get("car_id") ?? "") || null;
  const operationId = String(formData.get("operation_id") ?? "");
  const caption = String(formData.get("caption") ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    return { error: "Refresh this page before posting." };
  }
  if (caption.length > 2000) return { error: "Keep the caption under 2000 characters." };

  const { data: car } = carId
    ? await supabase.from("cars").select("id, slug, owner_id").eq("id", carId).maybeSingle()
    : { data: null };
  if (carId && (!car || car.owner_id !== user.id)) {
    return { error: "That car isn't in your garage." };
  }

  // W-2: a photo is required. Checked here so the member gets a sentence
  // rather than a database error, and again in SQL so it is actually true.
  const photos = keepValidImageUrls(
    String(formData.get("photos") ?? "")
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean),
    6,
    user.id
  );
  if (!photos.length) return { error: "Add at least one photo." };

  const listingIds = String(formData.get("listing_ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 3);

  // The rule that makes a carless post a post: it has to be about something.
  if (!carId && !listingIds.length) {
    return { error: "Pick a car, or tag a part this post is about." };
  }

  const blocks = caption ? [{ type: "text" as const, style: "normal" as const, text: caption }] : [];

  const { data: post, error } = await supabase
    .rpc("write_activity_post", {
      p_mode: "quick",
      p_post_id: operationId,
      // Null is a real argument here, not a missing one (W-5) — Postgres
      // can't express a nullable parameter, so the generated type says
      // `string` for every argument and this is the one place it lies.
      p_car_id: carId as unknown as string,
      // A quick post has no title. The function treats an empty string as
      // "none" (nullif) rather than storing a blank heading.
      p_title: "",
      p_body: activityBlocksJson(blocks),
      p_image_urls: photos,
      p_listing_ids: listingIds.length ? listingIds : undefined,
    })
    .single();
  if (error || !post) {
    if (await isSuspended(supabase, user.id)) return { error: SUSPENDED_MESSAGE };
    reportError("[activity] quick post failed", { carId, operationId, error });
    return { error: "Couldn't confirm the post. Try again — repeating it is safe." };
  }

  await finalizeMediaUrls(supabase, photos);
  capture(user.id, { event: "quick_post_published", props: { photos: photos.length, tagged: listingIds.length } });

  revalidatePath("/home");
  if (car?.slug) revalidatePath(`/cars/${car.slug}`);
  return { ok: "Posted.", href: postHref({ id: post.post_id, carSlug: car?.slug ?? null }) };
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

  // W-2: every published update has a photo. Said here as a sentence,
  // because the database's refusal reaches the member as "couldn't confirm
  // this was published" — true, and no help at all. A before/after pair is
  // a photo too: when there is no photo set, its sides stand as the cover.
  let imageUrls = blocks.flatMap((b) => (b.type === "images" ? b.urls : []));
  if (!imageUrls.length) imageUrls = blockMediaUrls(blocks).slice(0, 24);
  if (!imageUrls.length) return { error: "Add at least one photo before you publish." };
  // W-3 in the full editor: up to three of the author's own parts (the
  // database checks they are theirs and active).
  const listingIds = parseListingIds(formData);
  const { data: post, error } = await supabase
    .rpc("write_activity_post", {
      p_mode: "publish",
      p_post_id: operationId,
      p_car_id: carId,
      p_title: title,
      p_body: activityBlocksJson(blocks),
      p_image_urls: imageUrls,
      p_listing_ids: listingIds?.length ? listingIds : undefined,
    })
    .single();
  if (error || !post) {
    if (await isSuspended(supabase, user.id)) return { error: SUSPENDED_MESSAGE };
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
    if (await isSuspended(supabase, user.id)) return { error: SUSPENDED_MESSAGE };
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
 * Throws away the car's unpublished draft (social-15). A draft used to sit
 * behind "Continue your draft" until it was published; nothing else could
 * end it. Deleted rather than archived: nobody has seen it, and a draft is
 * "where I left off", not a record. Photos only the draft used go too.
 */
export async function discardActivityDraft(carId: string): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  if (!carId) return { error: "Draft not found." };

  const { data: drafts, error } = await supabase
    .from("activity_posts")
    .delete()
    .eq("car_id", carId)
    .eq("author_id", user.id)
    .is("published_at", null)
    .select("id, body");
  if (error) {
    reportError("[activity] draft discard failed", { carId, error });
    return { error: "Couldn't discard the draft. Try again." };
  }

  for (const draft of drafts ?? []) {
    for (const url of blockMediaUrls(normalizeBlocks(draft.body))) await deleteMediaIfUnreferenced(url, false, user.id);
  }

  revalidatePath("/home");
  revalidatePath(`/garage/${carId}/update/new`);
  return { ok: "Draft discarded.", href: "/home" };
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
  if (!postId) return { error: "Update not found." };
  if (title.length > ACTIVITY_TITLE_MAX) return { error: `Keep the title under ${ACTIVITY_TITLE_MAX} characters.` };

  const { data: post } = await supabase
    .from("activity_posts")
    .select("id, car_id, author_id, title, body")
    .eq("id", postId)
    .maybeSingle();
  if (!post || post.author_id !== user.id) return { error: "Update not found." };
  // W-1: a quick post never had a title, and correcting one mustn't demand
  // it. A post that has a title still can't be edited down to none.
  if (!title && post.title?.trim()) return { error: "A title is required." };

  // W-5: a post about a part has no car to look up.
  const { data: car } = post.car_id
    ? await supabase.from("cars").select("slug").eq("id", post.car_id).maybeSingle()
    : { data: null };

  const listingIds = parseListingIds(formData);
  if (listingIds && !listingIds.length && !post.car_id) {
    return { error: "A post with no car has to tag a part — keep at least one." };
  }

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

    // A quick post's photos live in the gallery and in no block, so the
    // editor never sees them and would hand back a body without them — and
    // the save would then delete them from storage. Photos that were never
    // in a block aren't the editor's to drop: they are carried through.
    const { normalizeBlocks: normalizePrior } = await import("@/lib/activity-blocks");
    const priorBlockUrls = new Set(
      normalizePrior(post.body ?? []).flatMap((b) => (b.type === "images" ? b.urls : []))
    );
    // The edit page now hands those photos to the editor as a photos block,
    // so a body that arrives WITH photos is the member's full choice
    // (including removals). Only a body without any is topped up.
    if (!imageUrls.length) {
      const loose = previousImages.map((i) => i.url).filter((url) => !priorBlockUrls.has(url));
      imageUrls = [...new Set(loose)];
    }
  }

  const { error } = await supabase.rpc("write_activity_post", {
    p_mode: "update",
    p_post_id: postId,
    // Null is a real argument for a carless post (W-5); see createQuickPost.
    p_car_id: post.car_id as unknown as string,
    p_title: title,
    ...(body === undefined ? {} : {
      p_body: activityBlocksJson(body),
      p_image_urls: imageUrls ?? [],
    }),
    p_intro: String(formData.get("intro") ?? "").trim() || undefined,
    p_video_url: videoUrl || undefined,
    // Sent only when the editor's tags were changed; an empty list clears
    // them (refused for a carless post, which needs a part to be about).
    ...(listingIds === null ? {} : { p_listing_ids: listingIds }),
  });
  if (error) {
    if (await isSuspended(supabase, user.id)) return { error: SUSPENDED_MESSAGE };
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
      if (!kept.has(prev.url)) await deleteMediaIfUnreferenced(prev.url, false, user.id);
    }
  }

  revalidatePath(`/garage/${post.car_id}/edit`);
  if (car) {
    revalidatePath(`/cars/${car.slug}`);
    revalidatePath(`/cars/${car.slug}/activity/${postId}`);
  } else {
    // W-5: a carless post lives at its own address.
    revalidatePath(`/posts/${postId}`);
  }
  return { ok: "Update saved." };
}

export async function deleteActivityPost(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const postId = String(formData.get("post_id") ?? "");
  const requestedCarId = String(formData.get("car_id") ?? "");
  if (!postId) return { error: "Missing entry." };

  const { data: post, error: postError } = await supabase
    .from("activity_posts")
    .select("id, car_id, author_id")
    .eq("id", postId)
    .maybeSingle();
  if (postError) {
    reportError("[activity] delete lookup failed", { postId, error: postError });
    return { error: "Couldn't confirm whether the entry was deleted. Try again." };
  }
  // An absent post is the desired state after a committed delete response was
  // lost. The caller may only navigate back to the car id already present in
  // its authenticated edit form; no row is changed in this replay branch.
  if (!post) {
    // A carless post's editor sends `no-car` here (W-5): there is no car
    // sheet to go back to, so a replayed delete lands on Home.
    if (requestedCarId === "no-car") return { ok: "Entry deleted.", href: "/home" };
    if (!requestedCarId) return { error: "Entry not found." };
    const { data: ownedCar, error: ownedCarError } = await supabase
      .from("cars")
      .select("id")
      .eq("id", requestedCarId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (ownedCarError) {
      reportError("[activity] delete replay car lookup failed", {
        postId,
        carId: requestedCarId,
        error: ownedCarError,
      });
      return { error: "Couldn't confirm whether the entry was deleted. Try again." };
    }
    if (!ownedCar) return { error: "Entry not found." };
    revalidatePath(`/garage/${requestedCarId}/edit`);
    return { ok: "Entry deleted.", href: `/garage/${requestedCarId}/edit` };
  }
  if (post.author_id !== user.id) return { error: "Entry not found." };

  const { data: car } = post.car_id
    ? await supabase.from("cars").select("slug").eq("id", post.car_id).maybeSingle()
    : { data: null };

  const { error } = await supabase.from("activity_posts").delete().eq("id", postId);
  if (error) return { error: error.message };
  // Its photos were queued by the delete; remove the unreferenced ones now.
  scheduleMediaCleanup(user.id);

  // W-5: a post about a part has no car sheet to go back to.
  if (!post.car_id) {
    revalidatePath("/home");
    return { ok: "Entry deleted.", href: "/home" };
  }
  revalidatePath(`/garage/${post.car_id}/edit`);
  if (car) revalidatePath(`/cars/${car.slug}`);
  return { ok: "Entry deleted.", href: `/garage/${post.car_id}/edit` };
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
    // Members can update only some profile columns; updated_at isn't one of
    // them, and sending it made Postgres refuse the whole save.
    .update({ notification_prefs: prefs })
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

  // H-2: Settings carries country/region; the profile editor doesn't. Only
  // write them when the submitting form actually holds them, so the shorter
  // form can't blank a place the member set elsewhere.
  let place: { country: string | null; region: string | null } | null = null;
  if (formData.has("country")) {
    const country = String(formData.get("country") ?? "").trim() || null;
    const region = String(formData.get("region") ?? "").trim() || null;
    if (country && !isKnownPlace(country, region)) {
      return { error: "Pick a country and region from the list." };
    }
    place = { country, region: country ? region : null };
  }

  // P-9: a default for the sell form. Percent of the asking price, and a
  // floor below 10% is a typo rather than an intent.
  let offerFloor: { default_offer_floor_pct: number | null } | null = null;
  if (formData.has("default_offer_floor_pct")) {
    const raw = String(formData.get("default_offer_floor_pct") ?? "").trim();
    if (!raw) {
      offerFloor = { default_offer_floor_pct: null };
    } else {
      const pct = Number(raw);
      if (!Number.isInteger(pct) || pct < 10 || pct > 100) {
        return { error: "Lowest offer must be a whole number between 10 and 100." };
      }
      offerFloor = { default_offer_floor_pct: pct };
    }
  }

  // P-8: one line above the parts grid. Voice, not policy — the database
  // caps it at 180. Written only by a form that carries it, like the rest.
  let storeNote: { store_note: string | null } | null = null;
  if (formData.has("store_note")) {
    const note = String(formData.get("store_note") ?? "").replace(/\s+/g, " ").trim();
    if (note.length > 180) return { error: "Keep the store note under 180 characters." };
    storeNote = { store_note: note || null };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      headline: String(formData.get("headline") ?? "").trim() || null,
      bio: bio || null,
      location: String(formData.get("location") ?? "").trim() || null,
      links,
      ...(place ?? {}),
      ...(offerFloor ?? {}),
      ...(storeNote ?? {}),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  if (avatarUrl) {
    await finalizeMediaUrls(supabase, [avatarUrl]);
    if (previousAvatarUrl && previousAvatarUrl !== avatarUrl) {
      await deleteMediaIfUnreferenced(previousAvatarUrl, false, user.id);
    }
  }

  // Identity fields (display name, headline) are the account-search
  // projection — resync. Location/bio changes are indexed nowhere (§22).
  revalidatePath("/profile");
  revalidatePath("/settings");
  // Local reads the member's region, so a place change changes Home.
  if (place) revalidatePath("/home");

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
  // N41: typing DELETE proves nothing about who is at the session. The
  // password typed now, or a Google sign-in moments ago, is checked
  // server-side before the request is made; request_account_deletion()
  // refuses a token without a sign-in in the last ten minutes on its own,
  // so calling the RPC directly with an old token gets nowhere either.
  const identity = await confirmIdentity(supabase, user, String(formData.get("current_password") ?? ""));
  if (!identity.ok) return { error: identity.error, reauth: identity.reauth };

  const { data, error } = await supabase.rpc("request_account_deletion");
  if (error) {
    // N49: the database's wording stays in telemetry.
    // The database checks the same freshness itself (20261107200450), so a
    // token that went stale between the two checks is asked again too.
    if (error.code === "42501" && /recent sign-in required/i.test(error.message ?? "")) {
      const reauth = signsInWithPassword(user.app_metadata) ? "password" : "oauth";
      return {
        error: reauth === "password" ? "Enter your password to confirm it's you." : "Confirm it's you with Google first, then try again.",
        reauth,
      };
    }
    // N39: a suspension no longer stops a deletion request; only one
    // already underway does (20261107220400).
    if (error.code === "42501" && /suspended/i.test(error.message ?? "")) {
      return { error: "Your account's deletion is already underway." };
    }
    reportError("[settings] account deletion request failed", { userId: user.id, error });
    return { error: "Couldn't request deletion. Nothing was changed — try again." };
  }
  const result = data as unknown as { outcome?: string; job_id?: string; message?: string };
  if (result.outcome !== "cleanup_pending" || !result.job_id) {
    return { error: result.message ?? "Deletion needs review before cleanup can begin." };
  }
  // Revoke refresh sessions immediately; the database tombstone also blocks
  // direct writes with already-issued access tokens until their expiry.
  await supabase.auth.signOut({ scope: "global" });
  redirect(`/login?deletion=requested&reference=${result.job_id}`);
}

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { isOwnedStorageUrl } from "@/lib/media-url";
import { memberLink, safeProductLink } from "@/lib/mods/safe-link";
import { LOW_CONFIDENCE_THRESHOLD, MOD_CATEGORIES, parsePasteText } from "@/lib/mods/parse";
import { RATE_LIMITS, allowAction } from "@/lib/rate-limit";

import { CapabilityError, defineCapability } from "./types";

/**
 * "Update my build" (agent plan AG-9, A3c): the reads and the one draft the
 * model needs to turn "just fitted KW V3s" or a product link into a mod
 * change. Nothing here writes the build. propose_build_change returns a
 * proposal the chat shows as a confirm card; the member's Confirm saves it
 * through the mods editor's own save (saveModItems, with its replace
 * semantics), and Edit opens the editor with the line filled in.
 */

const id = z.uuid();

export const listMyCars = defineCapability({
  name: "list_my_cars",
  description: "The owner's own cars: id, name, make, model, year, and which one is their main car. Use the id with read_my_car.",
  risk: "R0",
  scopes: ["buyer", "garage", "seller"],
  input: z.object({}),
  output: z.array(z.object({ id, name: z.string(), make: z.string().nullable(), model: z.string().nullable(), year: z.number().int().nullable(), main: z.boolean() })),
  async run({ supabase, context }) {
    const owner = context.principal.memberId;
    const [cars, profile] = await Promise.all([
      supabase.from("cars").select("id,name,make,model,year").eq("owner_id", owner).order("created_at", { ascending: false }).limit(20),
      supabase.from("profiles").select("main_car_id").eq("id", owner).maybeSingle(),
    ]);
    if (cars.error) throw new CapabilityError("failed", "Cars are unavailable", cars.error);
    const main = profile.data?.main_car_id ?? null;
    return (cars.data ?? []).map((car) => ({ id: car.id, name: car.name, make: car.make, model: car.model, year: car.year, main: car.id === main }));
  },
});

export const readPartLink = defineCapability({
  name: "read_part_link",
  description: "Read a product page the member pasted: brand, product, part number and category, the way the mods editor's Paste a link does. Only for a link in the member's own message. Its productUrl is the page DRVN fetched (the member's link or where it redirected), the one to draft.",
  // R1: it fetches a page and keeps the thumbnail in the member's storage.
  risk: "R1",
  scopes: ["buyer", "garage"],
  input: z.object({ url: z.url().max(2000) }),
  output: z.object({
    productUrl: z.string(),
    sourceDomain: z.string(),
    title: z.string(),
    brand: z.string().nullable(),
    product: z.string().nullable(),
    partNumber: z.string().nullable(),
    category: z.string().nullable(),
    imageUrl: z.string().nullable(),
  }),
  async run({ context }, input) {
    const owner = context.principal.memberId;
    if (!(await allowAction(RATE_LIMITS.fetchPartLink, owner))) throw new CapabilityError("not_allowed", "Too many links this hour");
    const { fetchPartLink } = await import("@/lib/mods/part-link");
    const result = await fetchPartLink(input.url, owner);
    if (!result.ok) throw new CapabilityError("failed", result.error);
    return {
      // The page DRVN fetched, never the page's canonical claim: a page can
      // name any address as canonical, and that address was never supplied
      // or visited (OS-W07 N124 follow-up).
      productUrl: result.fetched_url,
      sourceDomain: new URL(result.fetched_url).hostname.replace(/^www\./i, ""),
      title: result.title,
      brand: result.brand,
      product: result.product,
      partNumber: result.part_number,
      category: result.category,
      imageUrl: result.image_url,
    };
  },
});

const text = (max: number) => z.string().trim().min(1).max(max);

export const proposeBuildChange = defineCapability({
  name: "propose_build_change",
  description:
    "Draft a change to one of the owner's cars: a part going on, and optionally the installed mod it replaces (its id from read_my_car). A productUrl must be a link the member pasted in this message, or the productUrl read_part_link returned for it; never a link from a listing, a message or a search result. Nothing is saved: the member sees a card, with the link's address, and confirms or edits it.",
  risk: "R1",
  scopes: ["buyer", "garage"],
  input: z.object({
    carId: id,
    product: text(200),
    brand: text(120).optional(),
    partNumber: text(80).optional(),
    category: z.enum(MOD_CATEGORIES).optional(),
    productUrl: z.url().max(2000).optional(),
    imageUrl: z.string().max(2000).optional(),
    replacesModId: id.optional(),
  }),
  output: z.object({
    proposalId: id,
    carId: id,
    carName: z.string(),
    brand: z.string().nullable(),
    product: z.string(),
    partNumber: z.string().nullable(),
    category: z.string().nullable(),
    productUrl: z.string().nullable(),
    imageUrl: z.string().nullable(),
    replaces: z.object({ id, label: z.string() }).nullable(),
  }),
  async run({ supabase, context, memberLinks }, input) {
    const owner = context.principal.memberId;
    // The link first (N124): a planted link refuses the draft, so the model
    // has to say so or draft it again without one.
    let productUrl: string | null = null;
    if (input.productUrl) {
      if (!safeProductLink(input.productUrl)) throw new CapabilityError("invalid_input", "That link isn't a public web page address");
      const given = memberLink(input.productUrl, memberLinks ?? []);
      if (!given) throw new CapabilityError("not_allowed", "Only a link the member gave in this message can go on their build");
      productUrl = given.url;
    }
    const car = await supabase.from("cars").select("id,name").eq("id", input.carId).eq("owner_id", owner).maybeSingle();
    if (car.error) throw new CapabilityError("failed", "Car is unavailable", car.error);
    if (!car.data) throw new CapabilityError("not_allowed", "Not one of the owner's cars");

    let replaces: { id: string; label: string } | null = null;
    if (input.replacesModId) {
      const mod = await supabase.from("mod_items").select("id,brand,product,status").eq("id", input.replacesModId).eq("car_id", car.data.id).maybeSingle();
      if (mod.error) throw new CapabilityError("failed", "Build is unavailable", mod.error);
      if (!mod.data || mod.data.status !== "installed") throw new CapabilityError("invalid_input", "That part isn't on this car");
      replaces = { id: mod.data.id, label: [mod.data.brand, mod.data.product].filter(Boolean).join(" ") || "the old part" };
    }

    // A thumbnail is only ever one the member's own link read stored; any
    // other address would be a tracking pixel on their build page.
    const imageUrl = input.imageUrl && isOwnedStorageUrl(input.imageUrl, owner) ? input.imageUrl : null;
    return {
      proposalId: randomUUID(),
      carId: car.data.id,
      carName: car.data.name,
      brand: input.brand ?? null,
      product: input.product,
      partNumber: input.partNumber ?? null,
      category: input.category ?? null,
      productUrl,
      imageUrl,
      replaces,
    };
  },
});

/** The most lines one pasted list drafts at once (the editor takes the rest). */
export const MAX_DRAFT_LINES = 40;

/**
 * "Paste your build" (A3d): a pasted build list becomes mod lines, split by
 * the mods editor's own parser (parsePasteText), so the agent and the
 * editor's Paste a list agree on every line and its confidence. A draft:
 * nothing is saved until the member confirms the card.
 */
export const draftBuildList = defineCapability({
  name: "draft_build_list",
  description:
    "Turn a build list the member pasted (forum post, notes) into mod lines on one of their cars, using DRVN's own parser. Pass the member's text unchanged. Nothing is saved: the member sees a card and confirms or edits it.",
  risk: "R1",
  scopes: ["buyer", "garage"],
  input: z.object({ carId: id, text: z.string().trim().min(3).max(8000) }),
  output: z.object({
    proposalId: id,
    carId: id,
    carName: z.string(),
    lines: z.array(
      z.object({
        id,
        group_label: z.string(),
        brand: z.string().nullable(),
        product: z.string().nullable(),
        part_number: z.string().nullable(),
        category: z.string().nullable(),
        confidence: z.number().min(0).max(1),
      }),
    ),
    truncated: z.boolean(),
    toCheck: z.number().int().nonnegative(),
  }),
  async run({ supabase, context }, input) {
    const owner = context.principal.memberId;
    const car = await supabase.from("cars").select("id,name").eq("id", input.carId).eq("owner_id", owner).maybeSingle();
    if (car.error) throw new CapabilityError("failed", "Car is unavailable", car.error);
    if (!car.data) throw new CapabilityError("not_allowed", "Not one of the owner's cars");
    const parsed = parsePasteText(input.text).filter((row) => row.brand || row.product);
    if (!parsed.length) throw new CapabilityError("invalid_input", "No parts found in that text");
    const lines = parsed.slice(0, MAX_DRAFT_LINES).map((row) => ({
      id: randomUUID(),
      group_label: row.group_label,
      brand: row.brand.slice(0, 120) || null,
      product: row.product.slice(0, 200) || null,
      part_number: row.part_number.slice(0, 80) || null,
      category: row.category,
      confidence: Math.round(row.confidence * 100) / 100,
    }));
    return {
      proposalId: randomUUID(),
      carId: car.data.id,
      carName: car.data.name,
      lines,
      truncated: parsed.length > MAX_DRAFT_LINES,
      toCheck: lines.filter((line) => line.confidence < LOW_CONFIDENCE_THRESHOLD).length,
    };
  },
});

/**
 * "List the parts that came off" (A3d): parts marked removed on the member's
 * own cars that aren't listed yet. Each becomes a card that opens the sell
 * form prefilled from that line (fitment from the car); the member adds
 * condition and photos and publishes. Nothing is drafted here.
 */
export const findPartsToList = defineCapability({
  name: "find_parts_to_list",
  description: "Parts that came off the owner's cars and aren't listed for sale yet: each with its car. The member lists one from its card.",
  risk: "R0",
  scopes: ["buyer", "garage", "seller"],
  input: z.object({}),
  output: z.array(z.object({ modId: id, carId: id, carName: z.string(), label: z.string() })),
  async run({ supabase, context }) {
    const owner = context.principal.memberId;
    const cars = await supabase.from("cars").select("id,name").eq("owner_id", owner).limit(20);
    if (cars.error) throw new CapabilityError("failed", "Cars are unavailable", cars.error);
    const names = new Map((cars.data ?? []).map((car) => [car.id, car.name]));
    if (!names.size) return [];
    const mods = await supabase
      .from("mod_items")
      .select("id,car_id,brand,product,removed_at")
      .in("car_id", [...names.keys()])
      .eq("status", "removed")
      .is("linked_listing_id", null)
      .order("removed_at", { ascending: false })
      .limit(10);
    if (mods.error) throw new CapabilityError("failed", "Builds are unavailable", mods.error);
    return (mods.data ?? []).map((mod) => ({
      modId: mod.id,
      carId: mod.car_id,
      carName: names.get(mod.car_id) ?? "",
      label: [mod.brand, mod.product].filter(Boolean).join(" ") || "A part",
    }));
  },
});

/** The photos a draft uses: indexes into the message's own attachments, never addresses. */
const photoIndexes = z.array(z.number().int().min(0).max(3)).min(1).max(4);

function pickPhotos(attachments: readonly string[] | undefined, indexes: number[]): string[] {
  const chosen = [...new Set(indexes)].map((index) => attachments?.[index]).filter((url): url is string => typeof url === "string");
  if (!chosen.length) throw new CapabilityError("invalid_input", "Those photos aren't on this message");
  return chosen;
}

/**
 * "Listing from photos" (A3d): what the member's photos show, as the start of
 * a listing. Only what can be seen: a title, the brand and part number when
 * a label shows them, a category. Never a price and never a condition: the
 * sell form asks the member for those. Nothing is saved: the card opens the
 * sell form filled in.
 */
export const draftListingFromPhotos = defineCapability({
  name: "draft_listing_from_photos",
  description:
    "Start a listing from the member's photos on this message: a title for the part, and the brand and part number only if a label in a photo shows them. Never a price or condition. The member checks and finishes it on the sell form.",
  risk: "R1",
  scopes: ["buyer", "garage", "seller"],
  input: z.object({
    title: text(140),
    brand: text(80).optional(),
    partNumber: text(80).optional(),
    category: z.enum(MOD_CATEGORIES).optional(),
    photos: photoIndexes,
  }),
  output: z.object({ proposalId: id, title: z.string(), brand: z.string().nullable(), partNumber: z.string().nullable(), category: z.string().nullable(), images: z.array(z.string()) }),
  async run({ attachments }, input) {
    return {
      proposalId: randomUUID(),
      title: input.title,
      brand: input.brand ?? null,
      partNumber: input.partNumber ?? null,
      category: input.category ?? null,
      images: pickPhotos(attachments, input.photos),
    };
  },
});

/**
 * "Post an update" (A3d): today's photos and a sentence become a draft build
 * update on one of the member's cars, with the parts on that car it's about.
 * Nothing is saved: the card opens the update composer filled in, and the
 * member publishes.
 */
export const draftCarUpdate = defineCapability({
  name: "draft_car_update",
  description:
    "Draft a build update on one of the member's cars from their photos on this message and what they said: a short title, a sentence or two in their words, and the mod ids on that car it's about (from read_my_car). The member publishes it.",
  risk: "R1",
  scopes: ["buyer", "garage"],
  input: z.object({
    carId: id,
    title: text(140),
    body: z.string().trim().max(2000).default(""),
    photos: photoIndexes,
    modIds: z.array(id).max(5).default([]),
  }),
  output: z.object({ proposalId: id, carId: id, carName: z.string(), title: z.string(), body: z.string(), images: z.array(z.string()), modIds: z.array(id) }),
  async run({ supabase, context, attachments }, input) {
    const owner = context.principal.memberId;
    const car = await supabase.from("cars").select("id,name").eq("id", input.carId).eq("owner_id", owner).maybeSingle();
    if (car.error) throw new CapabilityError("failed", "Car is unavailable", car.error);
    if (!car.data) throw new CapabilityError("not_allowed", "Not one of the owner's cars");
    let modIds: string[] = [];
    if (input.modIds.length) {
      const mods = await supabase.from("mod_items").select("id").eq("car_id", car.data.id).in("id", input.modIds);
      if (mods.error) throw new CapabilityError("failed", "Build is unavailable", mods.error);
      modIds = (mods.data ?? []).map((mod) => mod.id);
    }
    return {
      proposalId: randomUUID(),
      carId: car.data.id,
      carName: car.data.name,
      title: input.title,
      body: input.body,
      images: pickPhotos(attachments, input.photos),
      modIds,
    };
  },
});

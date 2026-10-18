import { randomUUID } from "node:crypto";

import { z } from "zod";

import { isOwnedStorageUrl } from "@/lib/media-url";
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
  description: "Read a product page the member pasted: brand, product, part number and category, the way the mods editor's Paste a link does. Only for a link in the member's own message.",
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
      productUrl: result.product_url,
      sourceDomain: result.source_domain,
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
    "Draft a change to one of the owner's cars: a part going on, and optionally the installed mod it replaces (its id from read_my_car). Nothing is saved: the member sees a card and confirms or edits it.",
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
  async run({ supabase, context }, input) {
    const owner = context.principal.memberId;
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
    const productUrl = input.productUrl && /^https?:\/\//i.test(input.productUrl) ? input.productUrl : null;
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

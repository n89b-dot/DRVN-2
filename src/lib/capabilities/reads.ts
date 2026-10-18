import { z } from "zod";

import { CapabilityError, defineCapability } from "./types";

/**
 * Composable reads (agent plan A2): small, typed answers a model can combine
 * — search, a listing, the owner's car, and the graph-backed product, fitment
 * evidence and price comparables. All R0, all through the member's own client,
 * so row security decides what each one sees. The graph-backed three answer
 * "not enough evidence yet" until B1 lands (products, product_fitments and
 * paid-and-completed comparables); the shapes are final so A4 can rely on them.
 */

const id = z.uuid();
const cents = z.number().int().nonnegative();

export const listingSummary = z.object({
  id,
  title: z.string(),
  priceCents: cents,
  currency: z.string(),
  condition: z.string().nullable(),
  brand: z.string().nullable(),
  partNumber: z.string().nullable(),
  category: z.string(),
  shippingCents: cents,
});

export const searchParts = defineCapability({
  name: "search_parts",
  description: "Search the parts for sale on DRVN by words, a part number or a brand. Returns up to 20 active listings.",
  risk: "R0",
  scopes: ["seller", "buyer", "garage"],
  input: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(20).default(10) }),
  output: z.array(listingSummary),
  async run({ supabase }, input) {
    const { data, error } = await supabase
      .rpc("marketplace_search_browse_rows", { p_query: input.query })
      .select("id,title,price_cents,currency,condition,brand,part_number,category,shipping_cents")
      .limit(input.limit);
    if (error) throw new CapabilityError("failed", "Search is unavailable", error);
    return (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      priceCents: row.price_cents,
      currency: row.currency,
      condition: row.condition,
      brand: row.brand,
      partNumber: row.part_number,
      category: row.category,
      shippingCents: row.shipping_cents,
    }));
  },
});

export const readListing = defineCapability({
  name: "read_listing",
  description: "Read one listing's public facts: title, description, price, shipping, condition, brand and part number.",
  risk: "R0",
  scopes: ["seller", "buyer", "garage"],
  input: z.object({ listingId: id }),
  output: listingSummary.extend({ description: z.string().nullable(), status: z.string() }).nullable(),
  async run({ supabase }, input) {
    // Explicit columns: never the minimum, the seller's private terms or any address.
    const { data, error } = await supabase
      .from("listings")
      .select("id,title,description,price_cents,currency,condition,brand,part_number,category,shipping_cents,status")
      .eq("id", input.listingId)
      .maybeSingle();
    if (error) throw new CapabilityError("failed", "Listing is unavailable", error);
    if (!data) return null;
    return {
      id: data.id,
      title: data.title,
      description: data.description,
      priceCents: data.price_cents,
      currency: data.currency,
      condition: data.condition,
      brand: data.brand,
      partNumber: data.part_number,
      category: data.category,
      shippingCents: data.shipping_cents,
      status: data.status,
    };
  },
});

export const readMyCar = defineCapability({
  name: "read_my_car",
  description: "Read one of the owner's own cars and its build: make, model, year, engine and each mod line with its id and status. Never the VIN.",
  risk: "R0",
  scopes: ["buyer", "garage", "seller"],
  input: z.object({ carId: id }),
  output: z.object({
    id,
    name: z.string(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    year: z.number().int().nullable(),
    engine: z.string().nullable(),
    mods: z.array(z.object({ id, brand: z.string().nullable(), product: z.string().nullable(), partNumber: z.string().nullable(), category: z.string().nullable(), status: z.string() })),
  }).nullable(),
  async run({ supabase, context }, input) {
    // The owner's own car only, whatever row security would also allow; the
    // VIN column is never selected (my_car_vin stays owner-only and unused).
    const { data, error } = await supabase
      .from("cars")
      .select("id,name,make,model,year,engine,owner_id")
      .eq("id", input.carId)
      .eq("owner_id", context.principal.memberId)
      .maybeSingle();
    if (error) throw new CapabilityError("failed", "Car is unavailable", error);
    if (!data) return null;
    const mods = await supabase.from("mod_items").select("id,brand,product,part_number,category,status").eq("car_id", data.id).order("position");
    if (mods.error) throw new CapabilityError("failed", "Build is unavailable", mods.error);
    return {
      id: data.id,
      name: data.name,
      make: data.make,
      model: data.model,
      year: data.year,
      engine: data.engine,
      mods: (mods.data ?? []).map((mod) => ({ id: mod.id, brand: mod.brand, product: mod.product, partNumber: mod.part_number, category: mod.category, status: mod.status })),
    };
  },
});

/** The graph isn't seeded yet (B1): every graph read says so rather than guessing. */
const graphPending = { status: "not_enough_evidence" as const, reason: "graph_pending" as const };

export const readProduct = defineCapability({
  name: "read_product",
  description: "What DRVN knows about the product behind a part number: its identity and the listings of it. Says when there isn't enough evidence.",
  risk: "R0",
  scopes: ["seller", "buyer", "garage"],
  input: z.object({ partNumber: z.string().trim().min(2).max(80), brand: z.string().trim().max(80).optional() }),
  output: z.object({ status: z.enum(["found", "not_enough_evidence"]), reason: z.string().optional(), product: z.object({ id, name: z.string(), brand: z.string().nullable() }).optional() }),
  async run() {
    return graphPending;
  },
});

export const fitmentEvidence = defineCapability({
  name: "fitment_evidence",
  description: "Evidence that a part fits a car: recorded fitments by source and verification. 'Not enough evidence' is a valid answer.",
  risk: "R0",
  scopes: ["seller", "buyer", "garage"],
  input: z.object({ listingId: id.optional(), partNumber: z.string().max(80).optional(), carId: id.optional() }),
  output: z.object({ status: z.enum(["fits", "does_not_fit", "not_enough_evidence"]), reason: z.string().optional(), evidence: z.array(z.object({ source: z.string(), verified: z.boolean(), note: z.string().nullable() })) }),
  async run() {
    return { ...graphPending, evidence: [] };
  },
});

export const priceComparables = defineCapability({
  name: "price_comparables",
  description: "What the same part sold for: paid-and-completed sales only, net of refunds. Below the minimum sample it says so instead of suggesting a price.",
  risk: "R0",
  scopes: ["seller", "buyer"],
  input: z.object({ listingId: id.optional(), partNumber: z.string().max(80).optional() }),
  output: z.object({ status: z.enum(["ok", "not_enough_sales"]), reason: z.string().optional(), sales: z.number().int().nonnegative(), medianCents: cents.nullable() }),
  async run() {
    return { status: "not_enough_sales" as const, reason: "graph_pending", sales: 0, medianCents: null };
  },
});

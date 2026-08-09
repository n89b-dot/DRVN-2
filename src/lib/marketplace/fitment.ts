import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * Shared "fits your car" matching logic (PRD §7.1) — exact make+model against
 * a car in the viewer's garage. Never derived from seller compatibility notes.
 *
 * Extracted from src/lib/marketplace/query.ts so the listing detail page can
 * reuse the exact same rule the marketplace cards use, instead of a
 * hand-rolled comparison that could quietly drift from it.
 */

export type GarageFitmentIndex = Map<string, string>;

export type GarageCar = {
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
};

function fitKey(make: string, model: string): string {
  return `${make.toLowerCase()}|${model.toLowerCase()}`;
}

/** Builds a make+model → car name index from a viewer's garage. */
export function buildGarageFitmentIndex(
  cars: { name: string; make: string | null; model: string | null }[]
): GarageFitmentIndex {
  const index: GarageFitmentIndex = new Map();
  for (const car of cars) {
    if (car.make && car.model) {
      index.set(fitKey(car.make, car.model), car.name);
    }
  }
  return index;
}

/** A seller-stated fitment claim (listing_fitments, 0025). */
export type FitmentClaim = {
  make: string;
  model: string;
  year_start: number | null;
  year_end: number | null;
};

/**
 * Matches structured seller-stated fitment rows against a garage. Exact
 * case-insensitive make+model; a claim with year bounds also requires the
 * car's year inside them (a car without a year matches year-bounded claims —
 * the claim is seller-stated either way, so the hint errs open and the badge
 * carries the label). Returns the first matching car's name, else null.
 */
export function matchFitmentClaims(cars: GarageCar[], claims: FitmentClaim[]): string | null {
  for (const car of cars) {
    if (!car.make || !car.model) continue;
    const key = fitKey(car.make, car.model);
    for (const claim of claims) {
      if (fitKey(claim.make, claim.model) !== key) continue;
      if (car.year !== null) {
        if (claim.year_start !== null && car.year < claim.year_start) continue;
        if (claim.year_end !== null && car.year > claim.year_end) continue;
      }
      return car.name;
    }
  }
  return null;
}

/** Returns the garage car's name if `make`+`model` matches one, else null. */
export function matchGarageFitment(
  index: GarageFitmentIndex,
  make: string | null,
  model: string | null
): string | null {
  if (!make || !model) return null;
  return index.get(fitKey(make, model)) ?? null;
}

/**
 * Fetches the viewer's garage and returns both the raw rows and the
 * make+model index, for callers (like the listing detail page) that need
 * both the count (to tell "no garage" from "no match") and the lookup.
 */
export async function fetchGarageFitment(
  supabase: SupabaseClient<Database>,
  viewerId: string
): Promise<{
  cars: GarageCar[];
  index: GarageFitmentIndex;
}> {
  const { data: cars } = await supabase
    .from("cars")
    .select("name, make, model, year")
    .eq("owner_id", viewerId);

  return { cars: cars ?? [], index: buildGarageFitmentIndex(cars ?? []) };
}

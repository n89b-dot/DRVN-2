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
 * car's known year inside them. An unknown year is not evidence for a bounded
 * claim. Returns the first matching car's name, else null.
 */
export function matchFitmentClaims(cars: GarageCar[], claims: FitmentClaim[]): string | null {
  for (const car of cars) {
    if (!car.make || !car.model) continue;
    const key = fitKey(car.make, car.model);
    for (const claim of claims) {
      if (fitKey(claim.make, claim.model) !== key) continue;
      if (car.year === null && (claim.year_start !== null || claim.year_end !== null)) continue;
      if (car.year !== null) {
        if (claim.year_start !== null && car.year < claim.year_start) continue;
        if (claim.year_end !== null && car.year > claim.year_end) continue;
      }
      return car.name;
    }
  }
  return null;
}

export type MatchEvidence = {
  kind: "seller_stated" | "source_model" | "year_needed" | "outside_years" | "unknown";
  label: string;
  detail: string;
};

/** Shared card/detail explanation. Source provenance never becomes a fit guarantee. */
export function explainMatch(car: Pick<GarageCar, "make" | "model" | "year"> | null, claims: FitmentClaim[], source: { make: string | null; model: string | null } | null): MatchEvidence {
  const unknown: MatchEvidence = { kind: "unknown", label: "Compatibility not confirmed", detail: "Check the part number, measurements and seller's notes before buying." };
  if (!car?.make) return unknown;
  const same = (make: string | null, model: string | null) => Boolean(make && make.toLowerCase() === car.make!.toLowerCase() && (!car.model || model?.toLowerCase() === car.model.toLowerCase()));
  const relevant = claims.filter(claim => same(claim.make, claim.model));
  if (relevant.some(claim => (car.year !== null || (claim.year_start === null && claim.year_end === null)) && (car.year === null || ((claim.year_start === null || car.year >= claim.year_start) && (claim.year_end === null || car.year <= claim.year_end))))) {
    return { kind: "seller_stated", label: car.model ? "Seller-stated vehicle match" : "Seller lists this make", detail: "The seller supplied compatible vehicle information. Confirm the exact model, year and part number before buying." };
  }
  if (relevant.length) return car.year === null
    ? { kind: "year_needed", label: "Vehicle year needed", detail: "The seller's compatibility claim has year limits. Choose a year to check them." }
    : { kind: "outside_years", label: "Outside the seller's stated years", detail: "Your selected year is outside the seller's listed range. Source-car similarity does not override this." };
  if (source && same(source.make, source.model)) return { kind: "source_model", label: car.model ? "From the same vehicle model" : "From the same vehicle make", detail: "This describes the source build only. It is not verified compatibility for your vehicle." };
  return unknown;
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

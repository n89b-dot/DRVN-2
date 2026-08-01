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
  cars: { name: string; make: string | null; model: string | null }[];
  index: GarageFitmentIndex;
}> {
  const { data: cars } = await supabase
    .from("cars")
    .select("name, make, model")
    .eq("owner_id", viewerId);

  return { cars: cars ?? [], index: buildGarageFitmentIndex(cars ?? []) };
}

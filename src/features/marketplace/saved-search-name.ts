import "server-only";

import { readSavedSearch } from "@/lib/marketplace/saved-search";
import { CATEGORIES, conditionLabel } from "@/lib/marketplace/taxonomy";
import { resolveVehicleFilter } from "@/lib/vehicles/catalog";

/**
 * A saved search's name, built from what is actually set — "2003 BMW M3 · KW",
 * "“exhaust” · Brakes" — so several saved searches can be told apart. The
 * vehicle, text, category and brand lead; the finer refinements only name
 * the search when nothing else does (the Saved row lists them underneath).
 */
export async function savedSearchName(value: unknown): Promise<string | null> {
  const params = readSavedSearch(value);
  if (!params) return null;
  const vehicle = params.vehicle ? await resolveVehicleFilter(params.vehicle).catch(() => null) : null;
  const category = params.category ? CATEGORIES.find((c) => c.slug === params.category) : undefined;
  const sub = category?.subcategories.find((s) => s.slug === params.subcategory);
  const lead = [
    vehicle ? [params.vyear, vehicle.label].filter(Boolean).join(" ") : "",
    params.q ? `“${params.q}”` : "",
    sub?.label ?? category?.label ?? "",
    params.brand ?? "",
  ].filter(Boolean);
  if (lead.length) return lead.join(" · ");
  const rest = [
    params.condition ? conditionLabel(params.condition) : "",
    params.min || params.max ? `$${params.min ?? "0"}–${params.max ? `$${params.max}` : "any"}` : "",
    params.location ? `Ships from ${params.location}` : "",
  ].filter(Boolean);
  if (rest.length) return rest.join(" · ");
  if (params.fit === "1") return "Potential matches for my garage";
  return "Everything on the marketplace";
}

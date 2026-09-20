import { marketplaceHref, normalizeMarketplaceState, type ListingFilters } from "./state";

export const SAVED_SEARCH_VERSION = "2";
/**
 * Every filter a saved search remembers.
 *
 * A key missing here is not a small bug: the search saves without it, and
 * then the alert job — which runs the same query — matches everything the
 * member meant to exclude. Somebody who saved "Öhlins coilovers under £900"
 * gets mailed about every coilover on the site. `brand` was added with M-6
 * for exactly that reason.
 */
export const SAVED_SEARCH_KEYS = ["q", "category", "subcategory", "condition", "brand", "min", "max", "location", "fit", "vehicle", "vyear", "ymin", "ymax", "sort"] as const;

/** Legacy flat definitions stay dynamic for fit=1. Unknown future versions fail closed. */
export function readSavedSearch(value: unknown): ListingFilters | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw._version !== undefined && raw._version !== "1" && raw._version !== SAVED_SEARCH_VERSION) return null;
  const state = normalizeMarketplaceState(Object.fromEntries(SAVED_SEARCH_KEYS.flatMap(key => typeof raw[key] === "string" ? [[key, raw[key]]] : [])));
  delete state.page;
  return state;
}

export function writeSavedSearch(value: ListingFilters): Record<string, string> {
  const state = readSavedSearch(value) ?? {};
  return { ...Object.fromEntries(Object.entries(state).filter((entry): entry is [string, string] => Boolean(entry[1]))), _version: SAVED_SEARCH_VERSION, ...(state.fit === "1" ? { _garage: "dynamic" } : {}) };
}

export function savedSearchKey(value: unknown): string | null {
  const state = readSavedSearch(value);
  return state ? marketplaceHref(state) : null;
}

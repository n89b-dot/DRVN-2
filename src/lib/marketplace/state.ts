import { CONDITIONS, getCategory } from "./taxonomy";

export type ListingSort = "newest" | "price_asc" | "price_desc";
export type ListingFilters = Partial<Record<
  "q" | "category" | "subcategory" | "condition" | "min" | "max" | "fit" |
  "brand" | "location" | "vehicle" | "vyear" | "ymin" | "ymax" | "sort" | "page", string
>>;
export type RawMarketplaceParams = Record<string, string | string[] | undefined>;

export const CATEGORY_REDIRECTS: Readonly<Record<string, string>> = {
  interior: "interior-lighting",
  brakes: "brakes-suspension",
};
export const REFINEMENT_KEYS = ["condition", "brand", "min", "max", "location", "fit", "ymin", "ymax"] as const;

/** One URL vocabulary for controls, category destinations and saved links. */
export function normalizeMarketplaceState(raw: RawMarketplaceParams): ListingFilters {
  const value = (key: string) => {
    const input = raw[key];
    return (Array.isArray(input) ? input[0] : input)?.trim() ?? "";
  };
  const state: ListingFilters = {};
  for (const key of ["q", "location"] as const) {
    if (value(key)) state[key] = value(key).slice(0, 200);
  }
  // Brand is free text from the facet, not an enum: the brand list grows
  // every time somebody lists a part nobody has listed before, and a fixed
  // allow-list would silently drop the new ones.
  if (value("brand")) state.brand = value("brand").slice(0, 120);
  const slug = CATEGORY_REDIRECTS[value("category")] ?? value("category");
  const category = getCategory(slug);
  if (category) {
    state.category = category.slug;
    if (category.subcategories.some(s => s.slug === value("subcategory"))) state.subcategory = value("subcategory");
  }
  if (CONDITIONS.some(c => c.value === value("condition"))) state.condition = value("condition");
  for (const key of ["min", "max"] as const) {
    const price = value(key);
    if (/^\d+(?:\.\d{1,2})?$/.test(price) && Number.isSafeInteger(Math.round(Number(price) * 100)) && Number(price) * 100 <= 2147483647) {
      state[key] = String(Number(price));
    }
  }
  if (state.min && state.max && Number(state.min) > Number(state.max)) {
    delete state.min;
    delete state.max;
  }
  if (value("fit") === "1") state.fit = "1";
  if (/^[1-9]\d{0,9}(?:-[1-9]\d{0,9})?$/.test(value("vehicle"))) state.vehicle = value("vehicle");
  if (state.vehicle && /^\d{4}$/.test(value("vyear")) && Number(value("vyear")) >= 1900 && Number(value("vyear")) <= new Date().getFullYear() + 1) state.vyear = value("vyear");
  for (const key of ["ymin", "ymax"] as const) {
    if (/^\d{4}$/.test(value(key))) state[key] = value(key);
  }
  if (state.ymin && state.ymax && state.ymin > state.ymax) {
    delete state.ymin;
    delete state.ymax;
  }
  if (["newest", "price_asc", "price_desc"].includes(value("sort"))) state.sort = value("sort");
  const page = Number(value("page"));
  if (Number.isSafeInteger(page) && page > 1 && page <= 1_000_000) state.page = String(page);
  return state;
}

export function marketplacePath(state: ListingFilters): string {
  return `/marketplace${state.category ? `/${state.category}` : ""}${state.category && state.subcategory ? `/${state.subcategory}` : ""}`;
}

export function marketplaceHref(state: ListingFilters, changes: ListingFilters = {}): string {
  const next = normalizeMarketplaceState({ ...state, ...changes });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    if (value && key !== "category" && key !== "subcategory") params.set(key, value);
  }
  return `${marketplacePath(next)}${params.size ? `?${params}` : ""}`;
}

/** Category navigation changes scope, keeping search and refinements. */
export function categoryHref(state: ListingFilters, category?: string, subcategory?: string): string {
  return marketplaceHref(state, { category, subcategory, page: undefined });
}

export function clearRefinements(state: ListingFilters): ListingFilters {
  const next = { ...state, page: undefined };
  for (const key of REFINEMENT_KEYS) delete next[key];
  return next;
}

export function refinementCount(state: ListingFilters): number {
  return [state.condition, state.brand, state.min || state.max, state.location, state.fit, state.ymin || state.ymax].filter(Boolean).length;
}

export function hasMarketplaceSearch(state: ListingFilters): boolean {
  return Boolean(state.q || state.vehicle || refinementCount(state));
}

/** Accept only shopping destinations; never forward arbitrary return URLs. */
export function shoppingReturn(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 3000 || !/^\/(?:marketplace(?:\/|\?|$)|explore(?:\?|$))/.test(value) || /[\\\r\n]/.test(value)) return null;
  const url = new URL(value, "https://drvn.invalid");
  if (url.pathname === "/explore") return url.pathname + url.search;
  const [, , category, subcategory, extra] = url.pathname.split("/");
  if (extra || (category && !getCategory(CATEGORY_REDIRECTS[category] ?? category))) return null;
  return marketplaceHref(normalizeMarketplaceState({ ...Object.fromEntries(url.searchParams), ...(category ? { category, subcategory } : {}) }));
}

export function listingHref(id: string, returnTo?: string): string {
  const destination = shoppingReturn(returnTo);
  return `/listings/${encodeURIComponent(id)}${destination ? `?from=${encodeURIComponent(destination)}` : ""}`;
}

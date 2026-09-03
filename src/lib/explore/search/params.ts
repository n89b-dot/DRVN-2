import type { FeedTab } from "@/lib/feed";

/**
 * Explore search URL state (brief §30/§31) — the one place the `/explore`
 * query-string vocabulary is defined, parsed and rebuilt, so the URL and the
 * visible UI can never disagree.
 *
 * Params (shared names with the marketplace wherever the concept is shared):
 *   q          free-text query
 *   tab        the Explore scope (lib/feed.ts FEED_TABS: all/cars/updates/parts)
 *   vehicle    canonical catalog identity: "<makeId>" or "<makeId>-<modelId>"
 *   ymin/ymax  model-year bounds, every scope: cars.year for Builds, the
 *              owning car's year for Updates, the source car's year for Parts
 *   category / condition / min / max / fit   marketplace refinements,
 *              identical semantics to /marketplace (Parts scope only)
 *   sort       "" = default (relevance while searching, recency otherwise)
 *
 * Scope changes clean incompatible filters by construction: both the parser
 * and the href builder run through ALLOWED_KEYS, so a pasted URL with a
 * foreign filter and a tab switch both land on the same valid state.
 *
 * Pure and client-safe — no server imports; unit-tested in params.test.ts.
 */

export type ExploreSort = "relevance" | "newest" | "price_asc" | "price_desc";

export type ExploreSearchParams = {
  q: string;
  vehicle: string;
  ymin: string;
  ymax: string;
  category: string;
  condition: string;
  min: string;
  max: string;
  fit: boolean;
  /** Raw validated sort value; "" = scope default. */
  sort: ExploreSort | "";
};

type FilterKey =
  | "vehicle"
  | "ymin"
  | "ymax"
  | "category"
  | "condition"
  | "min"
  | "max"
  | "fit";

/** The refinements every scope shares — the sheet shows these on each tab. */
const COMMON_FILTER_KEYS: FilterKey[] = ["vehicle", "ymin", "ymax"];

/** Which refinements each scope understands (brief §14). Accounts have none
 *  by design — they only ever appear inside All results. */
export const ALLOWED_FILTER_KEYS: Record<FeedTab, FilterKey[]> = {
  all: COMMON_FILTER_KEYS,
  cars: COMMON_FILTER_KEYS,
  updates: COMMON_FILTER_KEYS,
  parts: [...COMMON_FILTER_KEYS, "category", "condition", "min", "max", "fit"],
};

/** Which sort values each scope accepts. Parts reuse the marketplace's
 *  price sorting; relevance ordering there stays with the engine's candidate
 *  selection (PostgreSQL applies the final order), so it isn't offered. */
export const ALLOWED_SORTS: Record<FeedTab, ExploreSort[]> = {
  all: ["relevance", "newest"],
  cars: ["relevance", "newest"],
  updates: ["relevance", "newest"],
  parts: ["newest", "price_asc", "price_desc"],
};

const VEHICLE_PARAM = /^\d{1,10}(-\d{1,10})?$/;
const YEAR_PARAM = /^\d{4}$/;
/** A model year the catalog could plausibly hold; anything else is a typo. */
const yearOk = (value: string) =>
  YEAR_PARAM.test(value) && Number(value) >= 1900 && Number(value) <= new Date().getFullYear() + 1;

/** Parse + validate one raw searchParams record for a given scope. Unknown
 *  values and filters foreign to the scope are dropped, never errored. */
export function parseExploreSearch(
  raw: Record<string, string | string[] | undefined>,
  tab: FeedTab
): ExploreSearchParams {
  const first = (key: string): string => {
    const value = raw[key];
    const str = Array.isArray(value) ? value[0] : value;
    return typeof str === "string" ? str.slice(0, 200).trim() : "";
  };
  const allowed = new Set<string>(ALLOWED_FILTER_KEYS[tab]);
  const vehicle = first("vehicle");
  const sort = first("sort") as ExploreSort;
  return {
    q: first("q"),
    vehicle: allowed.has("vehicle") && VEHICLE_PARAM.test(vehicle) ? vehicle : "",
    ymin: allowed.has("ymin") && yearOk(first("ymin")) ? first("ymin") : "",
    ymax: allowed.has("ymax") && yearOk(first("ymax")) ? first("ymax") : "",
    category: allowed.has("category") ? first("category") : "",
    condition: allowed.has("condition") ? first("condition") : "",
    min: allowed.has("min") ? first("min") : "",
    max: allowed.has("max") ? first("max") : "",
    fit: allowed.has("fit") && first("fit") === "1",
    sort: (ALLOWED_SORTS[tab] as string[]).includes(sort) ? sort : "",
  };
}

/** Search mode vs browse mode (brief §31): a text query OR any meaningful
 *  refinement activates search; otherwise /explore stays the normal feed. */
export function hasActiveSearch(p: ExploreSearchParams): boolean {
  return Boolean(
    p.q ||
      p.vehicle ||
      p.ymin ||
      p.ymax ||
      p.category ||
      p.condition ||
      p.min ||
      p.max ||
      p.fit
  );
}

/** How many refinements are on — the Filters trigger's badge (q and sort are
 *  not refinements; min+max count once as one price bound, ymin+ymax once as
 *  one year range). */
export function activeFilterCount(p: ExploreSearchParams): number {
  return [
    p.vehicle,
    p.ymin || p.ymax,
    p.category,
    p.condition,
    p.min || p.max,
    p.fit,
  ].filter(Boolean).length;
}

/** The sort actually applied, resolving "" to the scope default. */
export function effectiveSort(p: ExploreSearchParams, tab: FeedTab): ExploreSort {
  if (p.sort) return p.sort;
  if (tab === "parts") return "newest";
  return p.q ? "relevance" : "newest";
}

/**
 * Build an /explore href for a target scope, carrying compatible state and
 * shedding the rest. `overrides` land after the carry-over (an empty-string
 * override removes that param). The shared refinements (vehicle, year)
 * always cross a scope boundary — each scope applies its own lane for them
 * (brief §30); carry-over is decided by the target scope's allowed keys.
 */
export function exploreSearchHref(
  tab: FeedTab,
  p: ExploreSearchParams,
  overrides: Partial<Record<"q" | "sort" | FilterKey, string>> = {}
): string {
  const allowed = new Set<string>(ALLOWED_FILTER_KEYS[tab]);
  const search = new URLSearchParams();
  if (tab !== "all") search.set("tab", tab);

  const entries: [string, string][] = [
    ["q", p.q],
    ["vehicle", p.vehicle],
    ["ymin", p.ymin],
    ["ymax", p.ymax],
    ["category", p.category],
    ["condition", p.condition],
    ["min", p.min],
    ["max", p.max],
    ["fit", p.fit ? "1" : ""],
    ["sort", p.sort],
  ];
  for (const [key, carried] of entries) {
    const value = key in overrides ? (overrides[key as keyof typeof overrides] ?? "") : carried;
    if (!value) continue;
    if (key !== "q" && key !== "sort" && !allowed.has(key)) continue;
    if (key === "sort" && !(ALLOWED_SORTS[tab] as string[]).includes(value)) continue;
    search.set(key, value);
  }
  const query = search.toString();
  return query ? `/explore?${query}` : "/explore";
}

/** Split a validated vehicle param into its catalog ids. */
export function parseVehicleParam(
  value: string
): { makeId: number; modelId: number | null } | null {
  if (!VEHICLE_PARAM.test(value)) return null;
  const [makeStr, modelStr] = value.split("-");
  const makeId = Number(makeStr);
  const modelId = modelStr ? Number(modelStr) : null;
  if (!Number.isInteger(makeId) || makeId <= 0) return null;
  return { makeId, modelId };
}

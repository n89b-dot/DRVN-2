import "server-only";

import { reportError } from "@/lib/monitoring";
import {
  typesenseConfigured,
  typesenseDelete,
  typesenseDeleteMany,
  typesenseImport,
  typesenseRequest,
  typesenseUpsert,
} from "@/lib/search/typesense";

import { classifyQuery } from "./normalize";
import type { SearchProvider } from "./provider";

/**
 * Optional Typesense adapter (brief §B1) — chosen over Meilisearch for its
 * per-field alphanumeric typo control: part-number-shaped tokens can be
 * excluded from typo correction, which is exactly DRVN's identifier rule.
 * Self-hosted/open-source; configured entirely by env (TYPESENSE_URL /
 * TYPESENSE_API_KEY — see the shared transport in src/lib/search/typesense).
 *
 * Any failure returns null and the caller falls back to Postgres; identifier
 * queries are ALWAYS answered by Postgres (exact compact semantics beat
 * engine ranking there). Index lifecycle: scripts/reindex-search.mjs (full
 * rebuild) and syncListingToSearch (per-listing upsert on publish/edit,
 * fire-and-forget).
 */

export const COLLECTION = "drvn-listings";

export { typesenseConfigured };

/** The part document (search_listing_documents builds it, migration
 *  20261011130000). Only parts for sale by sellers who aren't suspended are
 *  indexed, so the engine never holds anything a visitor may not find. */
export type ListingSearchDocument = {
  id: string;
  sort_id: string;
  title: string;
  description: string;
  compatibility_notes: string;
  part_numbers: string[];
  category: string;
  subcategory: string;
  brand: string;
  brand_key: string;
  condition: string;
  status: string;
  price_cents: number;
  created_at_unix: number;
  created_at_us: number;
  seller_id: string;
  source_car: string;
  source_car_public: boolean;
  source_car_year?: number | null;
  fitment: string[];
  fit_keys: string[];
  /** "make|model|year" for every stated year, 1950-2030. */
  fit_year_keys: string[];
  /** Source-car matches: any year. */
  fit_any_year: string[];
};

/** The collection schema — the indexing contract (docs/site/search.md). The
 *  filter fields mirror marketplace_page's rules, so a page the engine finds
 *  and the count it gives describe the same parts Postgres would. */
export const COLLECTION_SCHEMA = {
  name: COLLECTION,
  fields: [
    { name: "title", type: "string" },
    { name: "description", type: "string" },
    { name: "compatibility_notes", type: "string" },
    { name: "part_numbers", type: "string[]" },
    { name: "category", type: "string", facet: true },
    { name: "subcategory", type: "string", facet: true },
    { name: "fitment", type: "string[]" },
    { name: "source_car", type: "string" },
    { name: "status", type: "string", facet: true },
    { name: "price_cents", type: "int64" },
    { name: "created_at_unix", type: "int64" },
    { name: "sort_id", type: "string", sort: true, optional: true },
    { name: "brand", type: "string", optional: true },
    { name: "brand_key", type: "string", facet: true, optional: true },
    { name: "condition", type: "string", facet: true, optional: true },
    { name: "created_at_us", type: "int64", optional: true },
    { name: "seller_id", type: "string", optional: true },
    { name: "source_car_public", type: "bool", optional: true },
    { name: "source_car_year", type: "int32", optional: true },
    { name: "fit_keys", type: "string[]", optional: true },
    { name: "fit_year_keys", type: "string[]", optional: true },
    { name: "fit_any_year", type: "string[]", optional: true },
  ],
  default_sorting_field: "created_at_unix",
};

/** A marketplace page as the engine answers it: the page's ids in order and
 *  how many parts match in all (exact). */
export type EngineListingPage = { ids: string[]; found: number };

/** What the engine can filter on. A garage fit or a place is not in the
 *  documents, so those searches stay with Postgres (null). */
export type EngineListingQuery = {
  q: string;
  category?: string;
  subcategory?: string;
  condition?: string;
  brand?: string;
  minCents?: number;
  maxCents?: number;
  /** Lower-cased make and model ('' for any model), and a year or 0. */
  vehicle?: { make: string; model: string; year: number } | null;
  yearMin?: number;
  yearMax?: number;
  sort: "newest" | "price_asc" | "price_desc";
  page: number;
  perPage: number;
};

/** Backticks quote a filter value for Typesense; a backtick inside one can't be quoted, so it can't be searched for. */
function quoted(value: string): string | null {
  return value.includes("`") ? null : `\`${value}\``;
}

/**
 * One page of a text search, from the engine: ids and the exact total. The
 * order is the marketplace's (newest, cheapest, dearest — the same
 * tie-break as marketplace_page), not relevance: the marketplace has never
 * sorted by relevance. Returns null when the engine can't answer (not
 * configured, a value it can't filter on, any failure): the caller uses
 * Postgres' capped search.
 */
export async function searchListingPage(query: EngineListingQuery): Promise<EngineListingPage | null> {
  if (!typesenseConfigured()) return null;
  const { kind, term } = classifyQuery(query.q);
  // Identifiers keep Postgres' exact compact semantics — never engine fuzz.
  if (kind === "identifier" || !term) return null;
  const filters = ["status:=active"];
  for (const [field, value] of [["category", query.category], ["subcategory", query.subcategory], ["condition", query.condition], ["brand_key", query.brand?.toLowerCase()]] as const) {
    if (!value) continue;
    const v = quoted(value);
    if (!v) return null;
    filters.push(`${field}:=${v}`);
  }
  if (query.minCents !== undefined) filters.push(`price_cents:>=${query.minCents}`);
  if (query.maxCents !== undefined) filters.push(`price_cents:<=${query.maxCents}`);
  if (query.yearMin || query.yearMax) filters.push(`source_car_public:=true && source_car_year:[${query.yearMin || 0}..${query.yearMax || 9999}]`);
  if (query.vehicle) {
    const key = quoted(`${query.vehicle.make}|${query.vehicle.model}`);
    if (!key) return null;
    const year = query.vehicle.year;
    // Stated years are indexed 1950-2030; outside them Postgres answers.
    if (year && (year < 1950 || year > 2030)) return null;
    const yearKey = quoted(`${query.vehicle.make}|${query.vehicle.model}|${year}`);
    if (!yearKey) return null;
    filters.push(year ? `(fit_year_keys:=${yearKey} || fit_any_year:=${key})` : `fit_keys:=${key}`);
  }
  const sortBy = query.sort === "price_asc" ? "price_cents:asc,sort_id:asc"
    : query.sort === "price_desc" ? "price_cents:desc,sort_id:desc"
    : "created_at_us:desc,sort_id:desc";
  try {
    const params = new URLSearchParams({
      q: term,
      query_by: "title,part_numbers,fitment,source_car,description,compatibility_notes",
      query_by_weights: "6,5,4,3,2,1",
      num_typos: "2,0,1,1,2,2", // no typo correction on part_numbers
      filter_by: filters.join(" && "),
      sort_by: sortBy,
      page: String(query.page),
      per_page: String(query.perPage),
      include_fields: "id",
    });
    const res = await typesenseRequest(`/collections/${COLLECTION}/documents/search?${params}`);
    const body = (await res.json()) as { found?: number; hits?: { document: { id: string } }[] };
    return { ids: (body.hits ?? []).map((hit) => hit.document.id), found: body.found ?? 0 };
  } catch (error) {
    reportError("[search] typesense page failed — falling back", { error: String(error) });
    return null;
  }
}

export class TypesenseSearchProvider implements SearchProvider {
  readonly name = "typesense";

  constructor(private readonly fallback: SearchProvider) {}

  async searchIds(rawQuery: string, opts: { limit?: number } = {}): Promise<string[] | null> {
    const { kind, term } = classifyQuery(rawQuery);
    // Identifiers keep Postgres' exact compact semantics — never engine fuzz.
    if (kind === "identifier") return this.fallback.searchIds(rawQuery, opts);
    try {
      const params = new URLSearchParams({
        q: term,
        query_by: "title,part_numbers,fitment,source_car,description,compatibility_notes",
        query_by_weights: "6,5,4,3,2,1",
        filter_by: "status:=active",
        per_page: String(Math.min(opts.limit ?? 250, 250)),
        num_typos: "2,0,1,1,2,2", // no typo correction on part_numbers
        include_fields: "id",
      });
      const res = await typesenseRequest(
        `/collections/${COLLECTION}/documents/search?${params}`
      );
      const body = (await res.json()) as { hits?: { document: { id: string } }[] };
      // The engine's answer alone: unioning Postgres' in behind it ran the
      // full Postgres search on every query, which at millions of parts is
      // what times out. The batched worker indexes within minutes.
      return (body.hits ?? []).map((hit) => hit.document.id);
    } catch (error) {
      reportError("[search] typesense query failed — falling back", { error: String(error) });
      return this.fallback.searchIds(rawQuery, opts);
    }
  }
}

/** Fire-and-forget per-listing sync — no-op unless the engine is configured. */
export async function upsertSearchDocument(doc: Partial<ListingSearchDocument> & { id: string }): Promise<void> {
  await typesenseUpsert(COLLECTION, doc);
}

/** Many documents in one request. */
export async function importSearchDocuments(docs: ListingSearchDocument[]): Promise<void> {
  await typesenseImport(COLLECTION, docs);
}

export async function deleteSearchDocuments(ids: string[]): Promise<void> {
  await typesenseDeleteMany(COLLECTION, ids);
}

export async function deleteSearchDocument(id: string): Promise<void> {
  await typesenseDelete(COLLECTION, id);
}

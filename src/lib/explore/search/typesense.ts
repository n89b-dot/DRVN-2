import "server-only";

import { reportError } from "@/lib/monitoring";
import { typesenseConfigured, typesenseRequest } from "@/lib/search/typesense";

import type { ExploreSearchDomain, ExploreSearchProvider } from "./provider";

/**
 * Optional Typesense projections for the Explore families — one collection
 * per domain so each ranks within itself (brief §27). Only material that is
 * public at index time is ever written (indexing.ts deletes on privacy or
 * unpublish), and the coordinator still re-checks visibility on hydration,
 * so a stale index can degrade ranking but can never leak.
 *
 * PostgreSQL remains canonical: every human query unions the Postgres
 * answer in behind the engine's hits (not-yet-indexed objects stay
 * findable), and any engine failure falls back entirely.
 */

export const EXPLORE_COLLECTIONS: Record<ExploreSearchDomain, string> = {
  car: "drvn-cars",
  update: "drvn-updates",
  profile: "drvn-profiles",
};

export type CarSearchDocument = {
  id: string;
  name: string;
  vehicle: string;
  tags: string[];
  about: string;
  mods: string;
  created_at_unix: number;
} & VehicleFilterFields;

/** The car's identity, for the vehicle and year filters inside the engine —
 *  the same match Explore's SQL makes (catalogue ids, or make and model by
 *  name, case-insensitive). On an update document, its car's. */
export type VehicleFilterFields = {
  make_key?: string;
  model_key?: string;
  catalog_make_id?: number | null;
  catalog_model_id?: number | null;
  year?: number | null;
};

export type UpdateSearchDocument = {
  id: string;
  title: string;
  intro: string;
  body_text: string;
  vehicle: string;
  published_at_unix: number;
} & VehicleFilterFields;

export type ProfileSearchDocument = {
  id: string;
  username: string;
  display_name: string;
  headline: string;
  created_at_unix: number;
};

export const EXPLORE_COLLECTION_SCHEMAS = [
  {
    name: EXPLORE_COLLECTIONS.car,
    fields: [
      { name: "name", type: "string" },
      { name: "vehicle", type: "string" },
      { name: "tags", type: "string[]" },
      { name: "about", type: "string" },
      { name: "mods", type: "string" },
      { name: "created_at_unix", type: "int64" },
      { name: "make_key", type: "string", optional: true },
      { name: "model_key", type: "string", optional: true },
      { name: "catalog_make_id", type: "int64", optional: true },
      { name: "catalog_model_id", type: "int64", optional: true },
      { name: "year", type: "int32", optional: true },
    ],
    default_sorting_field: "created_at_unix",
  },
  {
    name: EXPLORE_COLLECTIONS.update,
    fields: [
      { name: "title", type: "string" },
      { name: "intro", type: "string" },
      { name: "body_text", type: "string" },
      { name: "vehicle", type: "string" },
      { name: "published_at_unix", type: "int64" },
      { name: "make_key", type: "string", optional: true },
      { name: "model_key", type: "string", optional: true },
      { name: "catalog_make_id", type: "int64", optional: true },
      { name: "catalog_model_id", type: "int64", optional: true },
      { name: "year", type: "int32", optional: true },
    ],
    default_sorting_field: "published_at_unix",
  },
  {
    name: EXPLORE_COLLECTIONS.profile,
    fields: [
      { name: "username", type: "string" },
      { name: "display_name", type: "string" },
      { name: "headline", type: "string" },
      { name: "created_at_unix", type: "int64" },
    ],
    default_sorting_field: "created_at_unix",
  },
];

const SEARCH_PARAMS: Record<ExploreSearchDomain, { query_by: string; query_by_weights: string }> = {
  car: { query_by: "name,vehicle,tags,mods,about", query_by_weights: "5,4,3,2,1" },
  update: { query_by: "title,vehicle,intro,body_text", query_by_weights: "5,4,3,2" },
  profile: { query_by: "username,display_name,headline", query_by_weights: "5,5,2" },
};

export class ExploreTypesenseProvider implements ExploreSearchProvider {
  readonly name = "typesense";

  constructor(private readonly fallback: ExploreSearchProvider) {}

  async searchIds(
    domain: ExploreSearchDomain,
    rawQuery: string,
    opts: { limit?: number } = {}
  ): Promise<string[] | null> {
    const term = rawQuery.replace(/[,()]/g, " ").trim();
    if (!term) return [];
    try {
      const params = new URLSearchParams({
        q: term,
        ...SEARCH_PARAMS[domain],
        per_page: String(Math.min(opts.limit ?? 250, 250)),
        include_fields: "id",
      });
      const res = await typesenseRequest(
        `/collections/${EXPLORE_COLLECTIONS[domain]}/documents/search?${params}`
      );
      const body = (await res.json()) as { hits?: { document: { id: string } }[] };
      // The engine's answer alone. Postgres' answer used to be unioned in
      // behind it so index lag never hid an object, but that ran the full
      // Postgres search on every query — the thing the engine is for — and
      // at millions of rows it timed out. The batched worker indexes within
      // minutes (migration 20261011130000).
      return (body.hits ?? []).map((hit) => hit.document.id);
    } catch (error) {
      reportError("[explore-search] typesense query failed — falling back", {
        domain,
        error: String(error),
      });
      return this.fallback.searchIds(domain, rawQuery, opts);
    }
  }
}

/** An Explore results page from the engine: ids in order and the total. */
export type ExploreEnginePage = { ids: string[]; found: number };

/**
 * One page of a Builds or Updates search, filtered inside the engine by
 * vehicle and year (the same rules as Explore's SQL), in relevance or
 * newest order. Null when the engine can't answer; the caller uses Postgres.
 */
export async function searchExplorePage(domain: "car" | "update", query: {
  q: string;
  vehicle?: { makeId: number; modelId: number | null; make: string; model: string | null } | null;
  ymin?: number;
  ymax?: number;
  sort: "relevance" | "newest";
  page: number;
  perPage: number;
}): Promise<ExploreEnginePage | null> {
  const term = query.q.replace(/[,()]/g, " ").trim();
  if (!term || !typesenseConfigured()) return null;
  const filters: string[] = [];
  if (query.vehicle) {
    const make = query.vehicle.make.toLowerCase();
    const model = (query.vehicle.model ?? "").toLowerCase();
    if (make.includes("`") || model.includes("`")) return null;
    filters.push(query.vehicle.modelId
      ? `(catalog_model_id:=${query.vehicle.modelId} || (make_key:=\`${make}\` && model_key:=\`${model}\`))`
      : `(catalog_make_id:=${query.vehicle.makeId} || make_key:=\`${make}\`)`);
  }
  if (query.ymin || query.ymax) filters.push(`year:[${query.ymin || 0}..${query.ymax || 9999}]`);
  const at = domain === "car" ? "created_at_unix" : "published_at_unix";
  try {
    const params = new URLSearchParams({
      q: term,
      ...SEARCH_PARAMS[domain],
      ...(filters.length ? { filter_by: filters.join(" && ") } : {}),
      sort_by: query.sort === "newest" ? `${at}:desc` : `_text_match:desc,${at}:desc`,
      page: String(query.page),
      per_page: String(query.perPage),
      include_fields: "id",
    });
    const res = await typesenseRequest(`/collections/${EXPLORE_COLLECTIONS[domain]}/documents/search?${params}`);
    const body = (await res.json()) as { found?: number; hits?: { document: { id: string } }[] };
    return { ids: (body.hits ?? []).map((hit) => hit.document.id), found: body.found ?? 0 };
  } catch (error) {
    reportError("[explore-search] typesense page failed — falling back", { domain, error: String(error) });
    return null;
  }
}

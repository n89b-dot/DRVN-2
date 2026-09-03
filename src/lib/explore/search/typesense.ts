import "server-only";

import { reportError } from "@/lib/monitoring";
import { typesenseRequest } from "@/lib/search/typesense";

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
};

export type UpdateSearchDocument = {
  id: string;
  title: string;
  intro: string;
  body_text: string;
  vehicle: string;
  published_at_unix: number;
};

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
      const ids = (body.hits ?? []).map((hit) => hit.document.id);
      // Union the canonical answer in behind the engine's ranking, exactly
      // like the marketplace provider, so index lag never hides an object.
      const pg = await this.fallback.searchIds(domain, rawQuery, opts);
      for (const id of pg ?? []) if (!ids.includes(id)) ids.push(id);
      return ids;
    } catch (error) {
      reportError("[explore-search] typesense query failed — falling back", {
        domain,
        error: String(error),
      });
      return this.fallback.searchIds(domain, rawQuery, opts);
    }
  }
}

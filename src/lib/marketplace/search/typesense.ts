import "server-only";

import { reportError } from "@/lib/monitoring";

import { classifyQuery } from "./normalize";
import type { SearchProvider } from "./provider";

/**
 * Optional Typesense adapter (brief §B1) — chosen over Meilisearch for its
 * per-field alphanumeric typo control: part-number-shaped tokens can be
 * excluded from typo correction, which is exactly DRVN's identifier rule.
 * Self-hosted/open-source; configured entirely by env:
 *
 *   TYPESENSE_URL      e.g. http://localhost:8108
 *   TYPESENSE_API_KEY
 *
 * Reached over plain fetch — no client dependency. Any failure returns null
 * and the caller falls back to Postgres; identifier queries are ALWAYS
 * answered by Postgres (exact compact semantics beat engine ranking there).
 * Index lifecycle: scripts/reindex-search.mjs (full rebuild) and
 * syncListingToSearch (per-listing upsert on publish/edit, fire-and-forget).
 */

export const COLLECTION = "drvn-listings";

export function typesenseConfigured(): boolean {
  return Boolean(process.env.TYPESENSE_URL && process.env.TYPESENSE_API_KEY);
}

function headers(): Record<string, string> {
  return {
    "X-TYPESENSE-API-KEY": process.env.TYPESENSE_API_KEY ?? "",
    "Content-Type": "application/json",
  };
}

export type ListingSearchDocument = {
  id: string;
  title: string;
  description: string;
  compatibility_notes: string;
  part_numbers: string[];
  category: string;
  subcategory: string;
  fitment: string[];
  source_car: string;
  status: string;
  price_cents: number;
  created_at_unix: number;
};

/** The collection schema — the indexing contract (docs/site/search.md). */
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
  ],
  default_sorting_field: "created_at_unix",
};

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
      const res = await fetch(
        `${process.env.TYPESENSE_URL}/collections/${COLLECTION}/documents/search?${params}`,
        { headers: headers(), signal: AbortSignal.timeout(3000) },
      );
      if (!res.ok) throw new Error(`typesense ${res.status}`);
      const body = (await res.json()) as { hits?: { document: { id: string } }[] };
      const ids = (body.hits ?? []).map((hit) => hit.document.id);
      // The engine only knows what's been indexed — union Postgres' answer in
      // behind it so a not-yet-indexed listing is still findable.
      const pg = await this.fallback.searchIds(rawQuery, opts);
      for (const id of pg ?? []) if (!ids.includes(id)) ids.push(id);
      return ids;
    } catch (error) {
      reportError("[search] typesense query failed — falling back", { error: String(error) });
      return this.fallback.searchIds(rawQuery, opts);
    }
  }
}

/** Fire-and-forget per-listing sync — no-op unless the engine is configured. */
export async function upsertSearchDocument(doc: ListingSearchDocument): Promise<void> {
  if (!typesenseConfigured()) return;
  try {
    await fetch(`${process.env.TYPESENSE_URL}/collections/${COLLECTION}/documents?action=upsert`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(doc),
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    reportError("[search] typesense upsert failed", { id: doc.id, error: String(error) });
  }
}

export async function deleteSearchDocument(id: string): Promise<void> {
  if (!typesenseConfigured()) return;
  try {
    await fetch(`${process.env.TYPESENSE_URL}/collections/${COLLECTION}/documents/${id}`, {
      method: "DELETE",
      headers: headers(),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // A stale document is filtered out by status anyway.
  }
}

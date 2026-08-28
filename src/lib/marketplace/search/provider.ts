import "server-only";

import { PostgresSearchProvider } from "./postgres";
import { TypesenseSearchProvider, typesenseConfigured } from "./typesense";

/**
 * The search seam (brief §B1). PostgreSQL is canonical truth; a provider only
 * ever produces a ranked candidate id set that the normal filter/sort query
 * then intersects — no commerce decision depends on a search index.
 *
 * Providers:
 *   postgres  — always available: trigram RPC for the human lane, exact
 *               compact matching + interchange expansion for identifiers.
 *   typesense — optional self-hosted engine (TYPESENSE_URL/_API_KEY), reached
 *               over plain fetch; any failure falls back to postgres.
 *
 * Contract: searchIds returns ranked ids ([] = genuinely nothing), or null =
 * "this provider can't answer" → the caller falls through (engine → postgres
 * → the legacy ilike clause).
 */

export interface SearchProvider {
  readonly name: string;
  searchIds(rawQuery: string, opts?: { limit?: number }): Promise<string[] | null>;
}

export function getSearchProvider(): SearchProvider {
  if (typesenseConfigured()) {
    return new TypesenseSearchProvider(new PostgresSearchProvider());
  }
  return new PostgresSearchProvider();
}

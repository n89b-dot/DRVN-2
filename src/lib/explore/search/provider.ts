import "server-only";

import { ExplorePostgresProvider } from "./postgres";
import { ExploreTypesenseProvider } from "./typesense";
import { typesenseConfigured } from "@/lib/search/typesense";

/**
 * The Explore search seam — the marketplace's provider doctrine
 * (src/lib/marketplace/search/provider.ts) extended to the discovery object
 * families. PostgreSQL is canonical truth; a provider only ever produces a
 * ranked candidate id set per DOMAIN, which the coordinator
 * (src/lib/explore/search/query.ts) then filters, re-checks for visibility
 * and hydrates. Domains rank independently on purpose: one relevance score
 * cannot honestly compare a person, a build and a post (brief §9).
 *
 * Contract per domain: ranked ids ([] = genuinely nothing), or null = "this
 * provider can't answer" → the caller falls through to its own ilike lane.
 */

export type ExploreSearchDomain = "car" | "update" | "profile";

export interface ExploreSearchProvider {
  readonly name: string;
  searchIds(
    domain: ExploreSearchDomain,
    rawQuery: string,
    opts?: { limit?: number }
  ): Promise<string[] | null>;
}

export function getExploreSearchProvider(): ExploreSearchProvider {
  if (typesenseConfigured()) {
    return new ExploreTypesenseProvider(new ExplorePostgresProvider());
  }
  return new ExplorePostgresProvider();
}

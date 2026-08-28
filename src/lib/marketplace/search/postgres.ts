import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { classifyQuery } from "./normalize";
import type { SearchProvider } from "./provider";

/**
 * The always-available search implementation.
 *
 * Identifier lane — exact substring on compact forms, never fuzzy:
 *   listings.part_number_compact (0033), the seller's "also known as"
 *   numbers (listing_part_numbers, 0042), and one hop through the internal
 *   interchange graph (part_number_links) so a superseded OEM number finds a
 *   listing entered under its successor.
 *
 * Human lane — the pg_trgm RPC (0008): title/description/compat with
 *   title-first similarity ranking; identifier candidates union in when the
 *   words carry enough digit content (today's behavior, kept).
 */
export class PostgresSearchProvider implements SearchProvider {
  readonly name = "postgres";

  async searchIds(rawQuery: string, opts: { limit?: number } = {}): Promise<string[] | null> {
    const limit = opts.limit ?? 300;
    const { kind, compact, term } = classifyQuery(rawQuery);
    if (!term) return [];
    const admin = createAdminClient();

    const identifierIds = async (): Promise<string[]> => {
      if (compact.length < 4 || !/\d/.test(compact)) return [];
      // One hop of interchange: every compact linked to the queried one.
      const variants = new Set([compact]);
      const { data: links } = await admin
        .from("part_number_links")
        .select("from_compact, to_compact")
        .or(`from_compact.eq.${compact},to_compact.eq.${compact}`)
        .limit(50);
      for (const link of links ?? []) {
        variants.add(link.from_compact);
        variants.add(link.to_compact);
      }
      const variantList = [...variants];

      const [primary, alternates] = await Promise.all([
        admin
          .from("listings")
          .select("id")
          .or(variantList.map((v) => `part_number_compact.ilike.%${v}%`).join(","))
          .limit(limit),
        admin
          .from("listing_part_numbers")
          .select("listing_id")
          .in("number_compact", variantList)
          .limit(limit),
      ]);
      const ids = new Set<string>();
      for (const row of primary.data ?? []) ids.add(row.id);
      for (const row of alternates.data ?? []) ids.add(row.listing_id);
      return [...ids];
    };

    if (kind === "identifier") {
      return identifierIds();
    }

    // Human lane: ranked trigram ids, with identifier candidates unioned in
    // for digit-bearing terms (matches the pre-provider behavior).
    const [{ data: ranked, error }, idHits] = await Promise.all([
      admin.rpc("search_listing_ids", { p_query: term }),
      identifierIds(),
    ]);
    if (error) return null; // provider can't answer — caller falls back
    const ids = [...(ranked ?? [])];
    for (const id of idHits) if (!ids.includes(id)) ids.push(id);
    return ids.slice(0, limit);
  }
}

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import type { ExploreSearchDomain, ExploreSearchProvider } from "./provider";

/**
 * The always-available Explore search implementation: the three word-wise
 * pg_trgm RPCs from migration 0057, one per object family. Visibility is
 * enforced inside each function (public cars, published posts on public
 * cars, unsuspended profiles), which is why calling through the service-role
 * client is safe — the same pattern as search_listing_ids.
 */

const RPC_BY_DOMAIN: Record<ExploreSearchDomain, "search_car_ids" | "search_update_ids" | "search_profile_ids"> = {
  car: "search_car_ids",
  update: "search_update_ids",
  profile: "search_profile_ids",
};

export class ExplorePostgresProvider implements ExploreSearchProvider {
  readonly name = "postgres";

  async searchIds(
    domain: ExploreSearchDomain,
    rawQuery: string,
    opts: { limit?: number } = {}
  ): Promise<string[] | null> {
    const term = rawQuery.replace(/[,()]/g, " ").trim();
    if (!term) return [];
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(RPC_BY_DOMAIN[domain], { p_query: term });
    if (error) return null; // provider can't answer — caller falls back
    return (data ?? []).slice(0, opts.limit ?? 300);
  }
}

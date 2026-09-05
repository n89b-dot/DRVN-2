import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ListingCardData } from "@/components/ui";
import { capture } from "@/lib/analytics";
import type { Database } from "@/lib/database.types";
import {
  hydrateFeedItems,
  type FeedEventRow,
  type FeedItem,
  type FeedTab,
} from "@/lib/feed";
import { fetchListings } from "@/lib/marketplace/query";
import { reportError } from "@/lib/monitoring";
import { resolveVehicleFilter, type VehicleFilterSelection } from "@/lib/vehicles/catalog";

import { activeFilterCount, effectiveSort, type ExploreSearchParams } from "./params";
import { getExploreSearchProvider } from "./provider";

/**
 * The Explore search coordinator (brief §24) — turns validated URL state
 * into hydrated result pages, one function per scope plus the federated All
 * view. Ranking comes from the provider seam (ids only); PostgreSQL applies
 * every filter on top; and hydration goes through the SAME paths the feed
 * and marketplace already use (hydrateFeedItems / fetchListings), so search
 * inherits their visibility re-checks instead of growing its own.
 *
 * Location (brief §18): no Explore refinement. There is deliberately no
 * location column on cars, and Explore does not filter builds or updates by
 * the owning account's profile location (cars.owner_id → profiles.location)
 * — it narrows which builds return, and is never a way to retrieve accounts.
 * (the marketplace keeps its own listing-location filter on /marketplace).
 */

export const SEARCH_PAGE_SIZE = 20;

/** How many of each family the federated All view shows (bounded groups, no
 *  pagination — "view all" hands off to the scope). */
const ALL_GROUP_LIMITS = { builds: 8, updates: 8, accounts: 4, parts: 8 };

export type AccountResult = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  headline: string | null;
  profile_type: "user" | "shop";
};

export type ScopeResultPage = { items: FeedItem[]; hasMore: boolean };

export type ExploreAllResults = {
  builds: FeedItem[];
  updates: FeedItem[];
  accounts: AccountResult[];
  parts: ListingCardData[];
  /** Whether any family returned anything at all. */
  empty: boolean;
};

const NO_PAGE: ScopeResultPage = { items: [], hasMore: false };

const escapeIlike = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
/** Sanitize a value embedded in a PostgREST or() clause. */
const orSafe = (value: string) => value.replace(/["\\,()]/g, " ").trim();

/** The cars-table or() clause for a canonical vehicle selection: catalog id
 *  equality where references exist, exact-string ilike for frozen snapshots. */
function carVehicleClause(selection: VehicleFilterSelection): string {
  return selection.modelId
    ? `catalog_model_id.eq.${selection.modelId},and(make.ilike."${orSafe(selection.make)}",model.ilike."${orSafe(selection.model ?? "")}")`
    : `catalog_make_id.eq.${selection.makeId},make.ilike."${orSafe(selection.make)}"`;
}

/** Model-year bounds on a cars query — the shared Year refinement. */
function applyYearBounds<Q extends { gte: (c: "year", v: number) => Q; lte: (c: "year", v: number) => Q }>(
  query: Q,
  params: ExploreSearchParams
): Q {
  if (params.ymin) query = query.gte("year", Number(params.ymin));
  if (params.ymax) query = query.lte("year", Number(params.ymax));
  return query;
}

/**
 * Builds scope: ranked candidates → canonical filters (vehicle, year) →
 * relevance or recency order → shared hydration.
 */
export async function searchBuilds(
  supabase: SupabaseClient<Database>,
  params: ExploreSearchParams,
  opts: { page?: number; pageSize?: number; viewerId?: string | null } = {}
): Promise<ScopeResultPage> {
  const pageSize = opts.pageSize ?? SEARCH_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const sort = effectiveSort(params, "cars");

  let query = (params.q ? supabase.rpc("explore_build_rows", { p_query: params.q }) : supabase.from("cars"))
    .select("id, created_at").eq("is_public", true);

  if (params.vehicle) {
    const selection = await resolveVehicleFilter(params.vehicle);
    if (selection) query = query.or(carVehicleClause(selection));
  }
  query = applyYearBounds(query, params);

  const from = (page - 1) * pageSize;
  if (sort !== "relevance" || !params.q) query = query.order("created_at", { ascending: false }).order("id");
  const { data, error } = await query.range(from, from + pageSize);
  if (error) { reportError("[explore-search] builds query failed", error); return NO_PAGE; }
  const hasMore = (data ?? []).length > pageSize;
  const windowRows: FeedEventRow[] = (data ?? []).slice(0, pageSize).map(c => ({ kind: "car", id: c.id, happened_at: c.created_at }));

  const items = await hydrateFeedItems(supabase, windowRows, opts.viewerId);
  return { items, hasMore };
}

/**
 * Updates scope: published posts only; the viewer-scoped client plus
 * hydration's is_public re-check keep private-build posts out even when a
 * stale index offers them. Vehicle filters through the owning car.
 */
export async function searchUpdates(
  supabase: SupabaseClient<Database>,
  params: ExploreSearchParams,
  opts: { page?: number; pageSize?: number; viewerId?: string | null } = {}
): Promise<ScopeResultPage> {
  const pageSize = opts.pageSize ?? SEARCH_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const sort = effectiveSort(params, "updates");

  const selection = params.vehicle ? await resolveVehicleFilter(params.vehicle) : null;
  let query = supabase.rpc("explore_update_rows", {
    p_query: params.q ?? "", p_make: selection?.make ?? "", p_model: selection?.model ?? "",
    p_make_id: selection?.makeId ?? 0, p_model_id: selection?.modelId ?? 0,
    p_ymin: params.ymin ? Number(params.ymin) : 0, p_ymax: params.ymax ? Number(params.ymax) : 9999,
  }).select("id, published_at");
  if (sort !== "relevance" || !params.q) query = query.order("published_at", { ascending: false }).order("id");
  const from = (page - 1) * pageSize;
  const { data, error } = await query.range(from, from + pageSize);
  if (error) { reportError("[explore-search] updates query failed", error); return NO_PAGE; }
  const hasMore = (data ?? []).length > pageSize;
  const windowRows: FeedEventRow[] = (data ?? []).slice(0, pageSize).map(p => ({ kind: "update", id: p.id, happened_at: p.published_at! }));

  const items = await hydrateFeedItems(supabase, windowRows, opts.viewerId);
  return { items, hasMore };
}

/**
 * Account discovery (brief §10/§22): identity search only, bounded, no
 * pagination, no filters — accounts appear inside All results and nowhere
 * else. The projection selected here is the complete public surface search
 * may touch: username, display name, avatar, headline, profile type.
 */
export async function searchAccounts(
  supabase: SupabaseClient<Database>,
  q: string,
  limit = ALL_GROUP_LIMITS.accounts
): Promise<AccountResult[]> {
  if (!q.trim()) return [];
  const ids = await getExploreSearchProvider()
    .searchIds("profile", q, { limit: 30 })
    .catch(() => null);

  let orderedIds: string[];
  if (ids !== null) {
    orderedIds = ids.slice(0, limit);
  } else {
    const term = escapeIlike(orSafe(q.replace(/@/g, " ")));
    if (!term) return [];
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .or(`username.ilike.%${term}%,display_name.ilike.%${term}%,headline.ilike.%${term}%`)
      .limit(limit);
    if (error) {
      reportError("[explore-search] accounts ilike fallback failed", error);
      return [];
    }
    orderedIds = (data ?? []).map((p) => p.id);
  }
  if (!orderedIds.length) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, headline, profile_type")
    .in("id", orderedIds);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return orderedIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .filter((p) => p.username || p.display_name)
    .map((p) => ({
      id: p.id,
      username: p.username,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      headline: p.headline,
      profile_type: p.profile_type,
    }));
}

/** Parts scope — Marketplace search wholesale (brief §5/§23): same provider,
 *  identifier semantics, filters and hydration as /marketplace. */
export async function searchParts(
  supabase: SupabaseClient<Database>,
  params: ExploreSearchParams,
  opts: { page?: number; viewerId?: string | null } = {}
) {
  return fetchListings(
    supabase,
    {
      q: params.q || undefined,
      category: params.category || undefined,
      condition: params.condition || undefined,
      min: params.min || undefined,
      max: params.max || undefined,
      fit: params.fit ? "1" : undefined,
      vehicle: params.vehicle || undefined,
      ymin: params.ymin || undefined,
      ymax: params.ymax || undefined,
      sort: params.sort === "price_asc" || params.sort === "price_desc" ? params.sort : undefined,
      page: String(opts.page ?? 1),
    },
    opts.viewerId ?? undefined
  );
}

/**
 * The federated All view (brief §9): each family searched and ranked on its
 * own, presented as bounded groups. Parts stay signed-in-only, matching the
 * feed taxonomy (PRD §8.2). Accounts only join in when there's a text query
 * — filters never retrieve people.
 */
export async function searchAll(
  supabase: SupabaseClient<Database>,
  params: ExploreSearchParams,
  opts: { viewerId?: string | null; isLoggedIn: boolean }
): Promise<ExploreAllResults> {
  const [builds, updates, accounts, parts] = await Promise.all([
    searchBuilds(supabase, params, {
      page: 1,
      pageSize: ALL_GROUP_LIMITS.builds,
      viewerId: opts.viewerId,
    }),
    searchUpdates(supabase, params, {
      page: 1,
      pageSize: ALL_GROUP_LIMITS.updates,
      viewerId: opts.viewerId,
    }),
    params.q ? searchAccounts(supabase, params.q) : Promise.resolve([]),
    opts.isLoggedIn
      ? searchParts(supabase, params, { page: 1, viewerId: opts.viewerId })
      : Promise.resolve(null),
  ]);

  const partCards = (parts?.results ?? []).slice(0, ALL_GROUP_LIMITS.parts);
  return {
    builds: builds.items,
    updates: updates.items,
    accounts,
    parts: partCards,
    empty:
      !builds.items.length && !updates.items.length && !accounts.length && !partCards.length,
  };
}

/** Coarse search telemetry (brief §39) — first page only; counts, never text. */
export function captureExploreSearch(
  viewerId: string | null,
  params: ExploreSearchParams,
  tab: FeedTab,
  results: number
): void {
  capture(viewerId, {
    event: "explore_search_performed",
    props: {
      scope: tab,
      has_query: Boolean(params.q),
      filters: activeFilterCount(params),
      results,
      zero: results === 0,
    },
  });
}

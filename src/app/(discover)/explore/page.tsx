import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { FilterGroup, FilterLink, Foot } from "@/components/ui";
import { MarketplaceResults } from "@/features/marketplace/results";
import {
  exploreSearchHref,
  hasActiveSearch,
  activeFilterCount,
  parseExploreSearch,
} from "@/lib/explore/search/params";
import {
  captureExploreSearch,
  searchAll,
  searchBuilds,
  searchParts,
  searchUpdates,
} from "@/lib/explore/search/query";
import { FEED_TABS, fetchFeed, resolveFeedTab } from "@/lib/feed";
import { createClient } from "@/lib/supabase/server";
import { resolveVehicleFilter } from "@/lib/vehicles/catalog";

import { ActiveSearchFilters } from "./active-search-filters";
import { ExploreSearchBar } from "./search-bar";
import { AllSearchResults, SearchEmptyState } from "./search-results";
import { SearchWall } from "./search-wall";
import { ExploreWall } from "./explore-wall";

export const metadata = { title: "Explore - DRVN" };

/**
 * Explore: browse mode is the mixed community feed exactly as before; a text
 * query or refinement switches the wall to search mode (brief §31). All
 * state lives in the URL — shareable, bookmarkable, back/forward-safe — and
 * the scope tabs carry compatible search state across (incompatible filters
 * drop by construction, §30).
 */
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const raw = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(user);
  const viewerId = user?.id ?? null;

  // The segments are the shared feed taxonomy (lib/feed.ts) — Home's
  // Discovery reads the same list, so the two never disagree. Every segment
  // is public, parts included (PRD 2026-09 E-5).
  const tab = resolveFeedTab(raw.tab);
  const params = parseExploreSearch(raw, tab);

  // Resolve the vehicle param once: labels for the chip/empty state, and an
  // unresolvable id (stale pasted URL) degrades to "no vehicle filter" in
  // the UI exactly as it does in the queries.
  const vehicle = params.vehicle ? await resolveVehicleFilter(params.vehicle) : null;
  if (params.vehicle && !vehicle) params.vehicle = "";

  const searching = hasActiveSearch(params);

  // Browse mode: page one of the feed renders here; the wall pulls the rest.
  const feed = searching
    ? null
    : await fetchFeed(supabase, tab, { page: 1, viewerId });

  // Search mode: one scope's worth of work, nothing speculative.
  const partsPageNum = Math.max(1, Number(raw.page) || 1);
  const [allResults, scopePage, partsPage] = searching
    ? await Promise.all([
        tab === "all" ? searchAll(supabase, params, { viewerId }) : null,
        tab === "cars"
          ? searchBuilds(supabase, params, { page: 1, viewerId })
          : tab === "updates"
            ? searchUpdates(supabase, params, { page: 1, viewerId })
            : null,
        tab === "parts" ? searchParts(supabase, params, { page: partsPageNum, viewerId }) : null,
      ])
    : [null, null, null];

  if (searching) {
    const resultCount = allResults
      ? allResults.builds.length +
        allResults.updates.length +
        allResults.accounts.length +
        allResults.parts.length
      : (scopePage?.items.length ?? partsPage?.total ?? 0);
    if (partsPageNum === 1) captureExploreSearch(viewerId, params, tab, resultCount);
  }

  // The wall's server action re-derives search from these — the URL is the
  // contract, so only URL-shaped state crosses the boundary.
  const rawParams: Record<string, string | undefined> = {
    q: params.q || undefined,
    vehicle: params.vehicle || undefined,
    ymin: params.ymin || undefined,
    ymax: params.ymax || undefined,
    category: params.category || undefined,
    condition: params.condition || undefined,
    min: params.min || undefined,
    max: params.max || undefined,
    fit: params.fit ? "1" : undefined,
    sort: params.sort || undefined,
  };

  const scopeEmpty =
    (allResults?.empty ?? false) ||
    (scopePage ? scopePage.items.length === 0 : false) ||
    (partsPage ? partsPage.results.length === 0 : false);

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">Explore</span>
        <h1>
          See what everyone&apos;s <span className="live-word">building.</span>
        </h1>
        <p className="sub">
          Fresh builds and updates from around DRVN — and every so often, a part you&apos;ve been
          hunting for.
        </p>
      </Rv>

      {/* The search command plate sits between the head and the scopes:
          searching is the page's primary verb once you know what you want. */}
      <ExploreSearchBar
        tab={tab}
        params={params}
        vehicle={vehicle}
        showFitToggle={isLoggedIn}
      />

      {/* One control band for the scope filters. Scope links carry
          compatible search state and shed the rest (brief §30). */}
      <div className="explorebar">
        <FilterGroup label="Show" ariaLabel="Filter the feed" stack scroll>
          {FEED_TABS.map((t) => (
            <FilterLink
              key={t.key}
              href={exploreSearchHref(t.key, params)}
              selected={tab === t.key}
            >
              {t.label}
            </FilterLink>
          ))}
        </FilterGroup>
      </div>

      {searching && (
        <ActiveSearchFilters tab={tab} params={params} vehicleLabel={vehicle?.label ?? null} />
      )}

      {!searching && feed && (
        <ExploreWall
          key={tab}
          tab={tab}
          initialItems={feed.items}
          initialHasMore={feed.hasMore}
          isLoggedIn={isLoggedIn}
        />
      )}

      {searching && scopeEmpty && (
        <SearchEmptyState
          tab={tab}
          params={params}
          vehicleLabel={vehicle?.label ?? null}
          filterCount={activeFilterCount(params)}
        />
      )}

      {searching && allResults && !allResults.empty && (
        <AllSearchResults
          results={allResults}
          params={params}
          isLoggedIn={isLoggedIn}
          viewerId={viewerId}
          path="/explore"
        />
      )}

      {searching && scopePage && scopePage.items.length > 0 && (tab === "cars" || tab === "updates") && (
        <SearchWall
          key={`${tab}-${JSON.stringify(rawParams)}`}
          tab={tab}
          rawParams={rawParams}
          initialItems={scopePage.items}
          initialHasMore={scopePage.hasMore}
          isLoggedIn={isLoggedIn}
        />
      )}

      {searching && partsPage && partsPage.results.length > 0 && (
        <section className="deck">
          <MarketplaceResults
            isLoggedIn={isLoggedIn}
            viewerId={viewerId}
            page={partsPage}
            basePath="/explore"
            params={{ ...rawParams, tab: "parts" }}
          />
        </section>
      )}

      <Foot
        left="DRVN — builds and parts from the community"
        right={<Link href="/marketplace">Browse parts →</Link>}
      />
    </div>
  );
}

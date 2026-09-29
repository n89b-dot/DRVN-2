import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { AccountRowList } from "@/components/commerce";
import { FollowButton } from "@/features/social/buttons";
import { EmptyState, FilterGroup, FilterLink, Foot, Icon, type IconName } from "@/components/ui";
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
import { FEED_TABS, fetchFeed, resolveFeedTab, type FeedTab } from "@/lib/feed";
import { getPageClient as createClient, getViewer } from "@/lib/supabase/page-context";
import { createPublicClient } from "@/lib/supabase/public";
import { resolveVehicleFilter } from "@/lib/vehicles/catalog";

import { ActiveSearchFilters } from "./active-search-filters";
import { ExploreSearchBar } from "./search-bar";
import { AllSearchResults, SearchEmptyState } from "./search-results";
import { SearchWall } from "./search-wall";
import { ExploreWall } from "./explore-wall";
import { BuildersBreaker, JoinBreaker, TrendingBreaker } from "./breakers";

export const metadata = { title: "Explore - DRVN" };

/**
 * Explore: browse mode is the mixed community feed exactly as before; a text
 * query or refinement switches the wall to search mode (brief §31). All
 * state lives in the URL — shareable, bookmarkable, back/forward-safe — and
 * the scope tabs carry compatible search state across (incompatible filters
 * drop by construction, §30).
 */
const SEGMENT_ICONS: Record<FeedTab, IconName> = {
  all: "compass",
  cars: "garage",
  updates: "image",
  parts: "market",
};

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const raw = await searchParams;
  const supabase = await createClient();
  const user = await getViewer();
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
  const showBuilders = !searching && raw.show === "builders";

  // E-4's two breakers, each with its own query. They render only when they
  // have enough to show, which the components decide — so a quiet week
  // simply has no breakers rather than two empty shells.
  // Browse mode: page one of the feed renders here; the wall pulls the rest.
  // Started now so it runs beside the breakers — it used to wait for them.
  const feedPromise = searching || showBuilders
    ? Promise.resolve(null)
    : fetchFeed(supabase, tab, {
        page: 1,
        viewerId,
        // The mixed wall leaves your own things out (see loadFeedPage).
        excludeOwnerId: tab === "all" ? viewerId : null,
      });
  const [{ data: trendingRows }, { data: builderRows }] = searching
    ? [{ data: [] }, { data: [] }]
    : await Promise.all([
        // The same for every visitor, so it is cached for five minutes
        // rather than aggregated on each view.
        createPublicClient({ revalidate: 300, tags: ["explore-trending"] }).rpc("trending_models", {
          p_days: 45,
          p_limit: 10,
        }),
        supabase.rpc("suggested_builders", {
          p_viewer: viewerId ?? undefined,
          p_limit: showBuilders ? 24 : 8,
        }),
      ]);
  const trending = (trendingRows ?? []).map((t) => ({
    make: t.make,
    model: t.model,
    builds: Number(t.builds),
    // The chip opens the vehicle filter for exactly this make + model when
    // the cars are matched to the catalog; a text search otherwise.
    vehicle: t.catalog_make_id && t.catalog_model_id ? `${t.catalog_make_id}-${t.catalog_model_id}` : null,
  }));
  // Only people with a face and a name are suggested: a blank plate with a
  // handle (placeholder and test accounts) read as a broken first row.
  const builders = (builderRows ?? [])
    .filter((b) => b.avatar_url && b.display_name?.trim())
    .slice(0, showBuilders ? 24 : 4)
    .map((b) => ({
    id: b.id,
    username: b.username,
    display_name: b.display_name,
    avatar_url: b.avatar_url,
    meta: [
      `${b.car_count} car${Number(b.car_count) === 1 ? "" : "s"}`,
      Number(b.update_count) > 0
        ? `${b.update_count} update${Number(b.update_count) === 1 ? "" : "s"}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const feed = await feedPromise;

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

  if (searching && partsPage?.status !== "error" && !allResults?.partsErrorReference) {
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
    (partsPage ? partsPage.status === "success" && partsPage.results.length === 0 : false);

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
      <ExploreSearchBar key={JSON.stringify(rawParams)}
        tab={tab}
        params={params}
        vehicle={vehicle}
        showFitToggle={isLoggedIn}
      />

      {/* One control band for the scope filters. Scope links carry
          compatible search state and shed the rest (brief §30). */}
      <div className="explorebar">
        <FilterGroup label="Show" ariaLabel="Filter the feed" stack fit>
          {FEED_TABS.map((t) => (
            <FilterLink
              key={t.key}
              href={exploreSearchHref(t.key, params)}
              selected={!showBuilders && tab === t.key}
              className="gap-1.5"
            >
              {/* E-3: an icon per segment — the row is scanned, not read. */}
              <Icon name={SEGMENT_ICONS[t.key]} className="h-4 w-4" />
              {t.label}
            </FilterLink>
          ))}
          {/* E-3's fifth segment is people, not feed items, so it isn't a
              feed tab: it has no search scope and nothing to page. Hidden
              while searching — search has its own people results. */}
          {!searching && (
            <FilterLink href="/explore?show=builders" selected={showBuilders} className="gap-1.5">
              <Icon name="user" className="h-4 w-4" />
              Builders
            </FilterLink>
          )}
        </FilterGroup>
      </div>

      {searching && (
        <ActiveSearchFilters tab={tab} params={params} vehicleLabel={vehicle?.label ?? null} />
      )}

      {showBuilders &&
        (builders.length > 0 ? (
          <section className="deck peoplerows" aria-label="Builders to follow">
            <AccountRowList
              accounts={builders}
              action={(account) => (
                <FollowButton
                  targetType="profile"
                  targetId={account.id}
                  path="/explore?show=builders"
                  initialFollowing={false}
                  isLoggedIn={isLoggedIn}
                />
              )}
            />
          </section>
        ) : (
          <EmptyState mark="✎" title="No builders to suggest yet">
            People show up here once they&apos;ve put a car, with a photo, on DRVN.
          </EmptyState>
        ))}

      {!searching && !showBuilders && feed && (
        <ExploreWall
          key={tab}
          tab={tab}
          initialItems={feed.items}
          initialHasMore={feed.hasMore}
          isLoggedIn={isLoggedIn}
          /* E-4: after the sixth card and the fourteenth. Far enough in
             that the wall has established what it is, and far enough apart
             that they don't read as a sidebar laid on its side. Each one
             renders nothing at all when its query came back thin. */
          breakers={{
            5: <TrendingBreaker models={trending} />,
            // Signed out: the join moment, between the two content breakers.
            ...(isLoggedIn ? {} : { 9: <JoinBreaker /> }),
            13: <BuildersBreaker builders={builders} isLoggedIn={isLoggedIn} />,
          }}
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

      {searching && partsPage && (partsPage.status === "error" || partsPage.results.length > 0) && (
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

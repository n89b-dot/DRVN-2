import Link from "next/link";

import {
  ButtonLink,
  EmptyState,
  ListingCard,
  Mosaic,
  MasonryFeed,
} from "@/components/ui";
import { Rv } from "@/components/livesheet";
import { ListingCartButton } from "@/features/commerce/quick-commerce";
import type { FeedTab } from "@/lib/feed";
import type { ExploreAllResults } from "@/lib/explore/search/query";
import { exploreSearchHref, type ExploreSearchParams } from "@/lib/explore/search/params";
import { MarketplaceRetrievalError } from "@/features/marketplace/retrieval-error";
import { AccountRowList } from "@/components/commerce";

/**
 * Explore search result blocks (brief §12): every family renders through its
 * canonical representation — MasonryFeed cells for builds/updates,
 * ListingCard for parts, a compact identity row for accounts. The All view
 * presents them as separate groups because their rankings are separate; each
 * group hands off to its scope via "View all".
 */

function GroupHead({
  title,
  count,
  href,
}: {
  title: string;
  count: number;
  /** "View all" destination — the family's own scope with state carried. */
  href?: string;
}) {
  return (
    <Rv as="div" className="mb-3 mt-10 flex items-baseline justify-between gap-3 first:mt-6">
      <h2 className="microlabel">
        {title}
        <span className="ml-2 text-dim">{count}</span>
      </h2>
      {href && (
        <Link href={href} className="jumplink">
          View all →
        </Link>
      )}
    </Rv>
  );
}

/** The parts group's card wall — canonical ListingCards with the Explore
 *  wall's one commerce control, the cart square. No Buy now: Explore is where
 *  you find things; checkout starts from the part's page or the cart. */
function PartsGroup({
  parts,
  isLoggedIn,
  viewerId,
  path,
}: {
  parts: ExploreAllResults["parts"];
  isLoggedIn: boolean;
  viewerId: string | null;
  path: string;
}) {
  return (
    <Mosaic commerce label="Parts matching your search">
      {parts.map((listing) => {
        const isOwn = Boolean(viewerId && listing.seller_id === viewerId);
        const purchasable = !listing.status_flag && !isOwn;
        return (
          <ListingCard
            key={listing.id}
            listing={listing}
            save={{ isLoggedIn, path }}
            actions={
              purchasable ? (
                <ListingCartButton listingId={listing.id} title={listing.title} />
              ) : isOwn ? (
                <span className="microlabel block">Your listing</span>
              ) : undefined
            }
          />
        );
      })}
    </Mosaic>
  );
}

/** The federated All view: grouped, bounded, each group ranked within itself. */
export function AllSearchResults({
  results,
  params,
  isLoggedIn,
  viewerId,
  path,
}: {
  results: ExploreAllResults;
  params: ExploreSearchParams;
  isLoggedIn: boolean;
  viewerId: string | null;
  path: string;
}) {
  return (
    <section className="deck">
      {results.builds.length > 0 && (
        <>
          <GroupHead
            title="Builds"
            count={results.builds.length}
            href={exploreSearchHref("cars", params)}
          />
          <MasonryFeed items={results.builds} isLoggedIn={isLoggedIn} path={path} />
        </>
      )}
      {results.updates.length > 0 && (
        <>
          <GroupHead
            title="Updates"
            count={results.updates.length}
            href={exploreSearchHref("updates", params)}
          />
          <MasonryFeed items={results.updates} isLoggedIn={isLoggedIn} path={path} />
        </>
      )}
      {results.accounts.length > 0 && (
        <>
          <GroupHead title="Accounts" count={results.accounts.length} />
          <AccountRowList accounts={results.accounts} />
        </>
      )}
      {results.partsErrorReference && <MarketplaceRetrievalError reference={results.partsErrorReference} />}
      {results.parts.length > 0 && (
        <>
          <GroupHead
            title="Parts"
            count={results.parts.length}
            href={exploreSearchHref("parts", params)}
          />
          <PartsGroup
            parts={results.parts}
            isLoggedIn={isLoggedIn}
            viewerId={viewerId}
            path={path}
          />
        </>
      )}
    </section>
  );
}

/**
 * Search empty state (brief §40): says exactly what found nothing, and every
 * recovery action is a real link — widen scope, drop the filters, or carry
 * the query into the marketplace. Never silently swaps in unrelated feed
 * content.
 */
export function SearchEmptyState({
  tab,
  params,
  vehicleLabel,
  filterCount,
}: {
  tab: FeedTab;
  params: ExploreSearchParams;
  vehicleLabel: string | null;
  filterCount: number;
}) {
  const scopeName =
    tab === "cars" ? "Builds" : tab === "updates" ? "Updates" : tab === "parts" ? "Parts" : null;
  const qPart = params.q ? ` “${params.q}”` : "";
  const vehiclePart = vehicleLabel ? ` for ${vehicleLabel}` : "";
  const title = scopeName
    ? `No ${scopeName.toLowerCase()} match${qPart}${vehiclePart}`
    : `No results${qPart ? ` for${qPart}` : ""}${vehiclePart}`;

  return (
    <EmptyState
      mark="⌕"
      title={title}
      className="undrawn--hero"
      action={
        <span className="flex flex-wrap justify-center gap-2">
          {tab !== "all" && (
            <ButtonLink variant="ghost" href={exploreSearchHref("all", params)}>
              Search all of DRVN
            </ButtonLink>
          )}
          {filterCount > 0 && (
            <ButtonLink
              variant="ghost"
              href={exploreSearchHref(tab, params, {
                vehicle: "",
                category: "",
                condition: "",
                min: "",
                max: "",
                fit: "",
              })}
            >
              Clear the filters
            </ButtonLink>
          )}
          {params.q && (
            <ButtonLink variant="ghost" href={`/marketplace?q=${encodeURIComponent(params.q)}`}>
              Search the marketplace
            </ButtonLink>
          )}
        </span>
      }
    >
      Check the spelling, try fewer words, or widen the search.
    </EmptyState>
  );
}

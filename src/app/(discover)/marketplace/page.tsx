import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { createClient } from "@/lib/supabase/server";

import { ActiveFilters } from "./active-filters";
import { SaveSearchButton } from "@/features/marketplace/save-search-button";
import { CategoryNav, CategorySheet } from "./category-nav";
import { FilterBar } from "./filter-bar";
import { MarketplaceResults } from "@/features/marketplace/results";

export const metadata = { title: "Marketplace - DRVN" };

/**
 * The storefront. Reading order is the buyer's task order — browse → narrow
 * → evaluate → buy:
 *
 *   task head · family nav (signed in) · search plate (+ Refine / Sort, and
 *   Browse on compact) · active filters · category tiles (≥640px) · results
 */
export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<ListingFilters>;
}) {
  const filters = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const page = await fetchListings(supabase, filters, user?.id);
  const hasQuery = Boolean(
    filters.q ||
    filters.condition ||
    filters.min ||
    filters.max ||
    filters.fit ||
    filters.location,
  );

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead pagehead--task">
        {/* No sell CTA here — this surface is for buyers, and on compact the
            button pushed the inventory below the fold. Selling lives in the
            rail/nav and on the seller surfaces. */}
        <span className="microlabel">Marketplace</span>
        <h1>
          Find the part. See the car it{" "}
          <span className="live-word">came off.</span>
        </h1>
        {/* The standfirst is desktop runway — the task head retires it on
            compact so inventory starts inside the first viewport. */}
        <p className="sub">
          Every part here came off someone&apos;s build — open a listing and you
          can see exactly which one. Search what you need, or browse by
          category.
        </p>
      </Rv>
      <FilterBar
        action="/marketplace"
        filters={filters}
        showFitToggle={Boolean(user)}
        browse={<CategorySheet />}
      />
      <ActiveFilters
        basePath="/marketplace"
        filters={filters as Record<string, string | undefined>}
      />

      {/* Quiet, opt-in persistence (§C): appears only once a state exists;
          saving is silent, alerts are a later decision in Saved. */}
      <div className="mt-1">
        <SaveSearchButton
          signedIn={Boolean(user)}
          params={Object.fromEntries(
            Object.entries(filters as Record<string, string | undefined>).filter(
              (entry): entry is [string, string] =>
                ["q", "category", "subcategory", "condition", "min", "max", "location", "fit"].includes(entry[0]) &&
                Boolean(entry[1]),
            ),
          )}
        />
      </div>

      {/* Categories are destinations (real routes), drawn as tiles so they
          can't be mistaken for another refinement row. Hidden while a text
          search is active — the results are the answer then, and the tiles
          would push them down. */}
      {!hasQuery && <CategoryNav />}

      <section className="deck">
        <MarketplaceResults
          isLoggedIn={Boolean(user)}
          viewerId={user?.id ?? null}
          page={page}
          basePath="/marketplace"
          params={filters as Record<string, string | undefined>}
          emptyTitle={
            hasQuery
              ? `No parts match${filters.q ? ` "${filters.q}"` : " those filters"}`
              : "Nothing listed right now"
          }
          emptyBody={
            hasQuery
              ? "Widen the filters, or clear them and browse by category."
              : "Parts land here as owners pull them off their builds. Check back — or list the first one."
          }
        />
      </section>

      <Foot
        left="DRVN — every part came off a real car"
        right={<Link href="/home">← Home</Link>}
      />
    </div>
  );
}

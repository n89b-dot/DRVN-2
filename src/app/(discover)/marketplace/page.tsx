import Link from "next/link";

import { CategoryIcon, ListingCard, SectionLabel } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { CATEGORIES } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { FilterBar } from "./filter-bar";

export const metadata = { title: "Marketplace - DRVN" };

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

  const listings = await fetchListings(supabase, filters, user?.id);
  const hasQuery = Boolean(filters.q || filters.condition || filters.min || filters.max || filters.fit);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 md:py-14">
      <div className="flex items-end justify-between gap-4">
        <div>
          <SectionLabel>Marketplace</SectionLabel>
          <h1 className="mt-3 text-2xl font-bold text-text-primary">
            Parts with real car context.
          </h1>
        </div>
        <Link
          href="/sell"
          className="shrink-0 rounded-pill bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90"
        >
          Sell a part
        </Link>
      </div>

      <div className="mt-6">
        <FilterBar action="/marketplace" filters={filters} showFitToggle={Boolean(user)} />
      </div>

      {!hasQuery && (
        <div className="mt-8">
          <SectionLabel>Browse by category</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {CATEGORIES.map((category) => (
              <Link
                key={category.slug}
                href={`/marketplace/${category.slug}`}
                className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface px-4 py-6 text-center transition hover:border-text-muted"
              >
                <span className="text-accent">
                  <CategoryIcon name={category.icon} />
                </span>
                <span className="text-sm font-semibold text-text-primary">{category.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10">
        <SectionLabel>{hasQuery ? `Results (${listings.length})` : "Latest listings"}</SectionLabel>
        {listings.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-text-muted">
            {hasQuery ? "Nothing matches those filters yet." : "No listings yet — be the first to sell a part."}
          </p>
        )}
      </div>
    </div>
  );
}

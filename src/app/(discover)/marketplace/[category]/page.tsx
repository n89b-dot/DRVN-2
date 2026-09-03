import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { CategoryIcon, Foot } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { getCategory } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { ActiveFilters } from "../active-filters";
import { CategoryNav, CategorySheet } from "../category-nav";
import { MarketplaceResults } from "@/features/marketplace/results";
import { FilterBar } from "../filter-bar";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<ListingFilters>;
}) {
  const { category: categorySlug } = await params;
  const filters = await searchParams;
  const category = getCategory(categorySlug);
  if (!category) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const page = await fetchListings(
      supabase,
      { ...filters, category: category.slug, subcategory: filters.subcategory },
      user?.id,
    );
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
        <span className="microlabel">
          <Link href="/marketplace" className="hover:text-live">
            Marketplace
          </Link>{" "}
          / {category.label}
        </span>
        <h1 className="flex items-center gap-3">
          <span className="cat-ico shrink-0" aria-hidden="true">
            <CategoryIcon name={category.icon} className="h-5 w-5" />
          </span>
          {category.label}
        </h1>
      </Rv>
      <FilterBar
        action={`/marketplace/${category.slug}`}
        filters={filters}
        showFitToggle={Boolean(user)}
        browse={<CategorySheet currentCategory={category.slug} />}
      />
      <ActiveFilters
        basePath={`/marketplace/${category.slug}`}
        filters={filters as Record<string, string | undefined>}
      />

      {/* Subcategory tiles (≥640px); the Browse sheet carries them on compact. */}
      {!hasQuery && <CategoryNav category={category} />}

      <section className="deck">
        <MarketplaceResults
          isLoggedIn={Boolean(user)}
          viewerId={user?.id ?? null}
          page={page}
          basePath={`/marketplace/${category.slug}`}
          params={filters as Record<string, string | undefined>}
          emptyTitle={`No ${category.label.toLowerCase()} listed right now`}
          emptyBody="Parts land here as owners pull them off their builds — check back, or be the first to list one."
        />
      </section>

      <Foot
        left={`DRVN — marketplace / ${category.label.toLowerCase()}`}
        right={<Link href="/marketplace">← All parts</Link>}
      />
    </div>
  );
}

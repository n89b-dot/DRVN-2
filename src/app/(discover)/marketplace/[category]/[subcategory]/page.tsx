import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { getCategory } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { ActiveFilters } from "../../active-filters";
import { CategoryNav, CategorySheet } from "../../category-nav";
import { MarketplaceResults } from "@/features/marketplace/results";
import { FilterBar } from "../../filter-bar";

export default async function SubcategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string; subcategory: string }>;
  searchParams: Promise<ListingFilters>;
}) {
  const { category: categorySlug, subcategory: subSlug } = await params;
  const filters = await searchParams;
  const category = getCategory(categorySlug);
  const subcategory = category?.subcategories.find((s) => s.slug === subSlug);
  if (!category || !subcategory) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const page = await fetchListings(
      supabase,
      { ...filters, category: category.slug, subcategory: subcategory.slug },
      user?.id,
    );

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">
          <Link href="/marketplace" className="hover:text-live">
            Marketplace
          </Link>{" "}
          /{" "}
          <Link
            href={`/marketplace/${category.slug}`}
            className="hover:text-live"
          >
            {category.label}
          </Link>{" "}
          / {subcategory.label}
        </span>
        <h1>{subcategory.label}</h1>
      </Rv>
      <FilterBar
        action={`/marketplace/${category.slug}/${subcategory.slug}`}
        filters={filters}
        showFitToggle={Boolean(user)}
        browse={
          <CategorySheet
            currentCategory={category.slug}
            currentSubcategory={subcategory.slug}
          />
        }
      />
      <ActiveFilters
        basePath={`/marketplace/${category.slug}/${subcategory.slug}`}
        filters={filters as Record<string, string | undefined>}
      />

      {/* Leaf of the taxonomy: sibling subcategories stay one tap away as a
          quiet row — the sheet you're on is inked, the rest are a hop
          sideways. No tiles here; there is nothing further down. */}
      <CategoryNav category={category} subcategory={subcategory.slug} />

      <section className="deck">
        <MarketplaceResults
          isLoggedIn={Boolean(user)}
          viewerId={user?.id ?? null}
          page={page}
          basePath={`/marketplace/${category.slug}/${subcategory.slug}`}
          params={filters as Record<string, string | undefined>}
          emptyTitle={`No ${subcategory.label.toLowerCase()} listed right now`}
          emptyBody={`Nothing in ${category.label.toLowerCase()} / ${subcategory.label.toLowerCase()} yet — check back, or be the first to list one.`}
        />
      </section>

      <Foot
        left={`DRVN — marketplace / ${subcategory.label.toLowerCase()}`}
        right={
          <Link href={`/marketplace/${category.slug}`}>← {category.label}</Link>
        }
      />
    </div>
  );
}

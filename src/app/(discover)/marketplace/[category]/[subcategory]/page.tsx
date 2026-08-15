import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, MarketplaceNav } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { getCategory } from "@/lib/marketplace/taxonomy";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { createClient } from "@/lib/supabase/server";

import { ActiveFilters } from "../../active-filters";
import { MarketplaceResults } from "../../results";
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

  const [page, offersCount] = await Promise.all([
    fetchListings(
      supabase,
      { ...filters, category: category.slug, subcategory: subcategory.slug },
      user?.id
    ),
    user ? loadOffersNeedingAttention(supabase, user.id) : Promise.resolve(0),
  ]);

  return (
    <div className="wrap">
      {user && <MarketplaceNav current="marketplace" offersCount={offersCount} />}

      <Rv as="header" className="pagehead">
        <span className="microlabel">
          <Link href="/marketplace" className="hover:text-live">
            Marketplace
          </Link>{" "}
          /{" "}
          <Link href={`/marketplace/${category.slug}`} className="hover:text-live">
            {category.label}
          </Link>{" "}
          / {subcategory.label} · {page.total} listed
        </span>
        <h1>{subcategory.label}</h1>
      </Rv>

      <FilterBar
        action={`/marketplace/${category.slug}/${subcategory.slug}`}
        filters={filters}
        showFitToggle={Boolean(user)}
      />
      <ActiveFilters
        basePath={`/marketplace/${category.slug}/${subcategory.slug}`}
        filters={filters as Record<string, string | undefined>}
      />

      {/* Sibling subcategories stay one tap away — the sheet you're on is
          inked, the rest are a hop sideways, matching the category page. */}
      <div className="filters filters--roomy filters--scroll">
        <span className="microlabel filters__label">Narrow it down</span>
        <Link href={`/marketplace/${category.slug}`} className="fbtn">
          All
        </Link>
        {category.subcategories.map((sub) => (
          <Link
            key={sub.slug}
            href={`/marketplace/${category.slug}/${sub.slug}`}
            className={`fbtn ${sub.slug === subcategory.slug ? "is-on" : ""}`}
          >
            {sub.label}
          </Link>
        ))}
      </div>

      <section className="deck">
        <MarketplaceResults
          page={page}
          basePath={`/marketplace/${category.slug}/${subcategory.slug}`}
          params={filters as Record<string, string | undefined>}
          emptyTitle={`No ${subcategory.label.toLowerCase()} listed right now`}
          emptyBody={`Nothing in ${category.label.toLowerCase()} / ${subcategory.label.toLowerCase()} yet — check back, or be the first to list one.`}
        />
      </section>

      <Foot
        left={`DRVN — marketplace / ${subcategory.label.toLowerCase()}`}
        right={<Link href={`/marketplace/${category.slug}`}>← {category.label}</Link>}
      />
    </div>
  );
}

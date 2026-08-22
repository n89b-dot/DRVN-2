import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, MarketplaceNav } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { getCategory } from "@/lib/marketplace/taxonomy";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { createClient } from "@/lib/supabase/server";

import { ActiveFilters } from "../active-filters";
import { MarketplaceResults } from "../results";
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

  const [page, offersCount] = await Promise.all([
    fetchListings(
      supabase,
      { ...filters, category: category.slug, subcategory: filters.subcategory },
      user?.id
    ),
    user ? loadOffersNeedingAttention(supabase, user.id) : Promise.resolve(0),
  ]);

  return (
    <div className="wrap">
      {user && <MarketplaceNav current="marketplace" offersCount={offersCount} />}

      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">
          <Link href="/marketplace" className="hover:text-live">
            Marketplace
          </Link>{" "}
          / {category.label} · {page.total} listed
        </span>
        <h1>{category.label}</h1>
      </Rv>

      <FilterBar action={`/marketplace/${category.slug}`} filters={filters} showFitToggle={Boolean(user)} />
      <ActiveFilters
        basePath={`/marketplace/${category.slug}`}
        filters={filters as Record<string, string | undefined>}
      />

      <div className="filters filters--roomy filters--scroll">
        <span className="microlabel filters__label">Narrow it down</span>
        <Link href={`/marketplace/${category.slug}`} className={`fbtn ${!filters.subcategory ? "is-on" : ""}`}>
          All
        </Link>
        {category.subcategories.map((sub) => (
          <Link key={sub.slug} href={`/marketplace/${category.slug}/${sub.slug}`} className="fbtn">
            {sub.label}
          </Link>
        ))}
      </div>

      <section className="deck">
        <MarketplaceResults
          isLoggedIn={Boolean(user)}
          page={page}
          basePath={`/marketplace/${category.slug}`}
          params={filters as Record<string, string | undefined>}
          emptyTitle={`No ${category.label.toLowerCase()} listed right now`}
          emptyBody="Parts land here as owners pull them off their builds — check back, or be the first to list one."
        />
      </section>

      <Foot left={`DRVN — marketplace / ${category.label.toLowerCase()}`} right={<Link href="/marketplace">← All parts</Link>} />
    </div>
  );
}

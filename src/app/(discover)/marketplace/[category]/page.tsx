import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { getCategory } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

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

  const page = await fetchListings(
    supabase,
    { ...filters, category: category.slug, subcategory: filters.subcategory },
    user?.id
  );

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          <Link href="/marketplace" className="hover:text-live">
            Marketplace
          </Link>{" "}
          / {category.label} · {page.total} listed
        </span>
        <h1>{category.label}</h1>
      </Rv>

      <div className="filters">
        <Link href={`/marketplace/${category.slug}`} className={`fbtn ${!filters.subcategory ? "is-on" : ""}`}>
          All
        </Link>
        {category.subcategories.map((sub) => (
          <Link key={sub.slug} href={`/marketplace/${category.slug}/${sub.slug}`} className="fbtn">
            {sub.label}
          </Link>
        ))}
      </div>

      <div className="mb-6">
        <FilterBar action={`/marketplace/${category.slug}`} filters={filters} showFitToggle={Boolean(user)} />
      </div>

      <section className="deck">
        <MarketplaceResults
          page={page}
          basePath={`/marketplace/${category.slug}`}
          params={filters as Record<string, string | undefined>}
        />
      </section>

      <Foot left={`DRVN — marketplace / ${category.label.toLowerCase()}`} right={<Link href="/marketplace">← All parts</Link>} />
    </div>
  );
}

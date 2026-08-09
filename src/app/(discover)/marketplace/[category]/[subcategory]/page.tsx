import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { getCategory } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

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

  const page = await fetchListings(
    supabase,
    { ...filters, category: category.slug, subcategory: subcategory.slug },
    user?.id
  );

  return (
    <div className="wrap">
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

      {/* Sibling subcategories stay one tap away — the sheet you're on is
          inked, the rest are a hop sideways, matching the category page. */}
      <div className="filters">
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
        />
      </section>

      <Foot
        left={`DRVN — marketplace / ${subcategory.label.toLowerCase()}`}
        right={<Link href={`/marketplace/${category.slug}`}>← {category.label}</Link>}
      />
    </div>
  );
}

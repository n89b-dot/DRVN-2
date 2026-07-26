import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, ListingCard } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { getCategory } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

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

  const listings = await fetchListings(
    supabase,
    { ...filters, category: category.slug, subcategory: filters.subcategory },
    user?.id
  );

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          <Link href="/marketplace" className="hover:text-live">
            Market
          </Link>{" "}
          / {category.label} · {listings.length} showing
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
        {listings.length > 0 ? (
          <div className="mkt">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="undrawn">
            <span className="undrawn__mark" aria-hidden="true">
              ⌕
            </span>
            <h3>Nothing in {category.label} right now</h3>
            <p>
              The moment a {category.label.toLowerCase()} line is released off a sheet it lands
              here. Widen the filter, or check the whole market.
            </p>
            <Link href="/marketplace" className="btn btn--ghost">
              Back to the market
            </Link>
          </div>
        )}
      </section>

      <Foot left={`DRVN / Livesheet — market / ${category.label.toLowerCase()}`} right={<Link href="/marketplace">← The market</Link>} />
    </div>
  );
}

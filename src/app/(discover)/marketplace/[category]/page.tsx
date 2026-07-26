import Link from "next/link";
import { notFound } from "next/navigation";

import { ListingCard, SectionLabel } from "@/components/ui";
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
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 md:py-14">
      <Link href="/marketplace" className="text-sm text-text-muted transition hover:text-text-secondary">
        ← Marketplace
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-text-primary">{category.label}</h1>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/marketplace/${category.slug}`}
          className={`rounded-pill border px-4 py-1.5 text-sm transition ${
            !filters.subcategory
              ? "border-accent bg-accent/10 text-accent"
              : "border-border text-text-secondary hover:text-text-primary"
          }`}
        >
          All
        </Link>
        {category.subcategories.map((sub) => (
          <Link
            key={sub.slug}
            href={`/marketplace/${category.slug}/${sub.slug}`}
            className="rounded-pill border border-border px-4 py-1.5 text-sm text-text-secondary transition hover:text-text-primary"
          >
            {sub.label}
          </Link>
        ))}
      </div>

      <div className="mt-6">
        <FilterBar action={`/marketplace/${category.slug}`} filters={filters} showFitToggle={Boolean(user)} />
      </div>

      <div className="mt-8">
        <SectionLabel>{listings.length} listings</SectionLabel>
        {listings.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-text-muted">No listings in {category.label} yet.</p>
        )}
      </div>
    </div>
  );
}

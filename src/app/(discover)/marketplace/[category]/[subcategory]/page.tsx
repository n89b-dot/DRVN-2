import Link from "next/link";
import { notFound } from "next/navigation";

import { ListingCard, SectionLabel } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { getCategory } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

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

  const listings = await fetchListings(
    supabase,
    { ...filters, category: category.slug, subcategory: subcategory.slug },
    user?.id
  );

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 md:py-14">
      <Link
        href={`/marketplace/${category.slug}`}
        className="text-sm text-text-muted transition hover:text-text-secondary"
      >
        ← {category.label}
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-text-primary">{subcategory.label}</h1>

      <div className="mt-6">
        <FilterBar
          action={`/marketplace/${category.slug}/${subcategory.slug}`}
          filters={filters}
          showFitToggle={Boolean(user)}
        />
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
          <p className="mt-3 text-sm text-text-muted">No listings in {subcategory.label} yet.</p>
        )}
      </div>
    </div>
  );
}

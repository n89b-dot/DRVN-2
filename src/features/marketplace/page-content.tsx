import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Foot, PageHead } from "@/components/ui";
import { fetchListings } from "@/lib/marketplace/query";
import { CATEGORY_REDIRECTS, categoryHref, hasMarketplaceSearch, marketplaceHref, marketplacePath, normalizeMarketplaceState, type RawMarketplaceParams } from "@/lib/marketplace/state";
import { getCategory } from "@/lib/marketplace/taxonomy";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";
import { ActiveFilters } from "@/app/(discover)/marketplace/active-filters";
import { CategoryNav, CategorySheet } from "@/app/(discover)/marketplace/category-nav";
import { FilterBar } from "@/app/(discover)/marketplace/filter-bar";
import { MarketplaceResults } from "./results";
import { VehicleControl } from "./vehicle-control";
import { resolveVehicleFilter } from "@/lib/vehicles/catalog";
import { SaveSearchButton } from "./save-search-button";
import { orderCars } from "@/lib/cars/order";

/** Every marketplace route composes the same controls and result states. */
export async function MarketplacePageContent({ raw, categorySlug, subcategorySlug }: {
  raw: RawMarketplaceParams;
  categorySlug?: string;
  subcategorySlug?: string;
}) {
  const canonicalCategory = categorySlug ? CATEGORY_REDIRECTS[categorySlug] ?? categorySlug : undefined;
  const category = canonicalCategory ? getCategory(canonicalCategory) : undefined;
  if (categorySlug && !category) notFound();
  if (subcategorySlug && !category?.subcategories.some(s => s.slug === subcategorySlug)) notFound();
  const filters = normalizeMarketplaceState({
    ...raw,
    ...(categorySlug ? { category: canonicalCategory, subcategory: subcategorySlug ?? raw.subcategory } : {}),
  });
  const basePath = marketplacePath(filters);
  const requestedPath = `/marketplace${categorySlug ? `/${categorySlug}` : ""}${subcategorySlug ? `/${subcategorySlug}` : ""}`;
  if (basePath !== requestedPath) redirect(marketplaceHref(filters));

  const [supabase, user] = await Promise.all([getPageClient(), getViewer()]);
  const vehiclePromise = filters.vehicle ? resolveVehicleFilter(filters.vehicle) : Promise.resolve(null);
  // P-5: the shopper's own car order, so the picker leads with the car they
  // mean. The main car is OFFERED as a one-tap choice, never applied — see
  // VehicleControl.
  const garagePromise = user
    ? Promise.all([
        supabase.from("cars").select("id, name, make, model, year, created_at, catalog_make_id, catalog_model_id").eq("owner_id", user.id),
        supabase.from("profiles").select("main_car_id").eq("id", user.id).maybeSingle(),
      ]).then(([{ data }, { data: profile }]) =>
        orderCars(data ?? [], profile?.main_car_id).map(car => ({ ...car, isMain: car.id === profile?.main_car_id }))
      )
    : Promise.resolve([]);
  const pagePromise = fetchListings(supabase, filters, user?.id, { garage: garagePromise, selection: vehiclePromise });
  // M-6's facet: the brands that actually have parts live, so the field
  // suggests what exists rather than a hardcoded list that goes stale.
  const brandPromise = Promise.resolve(supabase.rpc("marketplace_brand_counts"))
    .then(({ data, error }) => (error ? [] : ((data ?? []) as { brand: string; total: number }[])));
  const categoryPromise = Promise.resolve(supabase.rpc("marketplace_category_counts")).then(categoryResult => categoryResult.error ? undefined : (categoryResult.data ?? []).reduce<Record<string, number>>((counts, row) => {
    counts[row.category] = (counts[row.category] ?? 0) + Number(row.total);
    if (row.subcategory) counts[`${row.category}/${row.subcategory}`] = Number(row.total);
    counts.all = (counts.all ?? 0) + Number(row.total);
    return counts;
  }, {}));
  const [vehicle, garage, brands] = await Promise.all([vehiclePromise, garagePromise, brandPromise]);
  const garageChoices = (garage ?? []).flatMap(car => car.catalog_make_id ? [{ label: car.name, vehicle: `${car.catalog_make_id}${car.catalog_model_id ? `-${car.catalog_model_id}` : ""}`, year: car.year ? String(car.year) : "", isMain: car.isMain }] : []);
  const leaf = category?.subcategories.find(s => s.slug === filters.subcategory);
  const title = leaf?.label ?? category?.label ?? "Marketplace";

  return (
    <div className="wrap marketplace-page">
      {category && (
        <nav aria-label="Breadcrumb" className="marketplace-breadcrumb">
          <ol>
            <li><Link href={categoryHref(filters)}>Marketplace</Link></li>
            <li>{leaf ? <Link href={categoryHref(filters, category.slug)}>{category.label}</Link> : <span aria-current="page">{category.label}</span>}</li>
            {leaf && <li><span aria-current="page">{leaf.label}</span></li>}
          </ol>
        </nav>
      )}
      <PageHead className="pagehead--task marketplace-head" title={title} sub={!category ? "Find parts from real builds. See where they came from." : undefined} reveal={false} />
      <FilterBar
        key={`filters:${marketplaceHref(filters)}`}
        action={basePath}
        filters={filters}
        showFitToggle={Boolean(user)}
        brands={brands}
        browse={<CategorySheet currentCategory={category?.slug} currentSubcategory={leaf?.slug} filters={filters} />}
      />
      <VehicleControl key={`vehicle-${filters.vehicle}-${filters.vyear}`} filters={filters} selection={vehicle} garage={garageChoices} />
      <ActiveFilters basePath={basePath} filters={filters} vehicleLabel={vehicle ? [filters.vyear, vehicle.label].filter(Boolean).join(" ") : undefined} />
      {(hasMarketplaceSearch(filters) || category) && <SaveSearchButton key={`saved-search:${marketplaceHref(filters)}`} resume={raw.action === "save_search"} signedIn={Boolean(user)} params={Object.fromEntries(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])))} />}
      <Suspense fallback={<CategoryNav category={category} subcategory={leaf?.slug} filters={filters} compact={hasMarketplaceSearch(filters) || Boolean(leaf)} />}>
        {categoryPromise.then(counts => <CategoryNav counts={counts} category={category} subcategory={leaf?.slug} filters={filters} compact={hasMarketplaceSearch(filters) || Boolean(leaf)} />)}
      </Suspense>
      <section className="deck" aria-label="Marketplace results">
        <Suspense key={marketplaceHref(filters)} fallback={<div role="status" className="marketplace-grid is-loading" aria-label="Loading parts">{Array.from({ length: 8 }, (_, i) => <div key={i} className="marketplace-card" aria-hidden="true"><span className="gbox block !h-auto !w-full aspect-[4/3]" /><span className="gbar my-4 !w-3/4" /></div>)}</div>}>
        {pagePromise.then(page => (
        <MarketplaceResults
          page={page}
          basePath={basePath}
          params={filters}
          isLoggedIn={Boolean(user)}
          viewerId={user?.id ?? null}
          emptyTitle={category ? `No ${title.toLowerCase()} listed right now` : "No parts listed right now"}
          emptyBody="Parts arrive as owners release them from their builds. Browse another category or check back soon."
        />
        ))}
        </Suspense>
      </section>
      <Foot left="DRVN — marketplace" right={<><Link href={categoryHref(filters)}>All parts</Link><span aria-hidden="true"> · </span><Link href="/terms">Shopping policies</Link></>} />
    </div>
  );
}

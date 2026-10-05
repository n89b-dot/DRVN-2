import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Alert, FilterGroup, FilterLink, Foot, PageHead } from "@/components/ui";
import { fetchListings } from "@/lib/marketplace/query";
import { CATEGORY_REDIRECTS, categoryHref, hasMarketplaceSearch, marketplaceHref, marketplacePath, normalizeMarketplaceState, type RawMarketplaceParams } from "@/lib/marketplace/state";
import { getCategory } from "@/lib/marketplace/taxonomy";
import { getPageClient, getPublicPageClient, getViewer } from "@/lib/supabase/page-context";
import { betaAccessIsEnforced } from "@/lib/beta-access";
import { ActiveFilters } from "@/app/(discover)/marketplace/active-filters";
import { CategoryNav, CategorySheet, CategorySidebarList } from "@/app/(discover)/marketplace/category-nav";
import { FilterBar } from "@/app/(discover)/marketplace/filter-bar";
import { MarketplaceResults } from "./results";
import { VehicleControl } from "./vehicle-control";
import { resolveVehicleFilter } from "@/lib/vehicles/catalog";
import { SaveSearchButton } from "./save-search-button";
import { orderCars } from "@/lib/cars/order";
import { createPublicClient } from "@/lib/supabase/public";

/** Every marketplace route composes the same controls and result states. */
export async function MarketplacePageContent({ raw, categorySlug, subcategorySlug }: {
  raw: RawMarketplaceParams;
  categorySlug?: string;
  subcategorySlug?: string;
}) {
  const canonicalCategory = categorySlug ? CATEGORY_REDIRECTS[categorySlug] ?? categorySlug : undefined;
  const resolvedCategory = canonicalCategory ? getCategory(canonicalCategory) : undefined;
  // A slug that names nothing isn't a dead end: the visitor was looking for
  // parts, so they get the marketplace (the whole of it, or the category they
  // did get right) with a line saying what wasn't found — never the generic
  // "this car, part or profile isn't around" page.
  const missing = categorySlug && !resolvedCategory
    ? categorySlug
    : subcategorySlug && !resolvedCategory?.subcategories.some(s => s.slug === subcategorySlug)
      ? subcategorySlug
      : null;
  const category = resolvedCategory;
  const leafSlug = missing === subcategorySlug ? undefined : subcategorySlug;
  const filters = normalizeMarketplaceState({
    ...raw,
    ...(category ? { category: category.slug, subcategory: leafSlug ?? raw.subcategory } : {}),
  });
  const basePath = marketplacePath(filters);
  const requestedPath = `/marketplace${categorySlug ? `/${categorySlug}` : ""}${subcategorySlug ? `/${subcategorySlug}` : ""}`;
  if (!missing && basePath !== requestedPath) redirect(marketplaceHref(filters));

  // Typed searches and price ranges are different for nearly every shopper,
  // so they read live; the shared copy is for the category pages, sorts and
  // vehicle filters every signed-out visitor sees the same.
  const freeForm = [filters.q, filters.brand, filters.location, filters.min, filters.max, filters.ymin, filters.ymax].some(Boolean);
  const [supabase, user, betaEnforced] = await Promise.all([freeForm ? getPageClient() : getPublicPageClient(), getViewer(), betaAccessIsEnforced()]);
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

  // M-6's facet: the brands that actually have parts live, so the field
  // suggests what exists rather than a hardcoded list that goes stale.
  // Both counts are the same for every shopper, so they come through a
  // one-minute cache instead of being grouped on every view.
  const countsClient = createPublicClient({ maxAge: 60, kinds: ["listings"] });
  const brandPromise = Promise.resolve(countsClient.rpc("marketplace_brand_counts"))
    .then(({ data, error }) => (error ? [] : ((data ?? []) as { brand: string; total: number }[])));
  const categoryPromise = Promise.resolve(countsClient.rpc("marketplace_category_counts")).then(categoryResult => categoryResult.error ? undefined : (categoryResult.data ?? []).reduce<Record<string, number>>((counts, row) => {
    counts[row.category] = (counts[row.category] ?? 0) + Number(row.total);
    if (row.subcategory) counts[`${row.category}/${row.subcategory}`] = Number(row.total);
    counts.all = (counts.all ?? 0) + Number(row.total);
    return counts;
  }, {}));
  // An unfiltered view's total is one of the category counts already being
  // read, so the page of parts is fetched without counting them a second
  // time — at volume the count costs far more than the page.
  const totalKey = filters.subcategory && filters.category ? `${filters.category}/${filters.subcategory}` : filters.category ?? "all";
  const pagePromise = fetchListings(supabase, filters, user?.id, {
    garage: garagePromise,
    selection: vehiclePromise,
    ...(hasMarketplaceSearch(filters) ? {} : { total: categoryPromise.then((counts) => (counts ? counts[totalKey] ?? 0 : undefined)) }),
  });
  // The condition choices offered are the ones with parts in them: a filter
  // whose options always return nothing is worse than no option. Read from
  // the totals table (migration 20261011120000) — every condition in use,
  // where sampling the first 1,000 parts could miss a rare one; before that
  // migration, the sample.
  const conditionPromise = Promise.resolve(countsClient.from("marketplace_facet_counts").select("key").eq("facet", "condition"))
    .then(async ({ data, error }) => {
      if (!error) return (data ?? []).map(row => row.key);
      const sample = await countsClient.rpc("marketplace_browse_rows", {}).select("condition").limit(1000);
      return sample.error ? undefined : [...new Set((sample.data ?? []).flatMap(row => row.condition ? [row.condition] : []))];
    });
  // The sidebar's category list is handed to a client component as a prop,
  // where a Suspense boundary left BOTH its placeholder and its resolved
  // list in the document. The counts are one small grouped query already in
  // flight, so the list simply waits for them with everything else here.
  const [vehicle, garage, brands, allCategoryCounts, conditions] = await Promise.all([
    vehiclePromise,
    garagePromise,
    brandPromise,
    categoryPromise,
    conditionPromise,
  ]);
  // The counts are for everything listed, not for this search — shown beside
  // a search they promise parts that aren't there, so they only show without one.
  const searching = hasMarketplaceSearch(filters);
  const categoryCounts = searching ? undefined : allCategoryCounts;
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
      <PageHead className="pagehead--task marketplace-head" title={title} sub={!category ? "Find parts from real builds. See where they came from." : undefined} reveal={false}>
        {/* Signed out, the loudest thing in the header is "Join DRVN" — say
            plainly that shopping doesn't need it. The invite-only beta closes
            guest checkout, so the promise follows the gate. */}
        {!user && (
          <p className="marketplace-head__visitor">
            {betaEnforced ? "No account needed to browse" : "No account needed to buy"} · Payment held until it arrives ·{" "}
            <Link href="/protection" className="jumplink">Buyer protection</Link>
          </p>
        )}
      </PageHead>
      {missing && (
        <Alert ico="?" title={<>There&apos;s no category called &ldquo;{missing.replace(/-/g, " ")}&rdquo;</>} className="mb-6">
          {category ? `Here's everything in ${category.label} instead` : "Here's every part for sale instead"} — or choose a category.
        </Alert>
      )}
      {/* On phones there is no sidebar, so a category's part types are a
          wrapping chip row under its title (wrapping, never a sideways
          shelf). Wider screens have the sidebar and the tiles. */}
      {category && (
        <FilterGroup ariaLabel={`${category.label} part types`} sub className="marketplace-subcats sm:!hidden">
          <FilterLink href={categoryHref(filters, category.slug)} selected={!leaf}>
            All
          </FilterLink>
          {/* Only the types with parts in them (and the one you're on). */}
          {category.subcategories.filter(sub => !allCategoryCounts || sub.slug === leaf?.slug || (allCategoryCounts[`${category.slug}/${sub.slug}`] ?? 0) > 0).map(sub => (
            <FilterLink key={sub.slug} href={categoryHref(filters, category.slug, sub.slug)} selected={sub.slug === leaf?.slug}>
              {sub.label}
            </FilterLink>
          ))}
        </FilterGroup>
      )}
      {/* M-3. From 1024px this is a two-column sheet: the filters down the
          left, everything else beside them. The filter fields never leave
          the search form — the form and its wrappers go `display: contents`
          at that width, so the panel becomes a cell of THIS grid while
          staying a child of the form that submits it. One set of fields,
          no second copy of the state, no `form=` attributes to forget. */}
      <div className="marketplace-layout">
      <FilterBar
        key={`filters:${marketplaceHref(filters)}`}
        action={basePath}
        filters={filters}
        showFitToggle={Boolean(user)}
        brands={brands}
        conditions={conditions}
        browse={<CategorySheet currentCategory={category?.slug} currentSubcategory={leaf?.slug} filters={filters} />}
        sidebar={<CategorySidebarList counts={categoryCounts} category={category} subcategory={leaf?.slug} filters={filters} />}
      />
      <ActiveFilters basePath={basePath} filters={filters} vehicleLabel={vehicle ? [filters.vyear, vehicle.label].filter(Boolean).join(" ") : undefined} />
      <Suspense fallback={<CategoryNav category={category} subcategory={leaf?.slug} filters={filters} compact={hasMarketplaceSearch(filters) || Boolean(leaf)} />}>
        {categoryPromise.then(counts => <CategoryNav counts={searching ? undefined : counts} category={category} subcategory={leaf?.slug} filters={filters} compact={hasMarketplaceSearch(filters) || Boolean(leaf)} />)}
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
          /* The vehicle picker rides on the count's row: on a phone it was a
             fourth row of controls above the first part. */
          headEnd={
            <span className="marketplace-results-head__end">
              {/* Save search belongs to the result set it saves — beside the
                  count, not floating alone above it like a heading. */}
              {(hasMarketplaceSearch(filters) || category) && <SaveSearchButton key={`saved-search:${marketplaceHref(filters)}`} resume={raw.action === "save_search"} signedIn={Boolean(user)} params={Object.fromEntries(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])))} />}
              <VehicleControl key={`vehicle-${filters.vehicle}-${filters.vyear}`} filters={filters} selection={vehicle} garage={garageChoices} />
            </span>
          }
        />
        ))}
        </Suspense>
      </section>
      </div>
      <Foot left="DRVN — marketplace" right={<><Link href={categoryHref(filters)}>All parts</Link><span aria-hidden="true"> · </span><Link href="/terms">Shopping policies</Link></>} />
    </div>
  );
}

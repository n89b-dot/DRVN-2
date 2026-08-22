import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { CategoryIcon, Foot, MarketplaceNav, SellCta } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { CATEGORIES } from "@/lib/marketplace/taxonomy";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { createClient } from "@/lib/supabase/server";

import { ActiveFilters } from "./active-filters";
import { FilterBar } from "./filter-bar";
import { MarketplaceResults } from "./results";

export const metadata = { title: "Marketplace - DRVN" };

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<ListingFilters>;
}) {
  const filters = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The family nav is signed-in navigation, so the badge only ever costs a
  // query for someone who can see it.
  const [page, offersCount] = await Promise.all([
    fetchListings(supabase, filters, user?.id),
    user ? loadOffersNeedingAttention(supabase, user.id) : Promise.resolve(0),
  ]);
  const hasQuery = Boolean(
    filters.q ||
      filters.condition ||
      filters.min ||
      filters.max ||
      filters.fit ||
      filters.location
  );

  return (
    <div className="wrap">
      {/* Marketplace is public — a signed-out visitor browses, searches and
          opens listings without ever being shown Listings/Offers/Orders. */}
      {user && <MarketplaceNav current="marketplace" offersCount={offersCount} />}

      <Rv as="header" className="pagehead pagehead--task">
        {/* Selling lives where every marketplace keeps it: the top corner of
            the page head, beside the headline — not stranded among the
            search controls, and never a full-width interruption above the
            inventory. */}
        <div className="pagehead__row">
          <div className="min-w-0">
            <span className="microlabel">
              Marketplace · {page.total} part{page.total === 1 ? "" : "s"} listed
            </span>
            <h1>
              Find the part. See the car it <span className="live-word">came off.</span>
            </h1>
          </div>
          {/* Signed out this explains why an account is needed rather than
              dropping the visitor on /login mid-thought. */}
          <SellCta isLoggedIn={Boolean(user)} className="shrink-0" />
        </div>
        {/* The standfirst is desktop runway — the task head retires it on
            compact so inventory starts inside the first viewport. */}
        <p className="sub">
          Every part here came off someone&apos;s build — open a listing and you can see
          exactly which one. Search what you need, or browse by category.
        </p>
      </Rv>

      <FilterBar action="/marketplace" filters={filters} showFitToggle={Boolean(user)} />
      <ActiveFilters
        basePath="/marketplace"
        filters={filters as Record<string, string | undefined>}
      />

      <div className="filters filters--roomy filters--scroll">
        <span className="microlabel filters__label">Browse by category</span>
        <Link href="/marketplace" className={`fbtn ${hasQuery ? "" : "is-on"}`}>
          All
        </Link>
        {CATEGORIES.map((category) => (
          <Link key={category.slug} href={`/marketplace/${category.slug}`} className="fbtn">
            <span className="mr-1.5 inline-block align-[-4px]">
              <CategoryIcon name={category.icon} className="h-5 w-5" />
            </span>
            {category.label}
          </Link>
        ))}
      </div>

      <section className="deck">
        <MarketplaceResults
          isLoggedIn={Boolean(user)}
          page={page}
          basePath="/marketplace"
          params={filters as Record<string, string | undefined>}
          emptyTitle={
            hasQuery
              ? `No parts match${filters.q ? ` "${filters.q}"` : " those filters"}`
              : "Nothing listed right now"
          }
          emptyBody={
            hasQuery
              ? "Widen the filters, or clear them and browse by category."
              : "Parts land here as owners pull them off their builds. Check back — or list the first one."
          }
        />
      </section>

      <Foot
        left="DRVN — every part came off a real car"
        right={<Link href="/home">← Home</Link>}
      />
    </div>
  );
}

import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { CategoryIcon, Foot, ListingCard } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { CATEGORIES } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { FilterBar } from "./filter-bar";

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

  const listings = await fetchListings(supabase, filters, user?.id);
  const hasQuery = Boolean(filters.q || filters.condition || filters.min || filters.max || filters.fit);

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          The market · {listings.length} part{listings.length === 1 ? "" : "s"} showing
        </span>
        <h1>
          Parts, straight off
          <br />
          the sheets they <span className="live-word">live</span> on.
        </h1>
        <p className="sub">
          Every listing comes off a drawing — what it came off, when it was fitted, and who&apos;s
          watching it right now.
        </p>
      </Rv>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <FilterBar action="/marketplace" filters={filters} showFitToggle={Boolean(user)} />
        </div>
        <Link href="/sell" className="btn btn--live shrink-0">
          List a part
        </Link>
      </div>

      <div className="filters">
        <Link href="/marketplace" className={`fbtn ${hasQuery ? "" : "is-on"}`}>
          All
        </Link>
        {CATEGORIES.map((category) => (
          <Link key={category.slug} href={`/marketplace/${category.slug}`} className="fbtn">
            <span className="mr-1 inline-block align-[-3px]">
              <CategoryIcon name={category.icon} className="h-4 w-4" />
            </span>
            {category.label}
          </Link>
        ))}
      </div>

      <section className="deck">
        {listings.length > 0 ? (
          <div className="mkt">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <Rv className="undrawn">
            <span className="undrawn__mark" aria-hidden="true">
              ⌕
            </span>
            <h3>{hasQuery ? `No lines match${filters.q ? ` "${filters.q}"` : " those filters"}` : "Nothing on the sheets right now"}</h3>
            <p>
              {hasQuery
                ? "Nothing on the sheets right now. Widen the filters, or let us watch for it."
                : "The moment a part is released off a build line it lands here — annotated by the sheet it left."}
            </p>
            {hasQuery ? (
              <Link href="/marketplace" className="btn btn--ghost">
                Clear filters
              </Link>
            ) : (
              <Link href="/sell" className="btn btn--live">
                List the first part
              </Link>
            )}
          </Rv>
        )}
      </section>

      <Foot
        left="DRVN / Livesheet — every listing is a live sheet, not a dead ad"
        right={<Link href="/home">← Your sheet</Link>}
      />
    </div>
  );
}

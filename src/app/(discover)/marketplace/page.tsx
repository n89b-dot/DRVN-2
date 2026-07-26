import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { CategoryIcon, Foot } from "@/components/ui";
import { fetchListings, type ListingFilters } from "@/lib/marketplace/query";
import { CATEGORIES } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

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

  const page = await fetchListings(supabase, filters, user?.id);
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
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          The market · {page.total} part{page.total === 1 ? "" : "s"} listed
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
        <MarketplaceResults
          page={page}
          basePath="/marketplace"
          params={filters as Record<string, string | undefined>}
          emptyTitle={
            hasQuery
              ? `No lines match${filters.q ? ` "${filters.q}"` : " those filters"}`
              : "Nothing on the sheets right now"
          }
          emptyBody={
            hasQuery
              ? "Widen the filters, or clear them and browse by category."
              : "The moment a part is released off a build line it lands here — annotated by the sheet it left."
          }
        />
      </section>

      <Foot
        left="DRVN / Livesheet — every listing is a live sheet, not a dead ad"
        right={<Link href="/home">← Your sheet</Link>}
      />
    </div>
  );
}

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
          Marketplace · {page.total} part{page.total === 1 ? "" : "s"} listed
        </span>
        <h1>
          Find the part.
          <br />
          See the car it <span className="live-word">came off.</span>
        </h1>
        <p className="sub">
          Every part here came off someone&apos;s build — open a listing and you can see exactly
          which one. Search what you need, or browse by category.
        </p>
      </Rv>

      {/* The basis is what makes this row wrap. With `flex-1` alone the form
          shrank without limit — at 375px it crushed to 166px while "List a
          part" stayed pinned beside it, stranded against a column of ragged
          controls. 940px is the filter row's own single-line width, so the
          button sits beside the form only when the form actually fits on one
          line, and drops beneath it the moment it would have to wrap. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-[940px]">
          <FilterBar action="/marketplace" filters={filters} showFitToggle={Boolean(user)} />
        </div>
        <Link href="/sell" className="btn btn--live w-full shrink-0 sm:w-auto">
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

import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { FilterGroup, FilterLink, Foot, MasonryFeed, Pagination } from "@/components/ui";
import { withParams } from "@/lib/url-params";
import { fetchFeed, type FeedTab } from "@/lib/feed";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Explore - DRVN" };

const TABS: { key: FeedTab; label: string; loggedInOnly?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "cars", label: "Builds" },
  { key: "parts", label: "Parts", loggedInOnly: true },
];

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { tab: tabParam, page: pageParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const visibleTabs = TABS.filter((t) => !t.loggedInOnly || user);
  const tab = (visibleTabs.find((t) => t.key === tabParam)?.key ?? "all") as FeedTab;
  const page = Math.max(1, Number(pageParam) || 1);
  // viewerId powers per-viewer signals on cards (garage fitment hints).
  const feed = await fetchFeed(supabase, tab, Boolean(user), { page, viewerId: user?.id ?? null });
  const items = feed.items;

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">Explore</span>
        <h1>
          See what everyone&apos;s <span className="live-word">building.</span>
        </h1>
        <p className="sub">
          Fresh builds and updates from around DRVN — and every so often, a part you&apos;ve been
          hunting for.
        </p>
      </Rv>

      {/* Link-filters in the marketplace-sort idiom: role=group + aria-current,
          .fbtn reserved for exactly this meaning. (Not SheetTabs — these are
          server-filtered links, and client tab panels would force fetching all
          three feeds per view.) */}
      <FilterGroup label="Show" ariaLabel="Filter the feed" stack>
        {visibleTabs.map((t) => (
          <FilterLink
            key={t.key}
            href={t.key === "all" ? "/explore" : `/explore?tab=${t.key}`}
            selected={tab === t.key}
          >
            {t.label}
          </FilterLink>
        ))}
      </FilterGroup>

      {/* Navigation, not a filter — a ref-link on its own line, outside the
          group, so "changes this page" and "leaves this page" stop sharing a
          costume. Inside the chip row it wrapped in among the chips on mobile
          and read as a fourth option. */}
      <p className="mb-7">
        {/* `.relbtn` is a text link with no height of its own; on a phone it
            still has to be a 44px thing to hit. */}
        <Link
          href="/marketplace"
          className="relbtn !static inline-flex min-h-11 items-center sm:min-h-0"
        >
          Go to the marketplace
        </Link>
      </p>

      <section className="deck">
        <MasonryFeed items={items} />
      </section>

      <Pagination
        page={page}
        hasMore={feed.hasMore}
        hrefFor={(p) =>
          withParams("/explore", { tab: tab !== "all" ? tab : undefined }, { page: p > 1 ? String(p) : undefined })
        }
      />

      <Foot
        left="DRVN — builds and parts from the community"
        right={<Link href="/marketplace">Browse parts →</Link>}
      />
    </div>
  );
}

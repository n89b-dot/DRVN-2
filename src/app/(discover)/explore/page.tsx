import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { FilterGroup, FilterLink, Foot } from "@/components/ui";
import { fetchFeed, type FeedTab } from "@/lib/feed";
import { createClient } from "@/lib/supabase/server";

import { ExploreWall } from "./explore-wall";

export const metadata = { title: "Explore - DRVN" };

const TABS: { key: FeedTab; label: string; loggedInOnly?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "cars", label: "Builds" },
  { key: "updates", label: "Updates" },
  { key: "parts", label: "Parts", loggedInOnly: true },
];

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const visibleTabs = TABS.filter((t) => !t.loggedInOnly || user);
  const tab = (visibleTabs.find((t) => t.key === tabParam)?.key ?? "all") as FeedTab;
  // viewerId powers per-viewer signals on cards (garage fitment hints).
  // Page one renders here; the wall pulls the rest as you scroll.
  const feed = await fetchFeed(supabase, tab, Boolean(user), { page: 1, viewerId: user?.id ?? null });

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

      <ExploreWall
        key={tab}
        tab={tab}
        initialItems={feed.items}
        initialHasMore={feed.hasMore}
        isLoggedIn={Boolean(user)}
      />

      <Foot
        left="DRVN — builds and parts from the community"
        right={<Link href="/marketplace">Browse parts →</Link>}
      />
    </div>
  );
}

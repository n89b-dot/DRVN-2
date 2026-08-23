import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { FilterGroup, FilterLink, Foot } from "@/components/ui";
import { fetchFeed, resolveFeedTab, visibleFeedTabs } from "@/lib/feed";
import { createClient } from "@/lib/supabase/server";

import { ExploreWall } from "./explore-wall";

export const metadata = { title: "Explore - DRVN" };

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

  // The segments are the shared feed taxonomy (lib/feed.ts) — Home's
  // Discovery reads the same list, so the two never disagree.
  const visibleTabs = visibleFeedTabs(Boolean(user));
  const tab = resolveFeedTab(tabParam, Boolean(user));
  // viewerId powers per-viewer signals on cards (garage fitment hints).
  // Page one renders here; the wall pulls the rest as you scroll.
  const feed = await fetchFeed(supabase, tab, Boolean(user), { page: 1, viewerId: user?.id ?? null });

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">Explore</span>
        <h1>
          See what everyone&apos;s <span className="live-word">building.</span>
        </h1>
        <p className="sub">
          Fresh builds and updates from around DRVN — and every so often, a part you&apos;ve been
          hunting for.
        </p>
      </Rv>

      {/* One control band: the filters own the left, the marketplace exit
          owns the right. The CTA is navigation, not a filter — it wears the
          inverted-button costume (never .fbtn) so "changes this page" and
          "leaves this page" stay visually distinct; on phones it's hidden —
          the marketplace lives in the nav and the row crowded the cards. */}
      <div className="explorebar">
        <FilterGroup label="Show" ariaLabel="Filter the feed" stack scroll>
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
        <Link href="/marketplace" className="btn btn--ghost explorebar__cta">
          Go to the marketplace
        </Link>
      </div>

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

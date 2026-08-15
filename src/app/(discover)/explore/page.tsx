import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot, MasonryFeed } from "@/components/ui";
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
      <div className="filters" role="group" aria-label="Filter the feed">
        <span className="microlabel filters__label">Show</span>
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "/explore" : `/explore?tab=${t.key}`}
            className={`fbtn ${tab === t.key ? "is-on" : ""}`}
            aria-current={tab === t.key ? "true" : undefined}
          >
            {t.label}
          </Link>
        ))}
        {/* Navigation, not a filter — a ref-link, not a chip, so "changes this
            page" and "leaves this page" stop sharing a costume. */}
        <Link href="/marketplace" className="relbtn !static self-center sm:ml-auto">
          Go to the marketplace
        </Link>
      </div>

      <section className="deck">
        <MasonryFeed items={items} />
      </section>

      {(page > 1 || feed.hasMore) && (
        <nav className="mb-8 flex items-center justify-between gap-3" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={`/explore?${new URLSearchParams({
                ...(tab !== "all" ? { tab } : {}),
                ...(page - 1 > 1 ? { page: String(page - 1) } : {}),
              }).toString()}`}
              className="btn btn--ghost"
              rel="prev"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="microlabel">Page {page}</span>
          {feed.hasMore ? (
            <Link
              href={`/explore?${new URLSearchParams({
                ...(tab !== "all" ? { tab } : {}),
                page: String(page + 1),
              }).toString()}`}
              className="btn btn--ghost"
              rel="next"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <Foot
        left="DRVN — builds and parts from the community"
        right={<Link href="/marketplace">Browse parts →</Link>}
      />
    </div>
  );
}

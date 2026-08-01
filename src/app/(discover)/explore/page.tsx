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
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const visibleTabs = TABS.filter((t) => !t.loggedInOnly || user);
  const tab = (visibleTabs.find((t) => t.key === tabParam)?.key ?? "all") as FeedTab;
  const items = await fetchFeed(supabase, tab, Boolean(user));

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

      <div className="filters">
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "/explore" : `/explore?tab=${t.key}`}
            className={`fbtn ${tab === t.key ? "is-on" : ""}`}
          >
            {t.label}
          </Link>
        ))}
        <Link href="/marketplace" className="fbtn">
          Go to the marketplace →
        </Link>
      </div>

      <section className="deck">
        <MasonryFeed items={items} />
      </section>

      <Foot
        left="DRVN — builds and parts from the community"
        right={<Link href="/marketplace">Browse parts →</Link>}
      />
    </div>
  );
}

import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot, MasonryFeed } from "@/components/ui";
import { fetchFeed, type FeedTab } from "@/lib/feed";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Explore - DRVN" };

const TABS: { key: FeedTab; label: string; loggedInOnly?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "cars", label: "Car sheets" },
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
        <span className="microlabel">Survey — other people&apos;s sheets</span>
        <h1>
          Other people&apos;s sheets,
          <br />
          while the ink is <span className="live-word">wet.</span>
        </h1>
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
          Open the market →
        </Link>
      </div>

      <section className="deck">
        <MasonryFeed items={items} />
      </section>

      <Foot
        left="DRVN / Livesheet — every tile is drawn from a live sheet"
        right={<Link href="/marketplace">Open the market →</Link>}
      />
    </div>
  );
}

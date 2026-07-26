import Link from "next/link";

import { MasonryFeed } from "@/components/ui";
import { fetchFeed, type FeedTab } from "@/lib/feed";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Explore - DRVN" };

const TABS: { key: FeedTab; label: string; loggedInOnly?: boolean }[] = [
  { key: "all", label: "Trending" },
  { key: "cars", label: "Cars & Builds" },
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
    <div className="mx-auto w-full max-w-[1320px] px-6 py-10 md:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-5xl font-bold tracking-[-0.04em] text-text-primary">Explore</h1>
        <Link
          href="/marketplace"
          className="rounded-full bg-accent px-5 py-3 text-sm font-bold text-white transition hover:bg-accent/90"
        >
          Browse parts
        </Link>
      </div>

      <div className="mt-7 h-px bg-border" />

      <div className="mt-6 flex gap-2">
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "/explore" : `/explore?tab=${t.key}`}
            className={`rounded-full px-3 py-1.5 text-sm font-bold transition ${
              tab === t.key
                ? "bg-[#E6E8EC] text-[#23262F]"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="mt-8">
        <MasonryFeed items={items} />
      </div>
    </div>
  );
}

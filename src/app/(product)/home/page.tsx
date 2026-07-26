import Link from "next/link";

import { ListingCard, Media, SectionLabel } from "@/components/ui";
import { FeedList } from "@/components/ui/feed-list";
import { fetchFeed } from "@/lib/feed";
import { recommendListings } from "@/lib/recommendations";
import { createClient } from "@/lib/supabase/server";

import { PostUpdatePrompt } from "./post-update-prompt";

export const metadata = { title: "Home - DRVN" };

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: cars }, { count: savedCount }, items] = await Promise.all([
    supabase.from("profiles").select("display_name, username").eq("id", user!.id).single(),
    supabase
      .from("cars")
      .select("id, slug, name, cover_image_url")
      .eq("owner_id", user!.id)
      .order("created_at")
      .limit(6),
    supabase.from("saves").select("target_id", { count: "exact", head: true }).eq("user_id", user!.id),
    fetchFeed(supabase, "all", true),
  ]);
  const recommended = await recommendListings(user!.id, 4);

  const firstName = profile?.display_name?.split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-[640px] px-5 py-10 md:py-14">
      {/* Dashboard header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <SectionLabel>Home</SectionLabel>
          <h1 className="mt-2 text-2xl font-bold text-text-primary">
            {firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
          </h1>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/sell"
            className="rounded-pill bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90"
          >
            Sell
          </Link>
          <Link
            href="/garage"
            className="rounded-pill border border-border px-5 py-2.5 text-sm text-text-secondary transition hover:text-text-primary"
          >
            Add a car
          </Link>
        </div>
      </div>

      {/* Garage strip */}
      {(cars ?? []).length > 0 && (
        <div className="mt-6 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {(cars ?? []).map((car) => (
            <Link key={car.id} href={`/cars/${car.slug}`} className="w-36 shrink-0">
              <Media src={car.cover_image_url ?? undefined} alt={car.name} className="h-20 w-36 rounded-tile" />
              <p className="mt-1.5 truncate text-xs font-semibold text-text-secondary">{car.name}</p>
            </Link>
          ))}
        </div>
      )}

      {/* Highlights */}
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link
          href="/saved"
          className="rounded-pill border border-border px-4 py-1.5 text-text-muted transition hover:text-text-secondary"
        >
          {savedCount ?? 0} saved
        </Link>
        <Link
          href="/notifications"
          className="rounded-pill border border-border px-4 py-1.5 text-text-muted transition hover:text-text-secondary"
        >
          Notifications
        </Link>
        <Link
          href="/orders"
          className="rounded-pill border border-border px-4 py-1.5 text-text-muted transition hover:text-text-secondary"
        >
          Orders
        </Link>
        <Link
          href="/marketplace"
          className="rounded-pill border border-border px-4 py-1.5 text-text-muted transition hover:text-text-secondary"
        >
          Marketplace →
        </Link>
      </div>

      {/* Post an update — composer entry */}
      <PostUpdatePrompt
        cars={(cars ?? []).map((c) => ({ id: c.id, name: c.name }))}
        initials={(profile?.display_name ?? "?")
          .split(" ")
          .map((w: string) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase()}
      />

      {/* Recommendations */}
      {recommended.length > 0 && (
        <div className="mt-10">
          <SectionLabel>Recommended for your garage</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-4">
            {recommended.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </div>
      )}

      {/* Feed */}
      <div className="mt-10">
        <SectionLabel>Latest from the scene</SectionLabel>
        <div className="mt-3">
          <FeedList items={items} />
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";

import { LiveDim, Rv } from "@/components/livesheet";
import { Foot, ListingCard, Media } from "@/components/ui";
import { FeedList } from "@/components/ui/feed-list";
import { fetchFeed, fetchFollowedFeed, type FeedItem } from "@/lib/feed";
import { recommendListings } from "@/lib/recommendations";
import { createClient } from "@/lib/supabase/server";

import { PostUpdatePrompt } from "./post-update-prompt";
import { SellerKpis } from "./seller-kpis";

export const metadata = { title: "Home - DRVN" };

const FEED_PAGE_SIZE = 12;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // All five only need user!.id, with no dependency on each other — including
  // recommendListings, which hits its own admin client — so they run together.
  const [{ data: profile }, { data: cars }, { count: savedCount }, followed, recommended] =
    await Promise.all([
      supabase.from("profiles").select("display_name, username").eq("id", user!.id).single(),
      supabase
        .from("cars")
        .select("id, slug, name, cover_image_url")
        .eq("owner_id", user!.id)
        .order("created_at")
        .limit(6),
      supabase.from("saves").select("target_id", { count: "exact", head: true }).eq("user_id", user!.id),
      fetchFollowedFeed(supabase, user!.id, { page, pageSize: FEED_PAGE_SIZE }),
      recommendListings(user!.id, 4),
    ]);

  // The followed feed only covers cars and profiles this viewer follows — it
  // won't fill a page for most accounts, and is empty outright for anyone who
  // hasn't followed a build yet. Discovery (the same feed Explore uses) fills
  // the rest of page one, clearly labelled as such rather than blended in as
  // if it were personalized.
  let discoveryItems: FeedItem[] = [];
  const wantsDiscovery =
    page === 1 && (followed.followsNothing || followed.items.length < FEED_PAGE_SIZE);
  if (wantsDiscovery) {
    const wantCount = followed.followsNothing ? FEED_PAGE_SIZE : FEED_PAGE_SIZE - followed.items.length;
    const discoveryFeed = await fetchFeed(supabase, "all", true, {
      page: 1,
      pageSize: wantCount + followed.items.length,
    });
    const followedKeys = new Set(followed.items.map((i) => `${i.kind}-${i.id}`));
    discoveryItems = discoveryFeed.items
      .filter((i) => !followedKeys.has(`${i.kind}-${i.id}`))
      .slice(0, wantCount);
  }

  const firstName = profile?.display_name?.split(" ")[0];
  const garage = cars ?? [];

  return (
    <div className="wrap">
      {/* Page head — what's happened since you were last here */}
      <Rv as="header" className="pagehead">
        <span className="microlabel">Home</span>
        <h1>
          {greeting()}
          {firstName ? `, ${firstName}` : ""}.
          <br />
          The garage is <span className="live-word">open.</span>
        </h1>
        <p className="sub">
          {followed.followsNothing
            ? "Follow a build or a seller and their updates land here first — until then, this is a mix of what's new across DRVN."
            : "The latest from the builds and people you follow, first — with a Discovery mix underneath once that runs out."}
        </p>
        <div className="jumprow">
          <span className="microlabel">Jump to</span>
          <Link className="jumplink" href="/saved">
            Saved · {savedCount ?? 0}
          </Link>
          <Link className="jumplink" href="/orders">
            Orders
          </Link>
          <Link className="jumplink" href="/notifications">
            Notifications
          </Link>
          <Link className="jumplink" href="/marketplace">
            Marketplace →
          </Link>
        </div>
      </Rv>

      {/* Seller stats — only for people who have listed something */}
      <SellerKpis supabase={supabase} userId={user!.id} />

      {/* The garage + composer */}
      <section className="deck deck--two">
        <Rv className="tile" stagger={0}>
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Your garage</span>
            <span className="chip">
              {garage.length ? `${garage.length} car${garage.length === 1 ? "" : "s"}` : "Empty"}
            </span>
          </div>
          {garage.length > 0 ? (
            <div className="rowlist">
              {garage.map((car) => (
                <Link key={car.id} href={`/cars/${car.slug}`} className="order">
                  <span className="order__img">
                    <Media src={car.cover_image_url ?? undefined} alt={car.name} className="h-full w-full" />
                  </span>
                  <span>
                    <span className="order__name block">{car.name}</span>
                    <span className="order__meta block">view build page →</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="undrawn">
              <span className="undrawn__mark" aria-hidden="true">
                +
              </span>
              <h3>Your car goes here</h3>
              <p>
                Add the car you&apos;re building. Photos, the full mod list, and every part you
                sell off it all live on one build page.
              </p>
              <Link href="/garage" className="btn btn--live">
                Add your car
              </Link>
            </div>
          )}
          {garage.length > 0 && (
            <div className="mt-3">
              <Link href="/garage" className="jumplink">
                Manage the garage
              </Link>
            </div>
          )}
        </Rv>

        <Rv className="tile tile--deep" stagger={1}>
          <div className="tile__head">
            <span className="microlabel microlabel--ink">Post an update</span>
          </div>
          <PostUpdatePrompt
            cars={garage.map((c) => ({ id: c.id, name: c.name }))}
            initials={(profile?.display_name ?? "?")
              .split(" ")
              .map((w: string) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          />
          <LiveDim
            label="Saved parts"
            value={savedCount ? `${savedCount} watched` : "—"}
            blank={!savedCount}
          />
          <LiveDim
            label="Cars in your garage"
            value={garage.length ? String(garage.length) : "—"}
            blank={garage.length === 0}
          />
        </Rv>
      </section>

      {/* Recommendations */}
      {recommended.length > 0 && (
        <section className="deck">
          <Rv>
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Parts that fit your garage</span>
              <Link href="/marketplace" className="microlabel mono">
                Browse the marketplace →
              </Link>
            </div>
            <div className="mkt">
              {recommended.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          </Rv>
        </section>
      )}

      {/* Feed */}
      {followed.items.length > 0 && (
        <section className="deck">
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">From builds you follow</span>
            </div>
            <FeedList items={followed.items} />
          </Rv>
        </section>
      )}

      {discoveryItems.length > 0 && (
        <section className="deck">
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">
                Discovery — {followed.followsNothing ? "what's new across DRVN" : "while your followed feed catches up"}
              </span>
            </div>
            <FeedList items={discoveryItems} />
          </Rv>
        </section>
      )}

      {followed.items.length === 0 && discoveryItems.length === 0 && (
        <section className="deck">
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">From builds you follow</span>
            </div>
            <FeedList items={[]} />
          </Rv>
        </section>
      )}

      {(page > 1 || followed.hasMore) && (
        <nav className="mb-8 flex items-center justify-between gap-3" aria-label="Pagination">
          {page > 1 ? (
            <Link href={page - 1 === 1 ? "/home" : `/home?page=${page - 1}`} className="btn btn--ghost" rel="prev">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="microlabel">Page {page}</span>
          {followed.hasMore ? (
            <Link href={`/home?page=${page + 1}`} className="btn btn--ghost" rel="next">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <Foot left="DRVN — home" right={<Link href="/explore">See everything on Explore →</Link>} />
    </div>
  );
}

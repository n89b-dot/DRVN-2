import Link from "next/link";

import { Rv } from "@/components/livesheet";
import {
  EmptyState,
  FilterGroup,
  FilterLink,
  Foot,
  ListingCard,
  Mosaic,
  Pagination,
  TileHead,
  VehicleCard,
} from "@/components/ui";
import { FeedList } from "@/components/ui/feed-list";
import { ListingQuickCommerce } from "@/features/commerce/quick-commerce";
import {
  fetchFeed,
  fetchFollowedFeed,
  resolveFeedTab,
  visibleFeedTabs,
  type FeedItem,
  type FeedTab,
} from "@/lib/feed";
import { recommendListings } from "@/lib/recommendations";
import { createClient } from "@/lib/supabase/server";

import { Attention } from "./attention";
import { Greeting } from "./greeting";
import { PostUpdatePrompt } from "./post-update-prompt";
import { SellerKpis } from "./seller-kpis";

export const metadata = { title: "Home - DRVN" };

const FEED_PAGE_SIZE = 12;
/** The garage tile shows this many cars before folding the rest behind an
 *  "All N cars" link — a two-car garage reads whole, a twenty-car garage
 *  never pushes the feed off the page. */
const HOME_GARAGE_MAX = 3;
/** Discovery always shows at least this many rows on page one, so the
 *  segment control is never a control over an empty or hidden section. */
const DISCOVERY_MIN = 4;

/** Per-segment empty copy — each one names what's missing, not "no items". */
const DISCOVERY_EMPTY: Record<FeedTab, { title: string; body: string }> = {
  all: {
    title: "All quiet for now",
    body: "New builds, updates and listings from around DRVN show up here.",
  },
  cars: {
    title: "No new builds right now",
    body: "As people add their cars, the newest build sheets land here.",
  },
  updates: {
    title: "No new updates right now",
    body: "When someone posts progress on a build, it shows up here.",
  },
  parts: {
    title: "Nothing listed right now",
    body: "Parts arrive as owners pull them off their builds — or browse the marketplace.",
  },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; discover?: string }>;
}) {
  const { page: pageParam, discover: discoverParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Discovery's segment — the same taxonomy Explore filters by, validated
  // the same way, so "builds" means the same set on both surfaces.
  const discover = resolveFeedTab(discoverParam, true);
  const segments = visibleFeedTabs(true);

  // All five only need user!.id, with no dependency on each other — including
  // recommendListings, which hits its own admin client — so they run together.
  const [
    { data: profile },
    { data: cars, count: carCountRaw },
    followed,
    recommended,
  ] = await Promise.all([
      supabase.from("profiles").select("display_name, username").eq("id", user!.id).single(),
      supabase
        .from("cars")
        .select("id, slug, name, make, model, year, cover_image_url", { count: "exact" })
        .eq("owner_id", user!.id)
        .order("created_at")
        .limit(24),
      fetchFollowedFeed(supabase, user!.id, { page, pageSize: FEED_PAGE_SIZE }),
      recommendListings(user!.id, 4),
    ]);

  // The followed feed only covers cars and profiles this viewer follows — it
  // won't fill a page for most accounts, and is empty outright for anyone who
  // hasn't followed a build yet. Discovery (the same feed Explore uses) sits
  // beneath it on page one, clearly labelled as such rather than blended in
  // as if it were personalized — and segmented, so a viewer can ask for
  // builds, updates or parts on purpose instead of reading one mixed stream.
  let discoveryItems: FeedItem[] = [];
  if (page === 1) {
    const wantCount = followed.followsNothing
      ? FEED_PAGE_SIZE
      : Math.max(DISCOVERY_MIN, FEED_PAGE_SIZE - followed.items.length);
    const discoveryFeed = await fetchFeed(supabase, discover, true, {
      page: 1,
      pageSize: wantCount + followed.items.length,
      viewerId: user!.id,
    });
    const followedKeys = new Set(followed.items.map((i) => `${i.kind}-${i.id}`));
    discoveryItems = discoveryFeed.items
      .filter((i) => !followedKeys.has(`${i.kind}-${i.id}`))
      .slice(0, wantCount);
  }

  const firstName = profile?.display_name?.split(" ")[0];
  const garage = cars ?? [];
  const carCount = carCountRaw ?? garage.length;
  const shownCars = garage.slice(0, HOME_GARAGE_MAX);

  // Depth for the garage card: how alive each build is (updates posted) and
  // who's watching it (followers). One bounded round over the shown cars'
  // ids, counted in memory — same pattern as the garage's own sheet loader.
  const updatesBy = new Map<string, number>();
  const followersBy = new Map<string, number>();
  if (shownCars.length > 0) {
    const carIds = shownCars.map((c) => c.id);
    const [{ data: carPosts }, { data: carFollows }] = await Promise.all([
      supabase
        .from("activity_posts")
        .select("car_id")
        .in("car_id", carIds)
        .not("published_at", "is", null),
      supabase.from("follows").select("target_id").eq("target_type", "car").in("target_id", carIds),
    ]);
    for (const p of carPosts ?? []) updatesBy.set(p.car_id, (updatesBy.get(p.car_id) ?? 0) + 1);
    for (const f of carFollows ?? [])
      followersBy.set(f.target_id, (followersBy.get(f.target_id) ?? 0) + 1);
  }

  const discoverHref = (key: FeedTab) => (key === "all" ? "/home" : `/home?discover=${key}`);

  return (
    <div className="wrap">
      {/* Page head — what's happened since you were last here */}
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">Home</span>
        <h1>
          <Greeting />
          {firstName ? `, ${firstName}` : ""}.
          <br />
          The garage is <span className="live-word">open.</span>
        </h1>
        <p className="sub">
          {followed.followsNothing
            ? "Follow a build or a seller and their updates land here first — until then, Discovery shows you what's new across DRVN."
            : "The latest from the builds and people you follow, first — with Discovery underneath."}
        </p>
      </Rv>

      {/* Actionable state first: anything that needs the viewer beats
          metrics, the garage and every feed below (SYS-10). Renders nothing
          when nothing needs them. */}
      <Attention supabase={supabase} userId={user!.id} />

      {/* Seller stats — only for people who have listed something */}
      <SellerKpis supabase={supabase} userId={user!.id} />

      {/* The garage + composer — equal-height tiles; the composer fills its
          share with one ask-row per car, not with padding. */}
      <section className="deck deck--two">
        <Rv className="tile" stagger={0}>
          <TileHead
            label="Your garage"
            end={
              <span className="chip">
                {carCount ? `${carCount} car${carCount === 1 ? "" : "s"}` : "Empty"}
              </span>
            }
          />
          {shownCars.length > 0 ? (
            <div className="vlist mt-2">
              {shownCars.map((car) => (
                <VehicleCard
                  key={car.id}
                  vehicle={car}
                  stats={{
                    updates: updatesBy.get(car.id) ?? 0,
                    followers: followersBy.get(car.id) ?? 0,
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              mark="+"
              title="Your car goes here"
              action={
                <Link href="/garage" className="btn btn--live">
                  Add your car
                </Link>
              }
            >
              Add the car you&apos;re building. Photos, the full mod list, and every part you
              sell off it all live on one build page.
            </EmptyState>
          )}
          {shownCars.length > 0 && (
            <div className="mt-3">
              {/* The overflow lives in the link, not the list — three rows is
                  the tile's ceiling, and the link owns the rest. */}
              <Link href="/garage" className="jumplink">
                {carCount > HOME_GARAGE_MAX
                  ? `All ${carCount} cars in the garage`
                  : "Manage the garage"}
              </Link>
            </div>
          )}
        </Rv>

        <Rv className="tile tile--deep" stagger={1}>
          <TileHead label="Post an update" />
          {/* Just the composer — the stat dims that used to pad this tile
              ("cars in your garage" beside the garage card that lists them)
              said nothing the page didn't already say. */}
          <PostUpdatePrompt
            cars={garage.map((c) => ({ id: c.id, name: c.name }))}
            initials={(profile?.display_name ?? "?")
              .split(" ")
              .map((w: string) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          />
        </Rv>
      </section>

      {/* Recommendations — the marketplace card verbatim: engagement strip
          and quick commerce included. The picker already filters to active
          parts that aren't the viewer's own, so every card here is buyable. */}
      {recommended.length > 0 && (
        <section className="deck">
          <Rv>
            <TileHead label="Parts that fit your garage" />
            <Mosaic commerce label="Parts that fit your garage">
              {recommended.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  save={{ isLoggedIn: true, path: "/home" }}
                  actions={
                    !listing.status_flag ? (
                      <ListingQuickCommerce listingId={listing.id} title={listing.title} />
                    ) : undefined
                  }
                />
              ))}
            </Mosaic>
          </Rv>
        </section>
      )}

      {/* Followed feed — personal, never mixed with Discovery. */}
      {(followed.items.length > 0 || page > 1) && (
        <section className="deck">
          <Rv className="tile">
            <TileHead label="From builds you follow" />
            <FeedList items={followed.items} />
          </Rv>
        </section>
      )}

      {/* Discovery — general, segmented, URL-addressable (`?discover=`).
          Page one only; the followed feed owns pagination. */}
      {page === 1 && (
        <section className="deck" aria-labelledby="discovery-head">
          {/* No plate: Discovery reads as the page's own feed, not a boxed
              widget — the segment row sits between the head and the rows. */}
          <Rv>
            <div className="tile__head">
              <span className="microlabel microlabel--ink" id="discovery-head">
                {followed.followsNothing ? "New across DRVN" : "Beyond who you follow"}
              </span>
            </div>
            {/* Exactly Explore's "Show" row — the same FilterGroup/FilterLink
                with the same props, so the two surfaces read as one control. */}
            {/* Breathing room on both sides of the segment row — the section
                head was sitting right on top of the first feed row. */}
            <FilterGroup label="Show" ariaLabel="Discovery segments" stack scroll className="!mt-5 !mb-6">
              {/* scroll={false}: this control sits far down the page — the
                  default scroll-to-top would throw the viewer away from the
                  section they're refining. */}
              {segments.map((t) => (
                <FilterLink
                  key={t.key}
                  href={discoverHref(t.key)}
                  selected={discover === t.key}
                  scroll={false}
                >
                  {t.label}
                </FilterLink>
              ))}
            </FilterGroup>
            {discoveryItems.length > 0 ? (
              <FeedList items={discoveryItems} />
            ) : (
              <EmptyState
                mark="✎"
                title={DISCOVERY_EMPTY[discover].title}
                action={
                  discover === "parts" && (
                    <Link href="/marketplace" className="btn btn--ghost">
                      Browse the marketplace
                    </Link>
                  )
                }
              >
                {DISCOVERY_EMPTY[discover].body}
              </EmptyState>
            )}
          </Rv>
        </section>
      )}

      <Pagination
        page={page}
        hasMore={followed.hasMore}
        hrefFor={(p) => (p === 1 ? "/home" : `/home?page=${p}`)}
        className="!mt-0 mb-8"
      />

      <Foot left="DRVN — home" right={<Link href="/explore">See everything on Explore →</Link>} />
    </div>
  );
}

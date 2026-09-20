import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SkeletonRows } from "@/components/ui/skeleton";

import { Rv } from "@/components/livesheet";
import {
  ButtonLink,
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
  FEED_TABS,
  fetchFeed,
  fetchFollowedFeed,
  fetchLocalFeed,
  resolveFeedTab,
  type FeedItem,
  type FeedTab,
} from "@/lib/feed";
import { recommendListings } from "@/lib/recommendations";
import { getPageClient as createClient, getViewer } from "@/lib/supabase/page-context";

import { Greeting } from "./greeting";
import { PostUpdatePrompt } from "./post-update-prompt";
import { orderCars } from "@/lib/cars/order";
import { AccountRowList, ListingRow } from "@/components/commerce";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { QuickPost } from "@/features/composer/quick-post";
import { placeLabel } from "@/lib/geo/regions";

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
  const user = await getViewer();
  if (!user) redirect("/login");
  const recommendations = recommendListings(user.id, 4);

  // Discovery's segment — the same taxonomy Explore filters by, validated
  // the same way, so "builds" means the same set on both surfaces.
  const discover = resolveFeedTab(discoverParam);
  const segments = FEED_TABS;

  // Profile, garage and followed feed are independent. Recommendations
  // started above and stream separately, so they never hold up these sections.
  const [
    { data: profile },
    { data: cars, count: carCountRaw },
    followed,
  ] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, username, main_car_id, country, region")
        .eq("id", user.id)
        .single(),
      supabase
        .from("cars")
        .select("id, slug, name, make, model, year, cover_image_url, created_at", { count: "exact" })
        .eq("owner_id", user.id)
        .limit(24),
      fetchFollowedFeed(supabase, user.id, { page, pageSize: FEED_PAGE_SIZE }),
    ]);

  // The followed feed only covers cars and profiles this viewer follows — it
  // won't fill a page for most accounts, and is empty outright for anyone who
  // hasn't followed a build yet. Discovery (the same feed Explore uses) sits
  // beneath it on page one, clearly labelled as such rather than blended in
  // as if it were personalized — and segmented, so a viewer can ask for
  // builds, updates or parts on purpose instead of reading one mixed stream.
  const discoveryItemsPromise = (async (): Promise<FeedItem[]> => {
    if (page !== 1) return [];
    const wantCount = followed.followsNothing
      ? FEED_PAGE_SIZE
      : Math.max(DISCOVERY_MIN, FEED_PAGE_SIZE - followed.items.length);
    const discoveryFeed = await fetchFeed(supabase, discover, {
      page: 1, pageSize: wantCount + followed.items.length, viewerId: user.id,
    });
    const followedKeys = new Set(followed.items.map(i => `${i.kind}-${i.id}`));
    return discoveryFeed.items.filter(i => !followedKeys.has(`${i.kind}-${i.id}`)).slice(0, wantCount);
  })();

  const initials = (profile?.display_name ?? "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const firstName = profile?.display_name?.split(" ")[0];
  // H-4's rail: people worth following, ranked by what they've actually
  // built and posted rather than by follower count, so the same five
  // accounts don't win forever. Deterministic, so it doesn't reshuffle.
  // W-1's handoff needs to know which cars already have a draft, and W-3's
  // picker needs the author's own active listings.
  const quickContextPromise = Promise.all([
    supabase
      .from("activity_posts")
      .select("car_id")
      .eq("author_id", user.id)
      .is("published_at", null)
      .is("draft_archived_at", null),
    supabase
      .from("listings")
      .select("id, title, price_cents, source_car_id")
      .eq("seller_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(40),
  ]).then(([drafts, listings]) => ({
    hasDraftFor: (drafts.data ?? []).flatMap((d) => (d.car_id ? [d.car_id] : [])),
    parts: (listings.data ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      price: formatPrice(l.price_cents),
      cover: null,
      sourceCarId: l.source_car_id,
    })),
  }));

  // H-2: Local, once they've told us where they are.
  const place = profile?.country
    ? { country: profile.country, region: profile.region, label: placeLabel(profile.country, profile.region) ?? profile.country }
    : null;
  const localPromise = place
    ? fetchLocalFeed(supabase, { country: place.country, region: place.region }, { viewerId: user.id })
    : Promise.resolve({ items: [], page: 1, pageSize: 0, hasMore: false });

  const buildersPromise = Promise.resolve(
    supabase.rpc("suggested_builders", { p_viewer: user.id, p_limit: 4 })
  ).then(({ data, error }) => (error ? [] : (data ?? [])));

  const garage = orderCars(cars ?? [], profile?.main_car_id);
  // H-5: the rail's first card lands after the third post — or after the
  // last one when there are fewer than three, so it is never stranded at
  // the bottom of a short feed.
  const leadItems = followed.items.slice(0, 3);
  const restItems = followed.items.slice(3);
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
    for (const p of carPosts ?? [])
      if (p.car_id) updatesBy.set(p.car_id, (updatesBy.get(p.car_id) ?? 0) + 1);
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

      {/* H-6: "Needs you" and the seller KPIs have left Home. Home is the
          feed and what's around it; a seller's numbers belong on Selling,
          where somebody has gone to work rather than to read. */}

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
          {/* The bar's Post button lands here (N-3). */}
          <span id="quick-post" className="scroll-mt-24" />
          <TileHead label="Post an update" />
          {/* Just the composer — the stat dims that used to pad this tile
              ("cars in your garage" beside the garage card that lists them)
              said nothing the page didn't already say. */}
          {/* H-3 / W-1: the quick box, on top of the feed. The full editor
              is one link away and never loses what is typed here. */}
          <Suspense
            fallback={
              <PostUpdatePrompt
                cars={garage.map((c) => ({ id: c.id, name: c.name }))}
                initials={initials}
              />
            }
          >
            {quickContextPromise.then((ctx) => (
              <QuickPost
                cars={garage.map((c) => ({ id: c.id, name: c.name }))}
                userId={user.id}
                initials={initials}
                hasDraftFor={ctx.hasDraftFor}
                parts={ctx.parts}
              />
            ))}
          </Suspense>
        </Rv>
      </section>

      {/* Recommendations — the marketplace card verbatim: engagement strip
          and quick commerce included. The picker already filters to active
          parts that aren't the viewer's own, so every card here is buyable. */}
      <Suspense fallback={null}>
      {recommendations.then(recommended => recommended.length > 0 ? (
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
      ) : null)}
      </Suspense>

      {/* H-4/H-5. The feed and the rail are one grid: two columns from
          1024px, one column below it with the rail's tiles interleaved into
          the feed rather than stranded beneath it. Nothing scrolls sideways.
          H-5's sparse rules live in the render: a tile with nothing in it
          doesn't render at all, and with fewer than three posts the first
          rail card follows the last post rather than waiting for a third. */}
      <div className="deck deck--main">
        <div className={`deck--main__feed deck--main__feed--lead${leadItems.length ? "" : " hidden"}`}>
          {leadItems.length > 0 && (
            <Rv className="tile">
              <TileHead label="From builds you follow" />
              <FeedList items={leadItems} />
            </Rv>
          )}
        </div>

        <aside className="deck--main__aside deck--main__aside--first" aria-label="Your garage and parts">
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
              <>
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
                <div className="mt-3">
                  <Link href="/garage" className="jumplink">
                    {carCount > HOME_GARAGE_MAX
                      ? `All ${carCount} cars in the garage`
                      : "Manage the garage"}
                  </Link>
                </div>
              </>
            ) : (
              /* H-5: no car — the one tile that earns its place by being
                 empty, because adding a car is the thing to do next. */
              <EmptyState
                mark="+"
                title="Add your car"
                action={
                  <ButtonLink href="/garage" variant="live">
                    Add your car
                  </ButtonLink>
                }
              >
                Photos, the full mod list, and every part you sell off it live on one build page.
              </EmptyState>
            )}
          </Rv>

          <Suspense fallback={null}>
            {recommendations.then((recommended) =>
              recommended.length > 0 ? (
                <Rv className="tile" stagger={1}>
                  <TileHead label="Parts for your cars" />
                  <div className="mt-2 grid gap-2">
                    {recommended.slice(0, 3).map((listing) => (
                      <ListingRow
                        key={listing.id}
                        listing={{
                          id: listing.id,
                          title: listing.title,
                          price: formatPrice(listing.price_cents),
                          cover: listing.cover_url,
                          status: "active",
                        }}
                      />
                    ))}
                  </div>
                  <div className="mt-3">
                    <Link href="/marketplace" className="jumplink">
                      Browse the marketplace
                    </Link>
                  </div>
                </Rv>
              ) : null
            )}
          </Suspense>
        </aside>

        <div className="deck--main__feed deck--main__feed--rest">
          {restItems.length > 0 && (
            <Rv className="tile">
              <FeedList items={restItems} />
            </Rv>
          )}
        </div>

        <aside className="deck--main__aside deck--main__aside--rest" aria-label="Builders to follow">
          <Suspense fallback={null}>
            {buildersPromise.then((builders) =>
              builders.length > 0 ? (
                <Rv className="tile">
                  <TileHead label="Builders to follow" />
                  <div className="mt-2">
                    <AccountRowList
                      accounts={builders.map((b) => ({
                        id: b.id,
                        username: b.username,
                        display_name: b.display_name,
                        avatar_url: b.avatar_url,
                        meta: [
                          `${b.car_count} car${Number(b.car_count) === 1 ? "" : "s"}`,
                          Number(b.update_count) > 0
                            ? `${b.update_count} update${Number(b.update_count) === 1 ? "" : "s"}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · "),
                      }))}
                    />
                  </div>
                </Rv>
              ) : null
            )}
          </Suspense>
        </aside>
      </div>

      {/* H-1/H-2: Following · For you · Local. Local appears only once a
          member has said where they are — a tab whose whole content is
          "tell us your location first" is a tab that exists to ask for
          something, and Home is not the place to ask. */}
      {page === 1 && place && (
        <section className="deck" aria-labelledby="local-head">
          <Rv>
            <TileHead
              label={`Near you — ${place.label}`}
              end={
                <Link href="/settings" className="jumplink">
                  Change
                </Link>
              }
            />
            <Suspense fallback={<SkeletonRows />}>
              {localPromise.then((local) =>
                local.items.length > 0 ? (
                  <FeedList items={local.items} />
                ) : (
                  <EmptyState mark="✎" title={`Nothing from ${place.label} yet`}>
                    As people near you add cars and list parts, they show up here.
                  </EmptyState>
                )
              )}
            </Suspense>
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
            <Suspense key={discover} fallback={<SkeletonRows />}>
            {discoveryItemsPromise.then(discoveryItems => discoveryItems.length > 0 ? (
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
            ))}
            </Suspense>
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

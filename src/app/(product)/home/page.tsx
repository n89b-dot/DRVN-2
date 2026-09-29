import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Rv } from "@/components/livesheet";
import {
  ButtonLink,
  EmptyState,
  FilterGroup,
  FilterLink,
  Foot,
  TileHead,
  VehicleCard,
} from "@/components/ui";
import { FeedList } from "@/components/ui/feed-list";
import {
  fetchFeed,
  fetchFollowedFeed,
  fetchLocalFeed,
  type FeedItem,
} from "@/lib/feed";
import { recommendListings } from "@/lib/recommendations";
import { getPageClient as createClient, getViewer } from "@/lib/supabase/page-context";

import { HomeFeedMore } from "./feed-more";
import { Greeting } from "./greeting";
import { HOME_FEED_PAGE_SIZE, type HomeTab } from "./tabs";
import { PostUpdatePrompt } from "./post-update-prompt";
import { orderCars } from "@/lib/cars/order";
import { AccountRowList, ListingRow } from "@/components/commerce";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { QuickPost } from "@/features/composer/quick-post";
import { placeLabel } from "@/lib/geo/regions";
import { FollowButton } from "@/features/social/buttons";

export const metadata = { title: "Home - DRVN" };

/** The garage tile shows this many cars before folding the rest behind an
 *  "All N cars" link — a two-car garage reads whole, a twenty-car garage
 *  never pushes the rail off the page. */
const HOME_GARAGE_MAX = 3;
/** H-5: how many posts run before the rail's first tile folds into the feed
 *  on a phone. With fewer posts than this it follows the last one. */
const LEAD_POSTS = 3;


const TAB_EMPTY: Record<HomeTab, { title: string; body: string }> = {
  following: {
    title: "Nothing new from who you follow",
    body: "When a build you follow posts, or a seller you follow lists a part, it lands here first.",
  },
  foryou: {
    title: "All quiet for now",
    body: "New builds, updates and parts from around DRVN show up here.",
  },
  local: {
    title: "Nothing near you yet",
    body: "As people near you add cars and list parts, they show up here.",
  },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  // The server renders the first page; the column loads the rest as it is
  // read (H-4), so there is no page number in Home's address.
  const page = 1;

  const supabase = await createClient();
  const user = await getViewer();
  if (!user) redirect("/login");
  const recommendations = recommendListings(user.id, 3);

  // Started here, before anything is awaited: these need only the member's
  // id, and they used to wait for the feed before they began.
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
    // The picker shows each part by its photo — without the covers every
    // row was an empty grey square. The covers ride along as an embed.
    supabase
      .from("listings")
      .select("id, title, price_cents, source_car_id, listing_images(url, position)")
      .eq("seller_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .order("position", { referencedTable: "listing_images" })
      .limit(1, { referencedTable: "listing_images" })
      .limit(40),
  ]).then(([drafts, listings]) => ({
    hasDraftFor: (drafts.data ?? []).flatMap((d) => (d.car_id ? [d.car_id] : [])),
    parts: (listings.data ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      price: formatPrice(l.price_cents),
      cover: l.listing_images?.[0]?.url ?? null,
      sourceCarId: l.source_car_id,
    })),
  }));

  // A suggestion with no photo and no name reads as a broken row (placeholder
  // and test accounts), so only people who have put a face and a name on
  // their profile are offered. Asked for a few more to cover the ones dropped.
  const buildersPromise = Promise.resolve(
    supabase.rpc("suggested_builders", { p_viewer: user.id, p_limit: 8 })
  ).then(({ data, error }) =>
    (error ? [] : (data ?? [])).filter((b) => b.avatar_url && b.display_name?.trim()).slice(0, 4)
  );

  const [{ data: profile }, { data: cars, count: carCountRaw }, { count: followCount }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, username, main_car_id, country, region")
        .eq("id", user.id)
        .single(),
      supabase
        .from("cars")
        .select("id, slug, name, make, model, year, cover_image_url, created_at", { count: "exact" })
        .eq("owner_id", user.id)
        // Ordered before it is limited: an unordered limit could leave the
        // main car out of the rows `orderCars` is about to lead with.
        .order("created_at", { ascending: false })
        .limit(24),
      supabase
        .from("follows")
        .select("target_id", { count: "exact", head: true })
        .eq("follower_id", user.id),
    ]);

  // H-2: Local exists once they've said where they are. A tab whose whole
  // content is "tell us your location first" is a tab that exists to ask for
  // something, and Home is not the place to ask.
  const place = profile?.country
    ? {
        country: profile.country,
        region: profile.region,
        label: placeLabel(profile.country, profile.region) ?? profile.country,
      }
    : null;
  const followsNothing = (followCount ?? 0) === 0;

  // Someone who follows nobody opens on For you: an empty Following tab is a
  // true answer and a useless first screen.
  const tab: HomeTab =
    tabParam === "following" || tabParam === "foryou"
      ? tabParam
      : tabParam === "local" && place
        ? "local"
        : followsNothing
          ? "foryou"
          : "following";

  const feedPromise: Promise<{ items: FeedItem[]; hasMore: boolean }> =
    tab === "following"
      ? fetchFollowedFeed(supabase, user.id, { page, pageSize: HOME_FEED_PAGE_SIZE })
      : tab === "local" && place
        ? fetchLocalFeed(
            supabase,
            { country: place.country, region: place.region },
            { page, pageSize: HOME_FEED_PAGE_SIZE, viewerId: user.id }
          )
        : // For you is other people's things: your own car is already in the
          // garage tile beside it.
          fetchFeed(supabase, "all", {
            page,
            pageSize: HOME_FEED_PAGE_SIZE,
            viewerId: user.id,
            excludeOwnerId: user.id,
          });

  const garage = orderCars(cars ?? [], profile?.main_car_id);
  const carCount = carCountRaw ?? garage.length;
  const shownCars = garage.slice(0, HOME_GARAGE_MAX);

  // Depth for the garage card: how alive each build is (updates posted) and
  // who's watching it (followers). One bounded round over the shown cars'
  // ids, counted in memory — same pattern as the garage's own sheet loader.
  // It needs only the garage, so it runs beside the feed rather than after.
  const garageStatsPromise = shownCars.length
    ? Promise.all([
        supabase
          .from("activity_posts")
          .select("car_id")
          .in("car_id", shownCars.map((c) => c.id))
          .not("published_at", "is", null),
        supabase
          .from("follows")
          .select("target_id")
          .eq("target_type", "car")
          .in("target_id", shownCars.map((c) => c.id)),
      ])
    : Promise.resolve([{ data: [] as { car_id: string | null }[] }, { data: [] as { target_id: string }[] }] as const);

  const [feed, [{ data: carPosts }, { data: carFollows }]] = await Promise.all([feedPromise, garageStatsPromise]);
  const updatesBy = new Map<string, number>();
  const followersBy = new Map<string, number>();
  for (const p of carPosts ?? []) if (p.car_id) updatesBy.set(p.car_id, (updatesBy.get(p.car_id) ?? 0) + 1);
  for (const f of carFollows ?? []) followersBy.set(f.target_id, (followersBy.get(f.target_id) ?? 0) + 1);

  const tabs: { key: HomeTab; label: string }[] = [
    { key: "following", label: "Following" },
    { key: "foryou", label: "For you" },
    ...(place ? [{ key: "local" as const, label: place.label }] : []),
  ];
  const hrefFor = (key: HomeTab) => {
    const params = new URLSearchParams();
    // The default tab needs no parameter, so a bare /home stays shareable.
    if (key !== (followsNothing ? "foryou" : "following")) params.set("tab", key);
    const query = params.toString();
    return query ? `/home?${query}` : "/home";
  };

  const initials = (profile?.display_name ?? "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const firstName = profile?.display_name?.split(" ")[0];
  const leadItems = feed.items.slice(0, LEAD_POSTS);
  const restItems = feed.items.slice(LEAD_POSTS);

  return (
    <div className="wrap">
      {/* One line and the feed switch beside it: Home is a working surface,
          and the composer should land in the first half of a phone screen. */}
      <Rv as="header" className="pagehead pagehead--task pagehead--home">
        <div className="pagehead__row">
          <h1>
            <Greeting />
            {firstName ? `, ${firstName}` : ""}.
          </h1>
          {/* H-1. One feed, asked for three ways. Plain links, so a tab is an
              address: it can be bookmarked, and Back returns to it. */}
          <FilterGroup ariaLabel="Which feed to show">
            {tabs.map((t) => (
              <FilterLink key={t.key} href={hrefFor(t.key)} selected={tab === t.key}>
                {t.label}
              </FilterLink>
            ))}
          </FilterGroup>
        </div>
      </Rv>

      {/* H-4/H-5. Two columns from 1024px: the feed, and a rail beside it.
          Below that the two wrappers dissolve (`display: contents`) and
          `order` folds the rail's tiles INTO the feed — after the third post,
          and again at the end — rather than stranding them beneath it. A
          tile with nothing in it doesn't render at all. */}
      <div className="deck deck--main">
        <div className="deck--main__feeds">
          {/* H-3 / W-1: the quick box, on top of the feed. The bar's Post
              button lands here (N-3). */}
          <Rv className="tile tile--deep deck--main__post">
            <span id="quick-post" className="scroll-mt-24" />
            <TileHead label="Post an update" />
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

          <div className="deck--main__feed deck--main__feed--lead">
            {leadItems.length > 0 ? (
              <Rv immediate>
                <FeedList items={leadItems} variant="cards" engagement={{ path: "/home", isLoggedIn: true }} eagerFirst />
              </Rv>
            ) : (
              <EmptyState
                mark="✎"
                title={TAB_EMPTY[tab].title}
                action={
                  tab === "following" ? (
                    <ButtonLink href={hrefFor("foryou")} variant="ghost">
                      See what&apos;s new across DRVN
                    </ButtonLink>
                  ) : undefined
                }
              >
                {TAB_EMPTY[tab].body}
              </EmptyState>
            )}
          </div>

          {/* H-4: the feed carries on as you reach its end, keyed by tab so a
              tab change starts a new column rather than appending to the old. */}
          {leadItems.length > 0 && (
            <HomeFeedMore
              key={tab}
              tab={tab}
              initialItems={restItems}
              seen={leadItems.map((i) => `${i.kind}-${i.id}`)}
              initialHasMore={feed.hasMore}
            />
          )}
        </div>

        <div className="deck--main__rail">
          <aside className="deck--main__aside deck--main__aside--first" aria-label="Your garage and parts">
            <Rv className="tile" stagger={0}>
              <TileHead
                label="Your garage"
                end={
                  carCount ? (
                    <span className="chip">{`${carCount} car${carCount === 1 ? "" : "s"}`}</span>
                  ) : undefined
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
                    {/* The overflow lives in the link, not the list. */}
                    <Link href="/garage?car=all" className="jumplink">
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

            {/* Rows that open the part — no Buy now here (a ruling): deciding
                to buy happens on the part's own page. The tile only claims
                "for your cars" when a part really came off the same platform;
                otherwise it says what the picks are. */}
            <Suspense fallback={null}>
              {recommendations.then((recommended) => {
                const fits = recommended.filter((l) => l.reason?.startsWith("Fits your"));
                const shown = fits.length > 0 ? fits : recommended;
                return shown.length > 0 ? (
                  <Rv className="tile" stagger={1}>
                    <TileHead label={fits.length > 0 ? "Parts for your cars" : "Parts people are watching"} />
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      {shown.map((listing) => (
                        <ListingRow
                          key={listing.id}
                          showStatus={false}
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
                ) : null;
              })}
            </Suspense>
          </aside>

          <aside className="deck--main__aside deck--main__aside--rest" aria-label="Builders to follow">
            <Suspense fallback={null}>
              {buildersPromise.then((builders) =>
                builders.length > 0 ? (
                  <Rv className="tile">
                    <TileHead label="Builders to follow" />
                    <div className="mt-2 peoplerows">
                      <AccountRowList
                        action={(account) => (
                          <FollowButton
                            targetType="profile"
                            targetId={account.id}
                            path="/home"
                            initialFollowing={false}
                            isLoggedIn
                          />
                        )}
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
      </div>

      <Foot left="DRVN — home" right={<Link href="/explore">See everything on Explore →</Link>} />
    </div>
  );
}

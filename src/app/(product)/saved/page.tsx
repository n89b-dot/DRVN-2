import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import {
  Avatar,
  ButtonLink,
  EmptyState,
  FilterGroup,
  FilterLink,
  Finder,
  FinderClear,
  FinderLabel,
  Foot,
  ListingCard,
  Mosaic,
  ObjectRow,
  CursorPagination,
  Pagination,
  TileHead,
} from "@/components/ui";
import { RelationshipRemove } from "@/features/social/remove-button";
import { initialsOf } from "@/lib/format";
import { withParams as buildParams } from "@/lib/url-params";
import { hydrateListingCards } from "@/lib/marketplace/query";
import { getPageClient as createClient, getViewer } from "@/lib/supabase/page-context";
import { reportError } from "@/lib/monitoring";
import { SavedSearchList } from "@/features/marketplace/saved-search-list";
import { savedSearchName } from "@/features/marketplace/saved-search-name";
import { vehicleSubline } from "@/lib/vehicles/label";
import { postHeadline } from "@/lib/activity/headline";
import { postHref } from "@/lib/activity/href";
import { cursorArgs, cursorPage, decodePageCursor, encodePageCursor, type PageCursor } from "@/lib/page-cursor";

export const metadata = { title: "Saved - DRVN" };

type CarRowData = {
  id: string;
  slug: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  cover_image_url: string | null;
};

type SavedTab = "saved" | "following";
type SortKey = "newest" | "price";

const PAGE_SIZE = 24;
/** Each other section shows this many at a time, paged on its own (N68: they
 *  used to stop at 100 with no way to see older ones). */
const SECTION_SIZE = 24;

/** A Saved section, as saved_page (20261107180000) names it, and the query
 *  parameter that holds its position. Each section reads on independently,
 *  so paging one leaves the others where they were. */
const SECTION_PARAM = {
  post: "updates",
  build: "builds",
  unavailable_part: "unavailable",
  followed_build: "following_builds",
  followed_seller: "sellers",
} as const;
type SectionKey = keyof typeof SECTION_PARAM;
type SavedSearchParams = { tab?: string; page?: string; q?: string; sort?: string } & Partial<
  Record<(typeof SECTION_PARAM)[SectionKey], string>
>;

function withParams(
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>
) {
  return buildParams("/saved", params, overrides);
}

type SectionPage = { ids: string[]; next: PageCursor | null; failed: boolean };

/** One page of a section: the ids of what the caller saved or follows, still
 *  there and still visible, newest first, from `before`. */
async function loadSection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  collection: SectionKey,
  before: PageCursor | null
): Promise<SectionPage> {
  const { data, error } = await supabase.rpc("saved_page", {
    p_collection: collection,
    p_limit: SECTION_SIZE + 1,
    ...cursorArgs(before),
  });
  if (error) reportError(`[saved] failed to load ${collection}`, error);
  const page = cursorPage(data, SECTION_SIZE, (row) => ({ at: row.saved_at, id: row.target_id }));
  return { ids: page.rows.map((row) => row.target_id), next: page.next, failed: Boolean(error) };
}

const NO_SECTION: SectionPage = { ids: [], next: null, failed: false };

/**
 * Saved and followed, correctly labelled — and now complete at any size.
 *
 * Three bugs fixed here first (two originally, one newly found). "Sellers you
 * follow" read profile *saves*, but nothing in the app ever renders a save
 * button for a profile — so that section could never populate, while actual
 * follows appeared nowhere at all. There was no way to unsave anything from
 * this page. And the saved-parts query had no limit at all.
 *
 * Then OS-W22. The page read every save and follow (Supabase stops at 1,000
 * rows), counted them here, and asked for the things behind them with every
 * id in one URL — too long past a few hundred, and the page showed empty
 * (N31). The side sections stopped at 100 (N68), and a save of something
 * deleted still counted (N61). Now the database counts what still exists and
 * the member can see (saved_counts), the parts grid is its own page of the
 * member's saves (saved_listing_page), and every other section is paged on
 * its own from a position (saved_page). Only a page's ids are ever asked for.
 */
export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<SavedSearchParams>;
}) {
  const params = await searchParams;
  const { tab: tabParam, page: pageParam, q, sort: sortParam } = params;
  const tab: SavedTab = tabParam === "following" ? "following" : "saved";
  const sort: SortKey = sortParam === "price" ? "price" : "newest";
  const query = (q ?? "").trim();
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const positionOf = (key: SectionKey) => decodePageCursor(params[SECTION_PARAM[key]]);

  const supabase = await createClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  const onSaved = tab === "saved";
  const [countsResult, { data: savedSearches, error: searchesError }, partsResult, posts, builds, unavailable, followedBuilds, sellers] =
    await Promise.all([
      supabase.rpc("saved_counts").maybeSingle(),
      supabase
        .from("saved_searches")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      onSaved
        ? supabase.rpc("saved_listing_page", {
            p_query: query || undefined,
            p_sort: sort,
            p_limit: PAGE_SIZE,
            p_offset: from,
          })
        : Promise.resolve({ data: [] as { listing_id: string; total: number }[], error: null }),
      onSaved ? loadSection(supabase, "post", positionOf("post")) : NO_SECTION,
      onSaved ? loadSection(supabase, "build", positionOf("build")) : NO_SECTION,
      onSaved && !query ? loadSection(supabase, "unavailable_part", positionOf("unavailable_part")) : NO_SECTION,
      onSaved ? NO_SECTION : loadSection(supabase, "followed_build", positionOf("followed_build")),
      onSaved ? NO_SECTION : loadSection(supabase, "followed_seller", positionOf("followed_seller")),
    ]);

  const countsError = countsResult.error;
  if (countsError) reportError("[saved] failed to count saves", countsError);
  const counts = countsResult.data;
  const savesError = Boolean(countsError) || posts.failed || builds.failed || unavailable.failed;
  const followsError = Boolean(countsError) || followedBuilds.failed || sellers.failed;
  const listingsError = partsResult.error;
  if (listingsError) reportError("[saved] failed to load saved parts", listingsError);

  // Only this page's parts: at most PAGE_SIZE ids, in the page's own order.
  const pagePartIds = (partsResult.data ?? []).map((row) => row.listing_id);
  const listingsTotal = partsResult.data?.[0]?.total ?? (from > 0 ? null : 0);
  const carIds = [...new Set([...builds.ids, ...followedBuilds.ids])];

  const [{ data: listings }, { data: cars }, { data: profiles }, { data: savedPosts }] = await Promise.all([
    pagePartIds.length
      ? supabase
          .from("listings")
          .select("id, title, price_cents, shipping_cents, shipping_mode, allows_collection, condition, location, status, part_number, seller_id, source_car_id")
          .in("id", pagePartIds)
      : Promise.resolve({ data: [] }),
    carIds.length
      ? supabase.from("cars").select("id, slug, name, make, model, year, cover_image_url").in("id", carIds)
      : Promise.resolve({ data: [] }),
    sellers.ids.length
      ? supabase.from("profiles").select("id, username, display_name").in("id", sellers.ids)
      : Promise.resolve({ data: [] }),
    // Saved build updates (0037): the post, its car (for the deep link), and
    // its first photo — this page's posts only.
    posts.ids.length
      ? supabase
          .from("activity_posts")
          // `body` too: a quick post has no title, and its caption is the
          // only thing that tells one saved post from another.
          .select("id, title, intro, body, car_id, published_at")
          .in("id", posts.ids)
          .not("published_at", "is", null)
      : Promise.resolve({ data: [] }),
  ]);

  // W-5: a saved post may have no car. It still belongs in the list — it
  // just has no build to name beside it.
  const savedPostCarIds = [
    ...new Set((savedPosts ?? []).flatMap((p) => (p.car_id ? [p.car_id] : []))),
  ];
  const [{ data: savedPostCars }, { data: savedPostImages }] = await Promise.all([
    savedPostCarIds.length
      ? supabase.from("cars").select("id, slug, name").in("id", savedPostCarIds)
      : Promise.resolve({ data: [] }),
    (savedPosts ?? []).length
      ? supabase
          .from("activity_images")
          .select("post_id, url, position")
          .in("post_id", (savedPosts ?? []).map((p) => p.id))
          .order("position")
      : Promise.resolve({ data: [] }),
  ]);
  const savedPostCarById = new Map((savedPostCars ?? []).map((c) => [c.id, c]));
  const savedPostCover = new Map<string, string>();
  for (const img of savedPostImages ?? []) {
    if (!savedPostCover.has(img.post_id)) savedPostCover.set(img.post_id, img.url);
  }
  // Keep the save order (newest first). saved_page already left out posts
  // the member can no longer see.
  const savedUpdates = posts.ids
    .map((id) => (savedPosts ?? []).find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ ...p, car: p.car_id ? savedPostCarById.get(p.car_id) : undefined }));

  // Same hydration as the Marketplace grid, so a saved part is the same card
  // it was when it was saved — cover, source car, seller trust, state flag.
  const listingById = new Map((listings ?? []).map((l) => [l.id, l]));
  const savedCards = await hydrateListingCards(
    supabase,
    pagePartIds.flatMap((id) => {
      const listing = listingById.get(id);
      return listing ? [listing] : [];
    })
  );

  const carById = new Map<string, CarRowData>((cars ?? []).map((c) => [c.id, c]));
  const savedCars = builds.ids.map((id) => carById.get(id)).filter((c): c is CarRowData => Boolean(c));
  const followedCars = followedBuilds.ids.map((id) => carById.get(id)).filter((c): c is CarRowData => Boolean(c));
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const followedSellers = sellers.ids.map((id) => profileById.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p));

  // Totals of what still exists and the member can see (N61).
  const totalListingSaves = counts?.parts ?? 0;
  const totalUnavailable = counts?.unavailable_parts ?? 0;
  const totalCarSaves = counts?.builds ?? 0;
  const totalPostSaves = counts?.posts ?? 0;
  const totalFollowedCars = counts?.followed_builds ?? 0;
  const sellerCount = counts?.followed_sellers ?? 0;
  const buildCount = totalCarSaves + totalFollowedCars;
  const postCount = totalPostSaves;
  const isEmpty = !savesError && !followsError && !searchesError && !totalListingSaves && !totalUnavailable && !buildCount && !sellerCount && !postCount && !(savedSearches ?? []).length;
  const hasMoreListings = onSaved && (listingsTotal ?? 0) > from + PAGE_SIZE;

  // Every link keeps every other section where it is.
  const currentParams: Record<string, string | undefined> = { ...params };
  const sectionLinks = (key: SectionKey, section: SectionPage) => ({
    newestHref: positionOf(key) ? withParams(currentParams, { [SECTION_PARAM[key]]: undefined }) : null,
    olderHref: section.next ? withParams(currentParams, { [SECTION_PARAM[key]]: encodePageCursor(section.next) }) : null,
  });

  const CarRow = ({ car, kind }: { car: CarRowData; kind: "save" | "follow" }) => (
    <ObjectRow
      media={{ src: car.cover_image_url ?? undefined, alt: car.name }}
      mediaHref={`/cars/${car.slug}`}
      actions={
        <RelationshipRemove
          kind={kind}
          targetType="car"
          targetId={car.id}
          label={kind === "save" ? "Unsave" : "Unfollow"}
        />
      }
    >
      <span className="min-w-0">
        <Link
          href={`/cars/${car.slug}`}
          className="order__name block truncate transition-colors hover:text-live"
        >
          {car.name}
        </Link>
        <span className="order__meta block">
          {vehicleSubline(car.name, car) ?? "build page"}
        </span>
      </span>
    </ObjectRow>
  );

  const tabParams = { q: query || undefined, sort: sort === "price" ? "price" : undefined };

  return (
    // One measure with Cart and Notifications (the bar's three icons).
    <div className="wrap wrap--wide">
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">
          Saved · {totalListingSaves} part{totalListingSaves === 1 ? "" : "s"} · {buildCount}{" "}
          build{buildCount === 1 ? "" : "s"} · {postCount} post{postCount === 1 ? "" : "s"} ·{" "}
          {sellerCount} seller{sellerCount === 1 ? "" : "s"}
        </span>
        <h1>
          Everything you&apos;re
          <br />
          keeping an eye on.
        </h1>
        <p className="sub sub--keep">
          The parts you&apos;re watching, and the builds and sellers you follow. Sold listings stay
          here so you can see what things actually went for.
        </p>
      </Rv>

      <FilterGroup ariaLabel="Saved vs following">
        <FilterLink
          href={withParams(tabParams, { tab: undefined, page: undefined })}
          selected={tab === "saved"}
        >
          Saved
        </FilterLink>
        <FilterLink
          href={withParams(tabParams, { tab: "following", page: undefined })}
          selected={tab === "following"}
        >
          Following
        </FilterLink>
      </FilterGroup>

      {(savesError || searchesError) && <p role="alert" className="field__err">Some saved items couldn’t be loaded. Reload this page to try again.</p>}
      {/* An unread follows list is not an empty one: say so on the tab it
          feeds instead of offering "Not following anyone yet". */}
      {followsError && tab === "following" && <p role="alert" className="field__err">The builds and sellers you follow couldn’t be loaded. Reload this page to try again.</p>}
      {/* Nothing anywhere: one empty state, and nothing around it — no
          section heads, search or sort over lists with nothing in them. */}
      {isEmpty && (
        <section className="deck">
          <Rv>
            <EmptyState
              mark="◎"
              className="undrawn--hero"
              title="Nothing saved yet"
              action={
                <>
                  <ButtonLink href="/marketplace" variant="live">
                    Browse parts
                  </ButtonLink>
                  <ButtonLink href="/explore" variant="ghost">
                    Explore builds
                  </ButtonLink>
                </>
              }
            >
              Save parts and follow builds and sellers as you browse — they all collect here.
            </EmptyState>
          </Rv>
        </section>
      )}

      {tab === "saved" && (totalListingSaves > 0 || totalUnavailable > 0) && (
        <section className="deck">
          <div>
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Saved parts</span>
              <span className="chip">{totalListingSaves}</span>
            </div>

            {/* Searching and sorting are two different operations, and as one
                wrapping `.filters` row they collapsed into a single blob of
                controls on a phone. The `.finder` plate is the house idiom for
                exactly this: the query line on top, refinements on their own
                row beneath, so the two read as two. Desktop stays compact —
                that is what every `sm:` here buys. */}
            <Finder
              action="/saved"
              className="!mt-3"
              inputLabel="Search saved parts"
              defaultValue={query}
              /* Carries tab and the chosen sort through a search, the way the
                 marketplace finder does. Without it, searching silently threw
                 the sort back to newest. */
              hidden={{ tab: "saved", sort: sort === "price" ? "price" : undefined }}
              refine={
                <>
                  <FinderLabel>Sort</FinderLabel>
                  <FilterLink
                    href={withParams({ q: query || undefined }, { sort: undefined, tab: undefined, page: undefined })}
                    selected={sort === "newest"}
                  >
                    Newest
                  </FilterLink>
                  <FilterLink
                    href={withParams({ q: query || undefined }, { sort: "price", tab: undefined, page: undefined })}
                    selected={sort === "price"}
                  >
                    Price ↑
                  </FilterLink>
                  {query && (
                    <FinderClear
                      href={withParams({ sort: sort === "price" ? "price" : undefined }, { q: undefined, page: undefined })}
                    />
                  )}
                </>
              }
            />

            {listingsError ? <p role="alert" className="field__err">Saved parts couldn’t be loaded. Reload this page to try again.</p> : savedCards.length > 0 ? (
              <div className="mt-4">
                <Mosaic label="Saved parts">
                  {savedCards.map((card) => (
                    <ListingCard
                      key={card.id}
                      listing={card}
                      actions={
                        <RelationshipRemove kind="save" targetType="listing" targetId={card.id} label="Unsave" />
                      }
                    />
                  ))}
                </Mosaic>
              </div>
            ) : (
              <p className="py-4 font-mono text-micro uppercase tracking-[0.1em] text-dim">
                {query ? `No saved parts match "${query}"` : totalListingSaves > 0 ? "No viewable parts on this page" : "Nothing saved yet"}
              </p>
            )}

            <Pagination
              page={page}
              hasMore={hasMoreListings}
              hrefFor={(p) => withParams(currentParams, { page: p === 1 ? undefined : String(p) })}
            />

            {/* Saves of parts the member can no longer see — taken down, or
                back to draft. Not counted as saved parts (N61); listed so
                they can be let go, a page at a time. */}
            {unavailable.ids.length > 0 && (
              <>
                <p className="field__hint mt-6">
                  {totalUnavailable} saved part{totalUnavailable === 1 ? " is" : "s are"} no longer available.
                </p>
                <div className="rowlist">
                  {unavailable.ids.map((id) => (
                    <ObjectRow key={id} actions={<RelationshipRemove kind="save" targetType="listing" targetId={id} label="Unsave" />}>
                      <span><span className="order__name block">Unavailable saved part</span><span className="order__meta">This part is no longer publicly available.</span></span>
                    </ObjectRow>
                  ))}
                </div>
                <CursorPagination label="Unavailable saved parts" {...sectionLinks("unavailable_part", unavailable)} />
              </>
            )}
          </div>
        </section>
      )}

      {tab === "saved" && totalPostSaves > 0 && (
        <section className="deck">
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Saved updates</span>
              <span className="chip">{totalPostSaves}</span>
            </div>
            <div className="rowlist">
              {savedUpdates.map((post) => (
                <ObjectRow
                  key={post.id}
                  media={
                    savedPostCover.get(post.id)
                      ? { src: savedPostCover.get(post.id), alt: postHeadline(post) }
                      : undefined
                  }
                  mediaHref={
                    savedPostCover.get(post.id)
                      ? postHref({ id: post.id, carSlug: post.car?.slug ?? null })
                      : undefined
                  }
                  actions={
                    <RelationshipRemove kind="save" targetType="post" targetId={post.id} label="Unsave" />
                  }
                >
                  <span className="min-w-0">
                    <Link
                      href={postHref({ id: post.id, carSlug: post.car?.slug ?? null })}
                      className="order__name block truncate transition-colors hover:text-live"
                    >
                      {postHeadline(post)}
                    </Link>
                    <span className="order__meta block truncate">
                      {post.car?.name ?? ""}
                      {post.intro ? `${post.car ? " — " : ""}${post.intro}` : ""}
                    </span>
                  </span>
                </ObjectRow>
              ))}
            </div>
            <CursorPagination label="Saved updates" {...sectionLinks("post", posts)} />
          </Rv>
        </section>
      )}

      {tab === "saved" && (savedSearches ?? []).length > 0 && (
        <section className="deck">
          <Rv className="tile">
            <TileHead label="Saved searches" end={<span className="chip">{(savedSearches ?? []).length}</span>} />
            {/* Named from what's set, so searches saved before names said
                "2003 BMW M3 · KW" read the same as new ones. */}
            <SavedSearchList searches={await Promise.all((savedSearches ?? []).map(async (search) => ({ ...search, name: (await savedSearchName(search.params)) ?? search.name })))} />
            <p className="field__hint mt-2">
              Alerts are off unless you turn them on — matching inventory then lands in
              Notifications, never your inbox.
            </p>
          </Rv>
        </section>
      )}

      {tab === "saved" && totalCarSaves > 0 && (
        <section className="deck">
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Builds you&apos;ve saved</span>
              <span className="chip">{totalCarSaves}</span>
            </div>
            <div className="rowlist">
              {savedCars.map((car) => (
                <CarRow key={car.id} car={car} kind="save" />
              ))}
            </div>
            <CursorPagination label="Builds you've saved" {...sectionLinks("build", builds)} />
          </Rv>
        </section>
      )}

      {tab === "following" && totalFollowedCars > 0 && (
        <section className="deck">
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Builds you follow</span>
              <span className="chip">{totalFollowedCars}</span>
            </div>
            <div className="rowlist">
              {followedCars.map((car) => (
                <CarRow key={car.id} car={car} kind="follow" />
              ))}
            </div>
            <CursorPagination label="Builds you follow" {...sectionLinks("followed_build", followedBuilds)} />
          </Rv>
        </section>
      )}

      {tab === "following" && sellerCount > 0 && (
        <section className="deck">
          <Rv className="tile tile--deep">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Sellers you follow</span>
              <span className="chip">{sellerCount}</span>
            </div>
            <div className="rowlist">
              {followedSellers.map((p) => (
                <ObjectRow
                  key={p.id}
                  leading={
                    <Avatar
                      size="sm"
                      initials={initialsOf(p.display_name ?? p.username ?? "?")}
                    />
                  }
                  actions={
                    <RelationshipRemove kind="follow" targetType="profile" targetId={p.id} label="Unfollow" />
                  }
                >
                  <span className="min-w-0">
                    <Link
                      href={`/u/${p.username}`}
                      className="order__name block truncate transition-colors hover:text-live"
                    >
                      {p.display_name ?? (p.username ? `@${p.username}` : "DRVN member")}
                    </Link>
                    <span className="order__meta block">view profile →</span>
                  </span>
                </ObjectRow>
              ))}
            </div>
            <CursorPagination label="Sellers you follow" {...sectionLinks("followed_seller", sellers)} />
          </Rv>
        </section>
      )}

      {!isEmpty && !followsError && tab === "following" && totalFollowedCars === 0 && sellerCount === 0 && (
        <section className="deck">
          <Rv>
            <EmptyState
              mark="◎"
              title="Not following anyone yet"
              action={
                <ButtonLink href="/explore" variant="ghost">
                  Explore builds
                </ButtonLink>
              }
            >
              Follow a build or a seller and their updates show up here.
            </EmptyState>
          </Rv>
        </section>
      )}

      <Foot
        left="DRVN — saved parts, builds and sellers"
        right={<Link href="/marketplace">← Marketplace</Link>}
      />
    </div>
  );
}

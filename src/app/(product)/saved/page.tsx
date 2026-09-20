import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import {
  Avatar,
  ButtonLink,
  FilterGroup,
  FilterLink,
  Finder,
  FinderClear,
  FinderLabel,
  Foot,
  ListingCard,
  Mosaic,
  ObjectRow,
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
import { vehicleSubline } from "@/lib/vehicles/label";
import { postHeadline } from "@/lib/activity/headline";
import { postHref } from "@/lib/activity/href";

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
// The other lists on this page (builds saved / builds followed / sellers
// followed) aren't the fetch this page was flagged for — that was the saved
// *parts* query, pulling every save a user ever made with no bound. They get
// a generous cap instead of full ?page= pagination: simpler, and follow
// counts rarely approach it in practice.
const SECONDARY_CAP = 100;

function withParams(
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>
) {
  return buildParams("/saved", params, overrides);
}

/**
 * Saved and followed, correctly labelled — now also correctly bounded.
 *
 * Three bugs fixed here (two originally, one newly found). "Sellers you
 * follow" read profile *saves*, but nothing in the app ever renders a save
 * button for a profile — so that section could never populate, while actual
 * follows appeared nowhere at all. There was no way to unsave anything from
 * this page. And the saved-parts query had no limit at all — every save a
 * user had ever made, and every listing/image/car row behind it, loaded on
 * every visit.
 */
export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string; q?: string; sort?: string }>;
}) {
  const { tab: tabParam, page: pageParam, q, sort: sortParam } = await searchParams;
  const tab: SavedTab = tabParam === "following" ? "following" : "saved";
  const sort: SortKey = sortParam === "price" ? "price" : "newest";
  const query = (q ?? "").trim();
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  // Cheap either way — just the id columns — so both are fetched unbounded
  // to know the true shape of what a user has saved/followed, even though
  // only one tab's worth gets fully hydrated below.
  const [{ data: saves, error: savesError }, { data: follows }, { data: savedSearches, error: searchesError }] =
    await Promise.all([
      supabase
        .from("saves")
        .select("target_type, target_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("follows")
        .select("target_type, target_id, created_at")
        .eq("follower_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("saved_searches")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);

  if (savesError) reportError("[saved] failed to load saves", savesError);

  const listingIds = (saves ?? [])
    .filter((s) => s.target_type === "listing")
    .map((s) => s.target_id);
  const savedCarIds = (saves ?? [])
    .filter((s) => s.target_type === "car")
    .map((s) => s.target_id)
    .slice(0, SECONDARY_CAP);
  const followedCarIds = (follows ?? [])
    .filter((f) => f.target_type === "car")
    .map((f) => f.target_id)
    .slice(0, SECONDARY_CAP);
  const followedProfileIds = (follows ?? [])
    .filter((f) => f.target_type === "profile")
    .map((f) => f.target_id)
    .slice(0, SECONDARY_CAP);
  const savedPostIds = (saves ?? [])
    .filter((s) => s.target_type === "post")
    .map((s) => s.target_id)
    .slice(0, SECONDARY_CAP);

  const totalListingSaves = listingIds.length;
  const totalCarSaves = (saves ?? []).filter((s) => s.target_type === "car").length;
  const totalPostSaves = (saves ?? []).filter((s) => s.target_type === "post").length;
  const totalFollowedCars = (follows ?? []).filter((f) => f.target_type === "car").length;
  const totalFollowedProfiles = (follows ?? []).filter((f) => f.target_type === "profile").length;

  const allCarIds = [...new Set([...savedCarIds, ...followedCarIds])];

  // Saved-parts pagination runs on the listings table (not `saves`) — the
  // save rows are only ever the cheap uuid list above; the actual page and
  // search/sort apply to the listings query itself.
  let listingsQuery = tab === "saved" && listingIds.length
    ? supabase
        .from("listings")
        .select("id, title, price_cents, shipping_cents, shipping_mode, allows_collection, condition, location, status, part_number, seller_id, source_car_id", { count: "exact" })
        .in("id", listingIds)
    : null;
  if (listingsQuery && query) {
    listingsQuery = listingsQuery.ilike("title", `%${query.replace(/[%_]/g, " ")}%`);
  }
  if (listingsQuery) {
    listingsQuery =
      sort === "price"
        ? listingsQuery.order("price_cents", { ascending: true })
        : listingsQuery.order("created_at", { ascending: false });
    listingsQuery = listingsQuery.range(from, from + PAGE_SIZE - 1);
  }

  const [{ data: listings, count: listingsTotal, error: listingsError }, { data: cars }, { data: profiles }] =
    await Promise.all([
      listingsQuery ?? Promise.resolve({ data: [], count: 0, error: null }),
      allCarIds.length
        ? supabase
            .from("cars")
            .select("id, slug, name, make, model, year, cover_image_url")
            .in("id", allCarIds)
        : Promise.resolve({ data: [] }),
      tab === "following" && followedProfileIds.length
        ? supabase
            .from("profiles")
            .select("id, username, display_name")
            .in("id", followedProfileIds)
        : Promise.resolve({ data: [] }),
    ]);

  // Saved build updates (0037): the post, its car (for the deep link), and
  // its first photo. Bounded by SECONDARY_CAP like the other side sections.
  const { data: savedPosts } =
    tab === "saved" && savedPostIds.length
      ? await supabase
          .from("activity_posts")
          .select("id, title, intro, car_id, published_at")
          .in("id", savedPostIds)
          .not("published_at", "is", null)
      : { data: [] };
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
  // Keep the save-order (newest first), and drop posts on private cars. A
  // post with no car (W-5) has nothing to go private, so it stays.
  const savedUpdates = savedPostIds
    .map((id) => (savedPosts ?? []).find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ ...p, car: p.car_id ? savedPostCarById.get(p.car_id) : undefined }))
    .filter((p) => !p.car_id || p.car);

  // Same hydration as the Marketplace grid, so a saved part is the same card
  // it was when it was saved — cover, source car, seller trust, state flag.
  const savedCards = await hydrateListingCards(supabase, listings ?? []);
  const visibleSaved = tab === "saved" && !query && !listingsError && (listingsTotal ?? 0) < listingIds.length
    ? await supabase.from("listings").select("id").in("id", listingIds)
    : null;
  const visibleIds = new Set((visibleSaved?.data ?? []).map(row => row.id));
  const unavailableIds = visibleSaved && !visibleSaved.error ? listingIds.filter(id => !visibleIds.has(id)) : [];


  const carById = new Map<string, CarRowData>((cars ?? []).map((c) => [c.id, c]));
  const savedCars = savedCarIds
    .map((id) => carById.get(id))
    .filter((c): c is CarRowData => Boolean(c));
  const followedCars = followedCarIds
    .map((id) => carById.get(id))
    .filter((c): c is CarRowData => Boolean(c));

  const buildCount = totalCarSaves + totalFollowedCars;
  const sellerCount = totalFollowedProfiles;
  const isEmpty = !savesError && !searchesError && !totalListingSaves && !buildCount && !sellerCount && !(savedSearches ?? []).length;
  const hasMoreListings = tab === "saved" && (listingsTotal ?? 0) > from + PAGE_SIZE;

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
    <div className="wrap">
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">
          Saved · {totalListingSaves} part{totalListingSaves === 1 ? "" : "s"} · {buildCount}{" "}
          build{buildCount === 1 ? "" : "s"} · {sellerCount} seller{sellerCount === 1 ? "" : "s"}
        </span>
        <h1>
          Everything you&apos;re
          <br />
          keeping an <span className="live-word">eye on.</span>
        </h1>
        <p className="sub">
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
      {isEmpty && (
        <section className="deck">
          <Rv className="undrawn undrawn--hero">
            <span className="undrawn__mark" aria-hidden="true">
              ◎
            </span>
            <h3>Nothing saved yet</h3>
            <p>
              Save parts and follow builds and sellers as you browse — they all collect here.
            </p>
            <ButtonLink href="/marketplace" variant="ghost">
              Browse the marketplace
            </ButtonLink>
          </Rv>
        </section>
      )}

      {tab === "saved" && (
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

            {unavailableIds.length > 0 && <div className="rowlist">
              {unavailableIds.map(id => <ObjectRow key={id} actions={<RelationshipRemove kind="save" targetType="listing" targetId={id} label="Unsave" />}>
                <span><span className="order__name block">Unavailable saved part</span><span className="order__meta">This part is no longer publicly available.</span></span>
              </ObjectRow>)}
            </div>}
            <Pagination
              page={page}
              hasMore={hasMoreListings}
              hrefFor={(p) => withParams(tabParams, { page: p === 1 ? undefined : String(p) })}
            />
          </div>
        </section>
      )}

      {tab === "saved" && savedUpdates.length > 0 && (
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
            {totalPostSaves > savedUpdates.length && (
              <p className="field__hint mt-2">Showing your {savedUpdates.length} most recent.</p>
            )}
          </Rv>
        </section>
      )}

      {tab === "saved" && (savedSearches ?? []).length > 0 && (
        <section className="deck">
          <Rv className="tile">
            <TileHead label="Saved searches" end={<span className="chip">{(savedSearches ?? []).length}</span>} />
            <SavedSearchList searches={savedSearches ?? []} />
            <p className="field__hint mt-2">
              Alerts are off unless you turn them on — matching inventory then lands in
              Notifications, never your inbox.
            </p>
          </Rv>
        </section>
      )}

      {tab === "saved" && savedCars.length > 0 && (
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
            {totalCarSaves > savedCars.length && (
              <p className="field__hint mt-2">Showing your {savedCars.length} most recent.</p>
            )}
          </Rv>
        </section>
      )}

      {tab === "following" && followedCars.length > 0 && (
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
            {totalFollowedCars > followedCars.length && (
              <p className="field__hint mt-2">Showing your {followedCars.length} most recent.</p>
            )}
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
              {(profiles ?? []).map((p) => (
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
          </Rv>
        </section>
      )}

      {tab === "following" && followedCars.length === 0 && sellerCount === 0 && (
        <section className="deck">
          <Rv className="undrawn">
            <span className="undrawn__mark" aria-hidden="true">
              ◎
            </span>
            <h3>Not following anyone yet</h3>
            <p>Follow a build or a seller and their updates show up here.</p>
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

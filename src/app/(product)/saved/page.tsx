import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Avatar, Foot, ListingCard, Media } from "@/components/ui";
import { removeFollow, removeSave } from "@/features/social/actions";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

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

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function withParams(
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/saved?${query}` : "/saved";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Cheap either way — just the id columns — so both are fetched unbounded
  // to know the true shape of what a user has saved/followed, even though
  // only one tab's worth gets fully hydrated below.
  const [{ data: saves, error: savesError }, { data: follows }] = await Promise.all([
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

  const totalListingSaves = listingIds.length;
  const totalCarSaves = (saves ?? []).filter((s) => s.target_type === "car").length;
  const totalFollowedCars = (follows ?? []).filter((f) => f.target_type === "car").length;
  const totalFollowedProfiles = (follows ?? []).filter((f) => f.target_type === "profile").length;

  const allCarIds = [...new Set([...savedCarIds, ...followedCarIds])];

  // Saved-parts pagination runs on the listings table (not `saves`) — the
  // save rows are only ever the cheap uuid list above; the actual page and
  // search/sort apply to the listings query itself.
  let listingsQuery = tab === "saved" && listingIds.length
    ? supabase
        .from("listings")
        .select("id, title, price_cents, condition, location, status", { count: "exact" })
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

  const [{ data: listings, count: listingsTotal }, { data: cars }, { data: profiles }] =
    await Promise.all([
      listingsQuery ?? Promise.resolve({ data: [], count: 0 }),
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

  const pageListingIds = (listings ?? []).map((l) => l.id);
  const { data: listingImages } = pageListingIds.length
    ? await supabase
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", pageListingIds)
        .order("position")
    : { data: [] };

  const cover = new Map<string, string>();
  for (const img of listingImages ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }

  const carById = new Map<string, CarRowData>((cars ?? []).map((c) => [c.id, c]));
  const savedCars = savedCarIds
    .map((id) => carById.get(id))
    .filter((c): c is CarRowData => Boolean(c));
  const followedCars = followedCarIds
    .map((id) => carById.get(id))
    .filter((c): c is CarRowData => Boolean(c));

  const buildCount = totalCarSaves + totalFollowedCars;
  const sellerCount = totalFollowedProfiles;
  const isEmpty = !totalListingSaves && !buildCount && !sellerCount;
  const hasMoreListings = tab === "saved" && (listingsTotal ?? 0) > from + PAGE_SIZE;

  const CarRow = ({ car, kind }: { car: CarRowData; kind: "save" | "follow" }) => (
    <div className="order">
      <Link href={`/cars/${car.slug}`} className="order__img">
        <Media src={car.cover_image_url ?? undefined} alt={car.name} className="h-full w-full" />
      </Link>
      <span className="min-w-0">
        <Link
          href={`/cars/${car.slug}`}
          className="order__name block truncate transition-colors hover:text-live"
        >
          {car.name}
        </Link>
        <span className="order__meta block">
          {[car.year, car.make, car.model].filter(Boolean).join(" ") || "build page"}
        </span>
      </span>
      <span className="order__actions">
        <form action={kind === "save" ? removeSave : removeFollow}>
          <input type="hidden" name="target_type" value="car" />
          <input type="hidden" name="target_id" value={car.id} />
          <button type="submit" className="relbtn !static">
            {kind === "save" ? "Unsave" : "Unfollow"}
          </button>
        </form>
      </span>
    </div>
  );

  const tabParams = { q: query || undefined, sort: sort === "price" ? "price" : undefined };

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
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

      <div className="filters" role="group" aria-label="Saved vs following">
        <Link
          href={withParams(tabParams, { tab: undefined, page: undefined })}
          className={`fbtn ${tab === "saved" ? "is-on" : ""}`}
          aria-current={tab === "saved" ? "true" : undefined}
        >
          Saved
        </Link>
        <Link
          href={withParams(tabParams, { tab: "following", page: undefined })}
          className={`fbtn ${tab === "following" ? "is-on" : ""}`}
          aria-current={tab === "following" ? "true" : undefined}
        >
          Following
        </Link>
      </div>

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
            <Link href="/marketplace" className="btn btn--ghost">
              Browse the marketplace
            </Link>
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

            <form action="/saved" method="get" className="filters !mt-3">
              <input type="hidden" name="tab" value="saved" />
              <span className="microlabel filters__label">Search</span>
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Title…"
                className="ctl !max-w-xs"
              />
              <span className="microlabel filters__label ml-2">Sort</span>
              <Link
                href={withParams({ q: query || undefined }, { sort: undefined, tab: undefined, page: undefined })}
                className={`fbtn ${sort === "newest" ? "is-on" : ""}`}
              >
                Newest
              </Link>
              <Link
                href={withParams({ q: query || undefined }, { sort: "price", tab: undefined, page: undefined })}
                className={`fbtn ${sort === "price" ? "is-on" : ""}`}
              >
                Price ↑
              </Link>
              <button type="submit" className="fbtn">
                Search
              </button>
              {query && (
                <Link href={withParams({ sort: sort === "price" ? "price" : undefined }, { q: undefined, page: undefined })} className="fbtn">
                  Clear
                </Link>
              )}
            </form>

            {(listings ?? []).length > 0 ? (
              <div className="mkt mt-4">
                {(listings ?? []).map((l) => (
                  <div key={l.id}>
                    <ListingCard
                      listing={{
                        id: l.id,
                        title: l.title,
                        price_cents: l.price_cents,
                        condition: l.condition,
                        location: l.status === "active" ? l.location : `${l.status}`,
                        cover_url: cover.get(l.id) ?? null,
                      }}
                    />
                    <form action={removeSave} className="mt-2">
                      <input type="hidden" name="target_type" value="listing" />
                      <input type="hidden" name="target_id" value={l.id} />
                      <button type="submit" className="relbtn !static">
                        Unsave
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">
                {query ? `No saved parts match "${query}"` : "Nothing saved yet"}
              </p>
            )}

            {(page > 1 || hasMoreListings) && (
              <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
                {page > 1 ? (
                  <Link
                    href={withParams(tabParams, { page: page - 1 === 1 ? undefined : String(page - 1) })}
                    className="btn btn--ghost"
                    rel="prev"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="microlabel">Page {page}</span>
                {hasMoreListings ? (
                  <Link href={withParams(tabParams, { page: String(page + 1) })} className="btn btn--ghost" rel="next">
                    Next →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </div>
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
                <div key={p.id} className="order">
                  <Avatar
                    size="h-11 w-11 text-xs"
                    initials={initialsOf(p.display_name ?? p.username ?? "?")}
                  />
                  <span className="min-w-0">
                    <Link
                      href={`/u/${p.username}`}
                      className="order__name block truncate transition-colors hover:text-live"
                    >
                      {p.display_name ?? `@${p.username}`}
                    </Link>
                    <span className="order__meta block">view profile →</span>
                  </span>
                  <span className="order__actions">
                    <form action={removeFollow}>
                      <input type="hidden" name="target_type" value="profile" />
                      <input type="hidden" name="target_id" value={p.id} />
                      <button type="submit" className="relbtn !static">
                        Unfollow
                      </button>
                    </form>
                  </span>
                </div>
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

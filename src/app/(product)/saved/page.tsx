import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Avatar, Foot, ListingCard, Media } from "@/components/ui";
import { removeFollow, removeSave } from "@/features/social/actions";
import { createClient } from "@/lib/supabase/server";

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

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Saved and followed, correctly labelled.
 *
 * Two bugs fixed here. "Sellers you follow" read profile *saves*, but nothing in
 * the app ever renders a save button for a profile — so that section could never
 * populate, while actual follows appeared nowhere at all. And there was no way to
 * unsave anything from this page.
 */
export default async function SavedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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

  if (savesError) console.error("[saved] failed to load saves", savesError);

  const listingIds = (saves ?? [])
    .filter((s) => s.target_type === "listing")
    .map((s) => s.target_id);
  const savedCarIds = (saves ?? [])
    .filter((s) => s.target_type === "car")
    .map((s) => s.target_id);
  const followedCarIds = (follows ?? [])
    .filter((f) => f.target_type === "car")
    .map((f) => f.target_id);
  const followedProfileIds = (follows ?? [])
    .filter((f) => f.target_type === "profile")
    .map((f) => f.target_id);

  const allCarIds = [...new Set([...savedCarIds, ...followedCarIds])];

  const [{ data: listings }, { data: cars }, { data: profiles }, { data: listingImages }] =
    await Promise.all([
      listingIds.length
        ? supabase
            .from("listings")
            .select("id, title, price_cents, condition, location, status")
            .in("id", listingIds)
        : Promise.resolve({ data: [] }),
      allCarIds.length
        ? supabase
            .from("cars")
            .select("id, slug, name, make, model, year, cover_image_url")
            .in("id", allCarIds)
        : Promise.resolve({ data: [] }),
      followedProfileIds.length
        ? supabase
            .from("profiles")
            .select("id, username, display_name")
            .in("id", followedProfileIds)
        : Promise.resolve({ data: [] }),
      listingIds.length
        ? supabase
            .from("listing_images")
            .select("listing_id, url, position")
            .in("listing_id", listingIds)
            .order("position")
        : Promise.resolve({ data: [] }),
    ]);

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

  const buildCount = savedCars.length + followedCars.length;
  const sellerCount = (profiles ?? []).length;
  const isEmpty = !listingIds.length && !buildCount && !sellerCount;

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

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Saved · {listingIds.length} part{listingIds.length === 1 ? "" : "s"} · {buildCount}{" "}
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

      {(listings ?? []).length > 0 && (
        <section className="deck">
          <div>
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Saved parts</span>
              <span className="chip">{(listings ?? []).length}</span>
            </div>
            <div className="mkt">
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
          </div>
        </section>
      )}

      {savedCars.length > 0 && (
        <section className="deck">
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Builds you&apos;ve saved</span>
              <span className="chip">{savedCars.length}</span>
            </div>
            <div className="rowlist">
              {savedCars.map((car) => (
                <CarRow key={car.id} car={car} kind="save" />
              ))}
            </div>
          </Rv>
        </section>
      )}

      {followedCars.length > 0 && (
        <section className="deck">
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Builds you follow</span>
              <span className="chip">{followedCars.length}</span>
            </div>
            <div className="rowlist">
              {followedCars.map((car) => (
                <CarRow key={car.id} car={car} kind="follow" />
              ))}
            </div>
          </Rv>
        </section>
      )}

      {sellerCount > 0 && (
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

      <Foot
        left="DRVN — saved parts, builds and sellers"
        right={<Link href="/marketplace">← Marketplace</Link>}
      />
    </div>
  );
}

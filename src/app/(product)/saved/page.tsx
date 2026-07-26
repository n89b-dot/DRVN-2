import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Avatar, Foot, ListingCard, Media } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Saved - DRVN" };

export default async function SavedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: saves } = await supabase
    .from("saves")
    .select("target_type, target_id, created_at")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false });

  const listingIds = (saves ?? []).filter((s) => s.target_type === "listing").map((s) => s.target_id);
  const carIds = (saves ?? []).filter((s) => s.target_type === "car").map((s) => s.target_id);
  const profileIds = (saves ?? []).filter((s) => s.target_type === "profile").map((s) => s.target_id);

  const [{ data: listings }, { data: cars }, { data: profiles }, { data: listingImages }] =
    await Promise.all([
      listingIds.length
        ? supabase
            .from("listings")
            .select("id, title, price_cents, condition, location, status")
            .in("id", listingIds)
        : Promise.resolve({ data: [] }),
      carIds.length
        ? supabase.from("cars").select("id, slug, name, make, model, year, cover_image_url").in("id", carIds)
        : Promise.resolve({ data: [] }),
      profileIds.length
        ? supabase.from("profiles").select("id, username, display_name").in("id", profileIds)
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

  const isEmpty = !listingIds.length && !carIds.length && !profileIds.length;

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Watching · {listingIds.length} parts · {carIds.length} sheets · {profileIds.length} keepers
        </span>
        <h1>
          Everything you&apos;re
          <br />
          keeping an <span className="live-word">eye on.</span>
        </h1>
        <p className="sub">
          Watched parts keep ticking whether you&apos;re looking or not. Spent listings stay on the
          sheet — history is part of the drawing.
        </p>
      </Rv>

      {isEmpty && (
        <section className="deck">
          <Rv className="undrawn undrawn--hero">
            <span className="undrawn__mark" aria-hidden="true">
              ◎
            </span>
            <h3>Nothing on the watchlist</h3>
            <p>Save parts, car sheets and keepers as you browse — they collect here and keep counting.</p>
            <Link href="/marketplace" className="btn btn--ghost">
              Browse the market
            </Link>
          </Rv>
        </section>
      )}

      {(listings ?? []).length > 0 && (
        <section className="deck">
          <div>
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Parts you&apos;re watching</span>
              <span className="chip">{(listings ?? []).length}</span>
            </div>
            <div className="mkt">
              {(listings ?? []).map((l) => (
                <ListingCard
                  key={l.id}
                  listing={{
                    id: l.id,
                    title: l.title,
                    price_cents: l.price_cents,
                    condition: l.condition,
                    location: l.status === "active" ? l.location : `${l.status}`,
                    cover_url: cover.get(l.id) ?? null,
                  }}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {(cars ?? []).length > 0 && (
        <section className="deck">
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Sheets you follow</span>
              <span className="chip">{(cars ?? []).length}</span>
            </div>
            <div className="rowlist">
              {(cars ?? []).map((car) => (
                <Link key={car.id} href={`/cars/${car.slug}`} className="order">
                  <span className="order__img">
                    <Media src={car.cover_image_url ?? undefined} alt={car.name} className="h-full w-full" />
                  </span>
                  <span>
                    <span className="order__name block">{car.name}</span>
                    <span className="order__meta block">
                      {[car.year, car.make, car.model].filter(Boolean).join(" ") || "car sheet"}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </Rv>
        </section>
      )}

      {(profiles ?? []).length > 0 && (
        <section className="deck">
          <Rv className="tile tile--deep">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Keepers you follow</span>
              <span className="chip">{(profiles ?? []).length}</span>
            </div>
            <div className="rowlist">
              {(profiles ?? []).map((p) => (
                <Link key={p.id} href={`/u/${p.username}`} className="order">
                  <Avatar
                    size="h-11 w-11 text-xs"
                    initials={(p.display_name ?? p.username ?? "?")
                      .split(" ")
                      .map((w: string) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  />
                  <span>
                    <span className="order__name block">{p.display_name ?? `@${p.username}`}</span>
                    <span className="order__meta block">keeper sheet →</span>
                  </span>
                </Link>
              ))}
            </div>
          </Rv>
        </section>
      )}

      <Foot
        left="DRVN / Livesheet — the sheet keeps watching when you don't"
        right={<Link href="/marketplace">← The market</Link>}
      />
    </div>
  );
}

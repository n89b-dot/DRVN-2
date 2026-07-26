import Link from "next/link";

import { LiveDim, Rv } from "@/components/livesheet";
import { Foot, ListingCard, Media } from "@/components/ui";
import { FeedList } from "@/components/ui/feed-list";
import { fetchFeed } from "@/lib/feed";
import { recommendListings } from "@/lib/recommendations";
import { createClient } from "@/lib/supabase/server";

import { PostUpdatePrompt } from "./post-update-prompt";

export const metadata = { title: "Home - DRVN" };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

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
  const garage = cars ?? [];

  return (
    <div className="wrap">
      {/* Page head — the sheet reports what it saw */}
      <Rv as="header" className="pagehead">
        <span className="microlabel">Your sheet — today</span>
        <h1>
          {greeting()}
          {firstName ? `, ${firstName}` : ""}.
          <br />
          Your sheet is <span className="live-word">live.</span>
        </h1>
        <p className="sub">
          The garage, your watchlist and the latest from the scene — ruled onto one page,
          updating as it happens.
        </p>
        <div className="jumprow">
          <span className="microlabel">On this sheet</span>
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
            The market →
          </Link>
        </div>
      </Rv>

      {/* The garage + composer */}
      <section className="deck deck--two">
        <Rv className="tile" stagger={0}>
          <div className="tile__head">
            <span className="microlabel microlabel--ink">The garage</span>
            <span className="chip">{garage.length ? `${garage.length} on the sheet` : "Empty bay"}</span>
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
                    <span className="order__meta block">full sheet →</span>
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
                Add the car you&apos;re building. Photos, spec, and every part that comes off it
                hang from this one sheet.
              </p>
              <Link href="/garage" className="btn btn--live">
                Open your first sheet
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
            <span className="microlabel microlabel--ink">Draw a new line</span>
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
            label="Cars on the sheet"
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
              <span className="microlabel microlabel--ink">Recommended for your garage</span>
              <Link href="/marketplace" className="microlabel mono">
                Open the market →
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
      <section className="deck">
        <Rv className="tile">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">The feed — latest from the scene</span>
          </div>
          <FeedList items={items} />
        </Rv>
      </section>

      <Foot left="DRVN / Livesheet — your sheet" right={<Link href="/marketplace">The market →</Link>} />
    </div>
  );
}

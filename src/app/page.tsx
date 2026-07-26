import { cookies } from "next/headers";
import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot, LivesheetBar, Media } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

export const metadata = {
  title: "DRVN — The parts market where every listing comes off a drawing",
  description:
    "Buy and sell parts off real modified cars. Every listing carries the sheet it came from — what car, when it was fitted, and who's selling it.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "DRVN — the parts market where every listing comes off a drawing",
    description:
      "Buy and sell parts off real modified cars. Every listing carries the sheet it came from.",
    url: "/",
    type: "website",
  },
};

/**
 * Public landing — the Livesheet pitch.
 *
 * Uses the real `LivesheetBar` (signed-out variant) rather than a hand-rolled
 * header: the bespoke one used `.bar__link`, which is `display:none` below
 * 980px, so on every phone and tablet the landing page had no visible
 * navigation at all.
 *
 * Content is live data, not seed fixtures — the previous version presented
 * hardcoded showcase cars as "sheets being drawn", against the design system's
 * own no-fake-data rule.
 */
export default async function LandingPage() {
  const supabase = await createClient();
  const jar = await cookies();
  const night = jar.get("ls-theme")?.value === "night";

  const [{ data: carRows }, { data: listingRows }, { count: liveListingCount }] = await Promise.all([
    supabase
      .from("cars")
      .select("id, slug, name, make, model, year, cover_image_url")
      .eq("is_public", true)
      .not("cover_image_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("listings")
      .select("id, title, price_cents, category, source_car_id")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(3),
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);

  const cars = carRows ?? [];
  const listings = listingRows ?? [];
  const liveCount = liveListingCount ?? 0;
  const heroImage = cars[0]?.cover_image_url ?? null;

  return (
    <div className="min-h-screen">
      <LivesheetBar signedIn={false} initialNight={night} />

      <main className="wrap">
        <Rv as="section" className="pagehead">
          <span className="microlabel">
            DRVN — the parts market where every listing comes off a drawing
          </span>
          <h1>
            The sheet is <span className="live-word">alive.</span>
          </h1>
          <p className="sub">
            Every car on DRVN is a live drawing. List a part and it goes to market annotated —
            what it came off, when it was fitted, who&apos;s watching it right now. Buyers see the
            sheet, not a promise.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/signup" className="btn btn--live">
              Open your sheet
            </Link>
            <Link href="/marketplace" className="btn btn--ghost">
              Browse the market
            </Link>
          </div>
        </Rv>

        {heroImage && (
          <Rv className="hero-media mb-10">
            <Media src={heroImage} alt="A build on its sheet" className="h-full w-full" />
          </Rv>
        )}

        {/* How the sheet works */}
        <section className="deck deck--three">
          <Rv className="tile" stagger={0}>
            <div className="tile__head">
              <span className="microlabel">
                <span className="mono">01</span> — Open a sheet
              </span>
            </div>
            <p className="text-[15px] leading-relaxed">
              Your car becomes a live drawing — the build, the receipts, the history, ruled onto
              one page that updates itself.
            </p>
          </Rv>
          <Rv className="tile" stagger={1}>
            <div className="tile__head">
              <span className="microlabel">
                <span className="mono">02</span> — List parts off it
              </span>
              <span className="chip">From the sheet</span>
            </div>
            <p className="text-[15px] leading-relaxed">
              Release a component and the listing writes itself off the drawing — fitted dates,
              mileage, what it ran with.
            </p>
          </Rv>
          <Rv className="tile" stagger={2}>
            <div className="tile__head">
              <span className="microlabel">
                <span className="mono">03</span> — Sell while it&apos;s watched
              </span>
              <span className="chip chip--live">Live</span>
            </div>
            <p className="text-[15px] leading-relaxed">
              Offers arrive as work orders on your sheet — accept, counter, or pass while the
              watch-counts tick.
            </p>
          </Rv>
        </section>

        {/* Sheets being drawn */}
        <section className="deck">
          <div>
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Sheets being drawn</span>
              <Link href="/explore" className="microlabel mono hover:text-live">
                Survey all sheets →
              </Link>
            </div>
            <div className="mkt">
              {cars.map((car, i) => (
                <Rv key={car.id} className="tile" stagger={i}>
                  <Link href={`/cars/${car.slug}`}>
                    <span className="tile__img block aspect-[3/2]">
                      <Media
                        src={car.cover_image_url ?? undefined}
                        alt={car.name}
                        className="h-full w-full"
                      />
                    </span>
                    <p className="mkt__name">{car.name}</p>
                    <p className="kv mt-0.5 text-dim">
                      {[car.year, car.make, car.model].filter(Boolean).join(" ")}
                    </p>
                  </Link>
                </Rv>
              ))}
            </div>
          </div>
        </section>

        {/* Parts off a live sheet */}
        <section className="deck">
          <div>
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Parts off a live sheet</span>
              <Link href="/marketplace" className="microlabel mono hover:text-live">
                Open the market →
              </Link>
            </div>
            <div className="mkt">
              {listings.map((listing, i) => (
                <Rv key={listing.id} className="tile" stagger={i}>
                  <Link href={`/listings/${listing.id}`}>
                    <p className="mkt__name clamp2">{listing.title}</p>
                    <p className="mkt__price">{money.format(listing.price_cents / 100)}</p>
                    <span className="mkt__meta">
                      {listing.source_car_id && (
                        <span className="chip chip--ok">Off a sheet</span>
                      )}
                    </span>
                  </Link>
                </Rv>
              ))}
            </div>
          </div>
        </section>

        {/* Ink band — the thesis, not fake stats */}
        <section className="deck">
          <Rv className="band">
            <span className="microlabel">The idea, measured</span>
            <div className="band__stats">
              <div>
                <p className="num-giant">1</p>
                <div className="bandrule" />
                <span className="microlabel">Sheet per car — the spine everything hangs from</span>
              </div>
              <div>
                <p className="num-giant">{liveCount}</p>
                <div className="bandrule" />
                <span className="microlabel">
                  Part{liveCount === 1 ? "" : "s"} on the market right now
                </span>
              </div>
              <div>
                <p className="num-giant">48h</p>
                <div className="bandrule" />
                <span className="microlabel">Offer windows — the clock is the contract</span>
              </div>
            </div>
          </Rv>
        </section>

        <Foot
          left="DRVN / Livesheet — a drawing that knows what's happening"
          right={
            <>
              <Link href="/explore" className="hover:text-live">
                Explore
              </Link>
              {" · "}
              <Link href="/marketplace" className="hover:text-live">
                Market
              </Link>
              {" · "}
              <Link href="/login" className="hover:text-live">
                Sign in
              </Link>
            </>
          }
        />
      </main>
    </div>
  );
}

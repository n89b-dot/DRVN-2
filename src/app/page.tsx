import { cookies } from "next/headers";
import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot, LivesheetBar, Media } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

export const metadata = {
  title: "DRVN — Buy and sell parts off modified cars",
  description:
    "The marketplace for used and take-off parts from modified cars. Browse by category or car, see the build behind every listing, and sell the parts you pull off your own.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "DRVN — buy and sell parts off modified cars",
    description:
      "The marketplace for used and take-off parts from modified cars — with the build behind every listing.",
    url: "/",
    type: "website",
  },
};

/**
 * Public landing — the marketplace pitch.
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
            DRVN — the marketplace for modified car parts
          </span>
          <h1>
            Used parts, off real <span className="live-word">builds.</span>
          </h1>
          <p className="sub">
            Somebody out there needs the parts sitting in your garage. DRVN is where used parts
            from modified cars get bought and sold — and where you can see the exact car a part
            came off before you hand over a cent.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/marketplace" className="btn btn--live">
              Browse parts
            </Link>
            <Link href="/signup" className="btn btn--ghost">
              Start selling
            </Link>
          </div>
        </Rv>

        {heroImage && (
          <Rv className="hero-media mb-10">
            <Media src={heroImage} alt="A modified car on DRVN" className="h-full w-full" role="hero" />
          </Rv>
        )}

        {/* How it works — buyer, trust, seller */}
        <section className="deck deck--three">
          <Rv className="tile" stagger={0}>
            <div className="tile__head">
              <span className="microlabel">
                <span className="mono">01</span> — Find the part
              </span>
            </div>
            <p className="text-body leading-relaxed">
              Search by name, brand or part number — or flip one switch and only see parts that
              fit the car you actually drive.
            </p>
          </Rv>
          <Rv className="tile" stagger={1}>
            <div className="tile__head">
              <span className="microlabel">
                <span className="mono">02</span> — See the car it came off
              </span>
              <span className="chip">Build pages</span>
            </div>
            <p className="text-body leading-relaxed">
              No more &quot;came off a clean car, trust me.&quot; Parts released off a documented
              build link straight to its page — the mod list, the photos, the owner — and
              they&apos;re badged, so you can tell provenance from a plain listing at a glance.
            </p>
          </Rv>
          <Rv className="tile" stagger={2}>
            <div className="tile__head">
              <span className="microlabel">
                <span className="mono">03</span> — Sell what you take off
              </span>
              <span className="chip">Free to list</span>
            </div>
            <p className="text-body leading-relaxed">
              List a part in a few minutes, straight off your own build. Take offers, get paid,
              ship it. 10% when it sells — nothing to list, nothing to browse.
            </p>
          </Rv>
        </section>

        {/* Builds */}
        <section className="deck">
          <div>
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Builds on DRVN</span>
              <Link href="/explore" className="microlabel mono hover:text-live">
                Explore all builds →
              </Link>
            </div>
            {cars.length === 0 && (
              <div className="tile">
                <span className="microlabel">First builds landing</span>
                <p className="text-body leading-relaxed text-dim">
                  Garages are being documented right now. Add yours and your car&apos;s build
                  page is the provenance behind every part you sell off it.
                </p>
                <Link href="/signup" className="jumplink mt-2 inline-block">
                  Start your garage →
                </Link>
              </div>
            )}
            <div className="mkt">
              {cars.map((car, i) => (
                <Rv key={car.id} className="tile" stagger={i}>
                  <Link href={`/cars/${car.slug}`}>
                    <span className="tile__img block aspect-[3/2]">
                      <Media
                        src={car.cover_image_url ?? undefined}
                        alt={car.name}
                        className="h-full w-full"
                        role="card"
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

        {/* Recently listed */}
        <section className="deck">
          <div>
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Recently listed</span>
              <Link href="/marketplace" className="microlabel mono hover:text-live">
                Browse the marketplace →
              </Link>
            </div>
            {listings.length === 0 && (
              <div className="tile">
                <span className="microlabel">The market is warming up</span>
                <p className="text-body leading-relaxed text-dim">
                  Parts get listed straight off documented builds. Browse the marketplace, or
                  be the first to release something off yours.
                </p>
                <Link href="/sell" className="jumplink mt-2 inline-block">
                  List a part →
                </Link>
              </div>
            )}
            <div className="mkt">
              {listings.map((listing, i) => (
                <Rv key={listing.id} className="tile" stagger={i}>
                  <Link href={`/listings/${listing.id}`}>
                    <p className="mkt__name clamp2">{listing.title}</p>
                    <p className="mkt__price">{money.format(listing.price_cents / 100)}</p>
                    <span className="mkt__meta">
                      {listing.source_car_id && (
                        <span className="chip chip--ok">Off a build</span>
                      )}
                    </span>
                  </Link>
                </Rv>
              ))}
            </div>
          </div>
        </section>

        {/* The terms, stated plainly — real numbers only */}
        <section className="deck">
          <Rv className="band">
            <span className="microlabel">How it works, in numbers</span>
            <div className="band__stats">
              <div>
                <p className="num-giant">{liveCount}</p>
                <div className="bandrule" />
                <span className="microlabel">
                  Part{liveCount === 1 ? "" : "s"} for sale right now
                </span>
              </div>
              <div>
                <p className="num-giant">10%</p>
                <div className="bandrule" />
                <span className="microlabel">
                  Seller fee when a part sells — free to list, free to browse
                </span>
              </div>
              <div>
                <p className="num-giant">72h</p>
                <div className="bandrule" />
                <span className="microlabel">
                  Offer window — sellers accept, counter or pass
                </span>
              </div>
            </div>
          </Rv>
        </section>

        {/* Buyer protection — the trust floor under every order */}
        <section className="deck deck--three">
          <Rv className="tile" stagger={0}>
            <div className="tile__head">
              <span className="microlabel">Payment held safe</span>
            </div>
            <p className="text-body leading-relaxed">
              Your payment is processed by Stripe and the seller isn&apos;t paid out until
              after delivery plus a clearing window — the money waits until the part arrives.
            </p>
          </Rv>
          <Rv className="tile" stagger={1}>
            <div className="tile__head">
              <span className="microlabel">Not as described?</span>
            </div>
            <p className="text-body leading-relaxed">
              Every used part is sold against a frozen condition disclosure. If what arrives
              doesn&apos;t match it, open a dispute with photos — sellers must respond, and
              DRVN steps in when they don&apos;t.
            </p>
          </Rv>
          <Rv className="tile" stagger={2}>
            <div className="tile__head">
              <span className="microlabel">The full policy</span>
            </div>
            <p className="text-body leading-relaxed">
              Response windows, refunds, and what&apos;s covered — written down, not
              vibes-based.{" "}
              <Link href="/protection" className="jumplink">
                Read buyer protection →
              </Link>
            </p>
          </Rv>
        </section>

        <Foot
          left="DRVN — used parts from modified cars"
          right={
            <>
              <Link href="/explore" className="hover:text-live">
                Explore
              </Link>
              {" · "}
              <Link href="/marketplace" className="hover:text-live">
                Marketplace
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

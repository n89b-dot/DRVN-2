import { cookies } from "next/headers";
import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot, LivesheetBar, Media } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { vehicleSubline } from "@/lib/vehicles/label";

export const metadata = {
  title: "DRVN — The home for your car and its build",
  description:
    "Document your car and its build, follow what everyone else is building, and buy or sell the parts that come off. Every part shows the car it came off.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "DRVN — the home for your car and its build",
    description:
      "Follow what people are building, and buy or sell the parts that come off — with the car behind every part.",
    url: "/",
    type: "website",
  },
};

/**
 * Public landing — what DRVN is, and both ways in (F-1, F-2).
 *
 * It used to open with the marketplace pitch alone, from the retired
 * marketplace-first PRD. DRVN is car-centred with two front doors, so the
 * page leads with the car and offers two equal actions — Add your car and
 * Shop parts — and builds come before parts all the way down. Neither
 * action is a ghost button: one is the accent, the other the ink fill, so
 * they read as a genuine choice rather than a primary and an afterthought.
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

  const [
    { data: carRows },
    { data: listingRows },
    { count: liveListingCount },
    { count: publicCarCount },
  ] = await Promise.all([
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
    supabase.from("cars").select("id", { count: "exact", head: true }).eq("is_public", true),
  ]);

  const cars = carRows ?? [];
  const listings = listingRows ?? [];
  const liveCount = liveListingCount ?? 0;
  const carCount = publicCarCount ?? 0;
  const heroImage = cars[0]?.cover_image_url ?? null;

  return (
    <div className="min-h-screen">
      <LivesheetBar signedIn={false} initialNight={night} />

      <main className="wrap">
        <Rv as="section" className="pagehead">
          <span className="microlabel">DRVN — builds and parts</span>
          <h1>
            The home for your car and its <span className="live-word">build.</span>
          </h1>
          <p className="sub">
            Put your car on DRVN and keep a record of what you&apos;ve done to it. Follow what
            everyone else is building. And when something comes off, sell it here — where a
            buyer can see the exact car it came off before they hand over a cent.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/signup" className="btn btn--live">
              Add your car
            </Link>
            <Link href="/marketplace" className="btn">
              Shop parts
            </Link>
          </div>
        </Rv>

        {heroImage && (
          <Rv className="hero-media mb-10">
            <Media src={heroImage} alt="A modified car on DRVN" className="h-full w-full" role="hero" />
          </Rv>
        )}

        {/* What DRVN is — the car first, then the community, then the market. */}
        <section className="deck deck--three">
          <Rv className="tile" stagger={0}>
            <div className="tile__head">
              <span className="microlabel">
                <span className="mono">01</span> — Your garage
              </span>
            </div>
            <p className="text-body leading-relaxed">
              Add your car, list what you&apos;ve done to it, and post an update when something
              changes. That build page is your record of the car — and the provenance behind
              anything you sell off it.
            </p>
          </Rv>
          <Rv className="tile" stagger={1}>
            <div className="tile__head">
              <span className="microlabel">
                <span className="mono">02</span> — Follow the builds
              </span>
              <span className="chip">Explore</span>
            </div>
            <p className="text-body leading-relaxed">
              One feed of builds, updates and parts from everyone else on DRVN. Follow a car or
              the person behind it and their next move turns up on your Home.
            </p>
          </Rv>
          <Rv className="tile" stagger={2}>
            <div className="tile__head">
              <span className="microlabel">
                <span className="mono">03</span> — Buy and sell the parts
              </span>
              <span className="chip">Free to list</span>
            </div>
            <p className="text-body leading-relaxed">
              Parts come off cars. Sell yours straight off your build page, or buy someone
              else&apos;s and see the car it came off first. Browsing and buying need no
              account; 10% when a part sells, nothing to list.
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
                  Garages are being documented right now. Add yours and your car gets a build
                  page — the record of what you&apos;ve done, and the provenance behind every
                  part you sell off it.
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
                    {vehicleSubline(car.name, car) && (
                      <p className="kv mt-0.5 text-dim">{vehicleSubline(car.name, car)}</p>
                    )}
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

        {/* DRVN stated plainly — real numbers only, cars before parts. The
            band is three columns by recipe, so the offer window lives on the
            marketplace rather than crowding the front door. */}
        <section className="deck">
          <Rv className="band">
            <span className="microlabel">DRVN in numbers</span>
            <div className="band__stats">
              <div>
                <p className="num-giant">{carCount}</p>
                <div className="bandrule" />
                <span className="microlabel">
                  Car{carCount === 1 ? "" : "s"} with a public build page
                </span>
              </div>
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
          left="DRVN — the home for your car and its build"
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

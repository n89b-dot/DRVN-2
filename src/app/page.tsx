import { cookies } from "next/headers";
import Link from "next/link";

import { Rv } from "@/components/livesheet";
import {
  ButtonLink,
  EmptyState,
  Foot,
  ListingCard,
  LivesheetBar,
  Media,
  Mosaic,
  PageHead,
  TileHead,
} from "@/components/ui";
import { betaAccessIsEnforced } from "@/lib/beta-access";
import { hydrateListingCards } from "@/lib/marketplace/query";
import { createPublicClient } from "@/lib/supabase/public";
import { vehicleSubline } from "@/lib/vehicles/label";

/** The front door's two actions. The add-car intent survives signup and
 *  onboarding: a new account's garage opens on the add-car form. */
const ADD_CAR_HREF = "/signup?next=%2Fgarage";

/** Four cards close the grid at every width the wall uses (4 across on
 *  desktop, 2×2 on phones) — three left an empty column or an orphan. */
const ROW_SIZE = 4;

/** Counts only earn the ink band once they read as a crowd. "17 cars"
 *  in display type tells a first-time visitor the place is empty; below
 *  this the fee line lives in the 03 tile alone. */
const NUMBERS_BAND_FLOOR = 100;

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
  // Only signed-out visitors reach this page (the proxy sends members to
  // /home), and what it shows is the same for all of them — newest public
  // cars and live parts, and two totals. A one-minute cache serves it
  // without asking the database on every visit.
  const supabase = createPublicClient({ revalidate: 60, tags: ["landing"] });
  const jar = await cookies();
  const night = jar.get("ls-theme")?.value === "night";

  const [
    { data: carRows },
    { data: listingRows },
    { count: liveListingCount },
    { count: publicCarCount },
    betaEnforced,
  ] = await Promise.all([
    supabase
      .from("cars")
      .select("id, slug, name, make, model, year, cover_image_url")
      .eq("is_public", true)
      .not("cover_image_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(ROW_SIZE),
    supabase
      .from("listings")
      .select("id, title, price_cents, shipping_cents, condition, location, part_number, seller_id, source_car_id")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(ROW_SIZE),
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("cars").select("id", { count: "exact", head: true }).eq("is_public", true),
    betaAccessIsEnforced(),
  ]);

  const cars = carRows ?? [];
  // The same card the marketplace, the item page's rails and the auth
  // backdrop render: a photo, the price and the car it came off.
  const listings = await hydrateListingCards(supabase, listingRows ?? []).catch(() => []);
  const liveCount = liveListingCount ?? 0;
  const carCount = publicCarCount ?? 0;
  const showNumbers = carCount >= NUMBERS_BAND_FLOOR && liveCount >= NUMBERS_BAND_FLOOR;
  const heroImage = cars[0]?.cover_image_url ?? null;

  return (
    <div className="min-h-screen">
      <LivesheetBar signedIn={false} initialNight={night} />

      <main className="wrap">
        <PageHead
          eyebrow="Free to browse · free to list"
          title={
            <>
              The home for your car and its <span className="live-word">build.</span>
            </>
          }
          sub={
            <>
              Put your car on DRVN and keep a record of what you&apos;ve done to it. Follow what
              everyone else is building. And when something comes off, sell it here — where a
              buyer can see the exact car it came off before they hand over a cent.
            </>
          }
        >
          <div className="mt-5 flex flex-wrap gap-3">
            {/* Invite-only: "Add your car" would end at "joining is by
                invitation", so the first action is one anyone can take. */}
            <ButtonLink href={betaEnforced ? "/explore" : ADD_CAR_HREF} variant="live">
              {betaEnforced ? "Explore builds" : "Add your car"}
            </ButtonLink>
            <ButtonLink href="/marketplace">Shop parts</ButtonLink>
          </div>
        </PageHead>

        {heroImage && (
          <Rv className="hero-media landing-hero mb-10" immediate>
            <Media src={heroImage} alt="A modified car on DRVN" className="h-full w-full" role="hero" />
          </Rv>
        )}

        {/* What DRVN is — the car first, then the community, then the market.
            The trailing links are real links: they used to be filled chips
            on plain spans, which a visitor tapped and nothing happened. */}
        <section className="deck deck--three">
          <Rv className="tile" stagger={0}>
            <TileHead label="Your garage" />
            <p className="text-body leading-relaxed">
              Add your car, list what you&apos;ve done to it, and post an update when something
              changes. That build page is your record of the car — and the provenance behind
              anything you sell off it.
            </p>
          </Rv>
          <Rv className="tile" stagger={1}>
            <TileHead
              label="Follow the builds"
              end={
                <Link href="/explore" className="jumplink">
                  Explore →
                </Link>
              }
            />
            <p className="text-body leading-relaxed">
              One feed of builds, updates and parts from everyone else on DRVN. Follow a car or
              the person behind it and their next move turns up on your Home.
            </p>
          </Rv>
          <Rv className="tile" stagger={2}>
            <TileHead
              label="Buy and sell parts"
              end={
                <Link href="/marketplace" className="jumplink">
                  Shop →
                </Link>
              }
            />
            <p className="text-body leading-relaxed">
              Parts come off cars. Sell yours straight off your build page, or buy someone
              else&apos;s and see the car it came off first.{" "}
              {/* Invite-only beta closes guest checkout ("Sign in to buy"), so
                  the promise of account-free buying only holds when it's off. */}
              {betaEnforced
                ? "Browsing needs no account; buying and selling are open to invited members during the beta."
                : "Browsing and buying need no account;"}{" "}
              10% when a part sells, nothing to list.
            </p>
          </Rv>
        </section>

        {/* Builds */}
        <section className="deck">
          <div>
            <TileHead
              label="Builds on DRVN"
              end={
                <Link href="/explore" className="jumplink">
                  All builds →
                </Link>
              }
            />
            {cars.length === 0 ? (
              <EmptyState
                title="First builds landing"
                action={
                  <Link href={ADD_CAR_HREF} className="jumplink">
                    Start your garage →
                  </Link>
                }
              >
                Garages are being documented right now. Add yours and your car gets a build page
                — the record of what you&apos;ve done, and the provenance behind every part you
                sell off it.
              </EmptyState>
            ) : (
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
            )}
          </div>
        </section>

        {/* Recently listed */}
        <section className="deck">
          <div>
            <TileHead
              label="Recently listed"
              end={
                <Link href="/marketplace" className="jumplink">
                  All parts →
                </Link>
              }
            />
            {listings.length === 0 ? (
              <EmptyState
                title="The market is warming up"
                action={
                  <Link href="/sell" className="jumplink">
                    List a part →
                  </Link>
                }
              >
                Parts get listed straight off documented builds. Browse the marketplace, or be
                the first to release something off yours.
              </EmptyState>
            ) : (
              <Mosaic label="Recently listed parts">
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} prefetch={false} />
                ))}
              </Mosaic>
            )}
          </div>
        </section>

        {/* DRVN stated plainly — real numbers only, cars before parts, and
            only once they're big enough to be social proof. */}
        {showNumbers && (
          <section className="deck">
            <Rv className="band">
              <span className="microlabel">DRVN in numbers</span>
              <div className="band__stats">
                <div>
                  <p className="num-giant">{carCount}</p>
                  <div className="bandrule" />
                  <span className="microlabel">Cars with a public build page</span>
                </div>
                <div>
                  <p className="num-giant">{liveCount}</p>
                  <div className="bandrule" />
                  <span className="microlabel">Parts for sale right now</span>
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
        )}

        {/* Buyer protection — the trust floor under every order */}
        <section className="deck deck--three">
          <Rv className="tile" stagger={0}>
            <TileHead label="Payment held safe" />
            <p className="text-body leading-relaxed">
              Your payment is processed by Stripe and the seller isn&apos;t paid out until
              after delivery plus a clearing window — the money waits until the part arrives.
            </p>
          </Rv>
          <Rv className="tile" stagger={1}>
            <TileHead label="Not as described?" />
            <p className="text-body leading-relaxed">
              Every used part is sold against a frozen condition disclosure. If what arrives
              doesn&apos;t match it, open a dispute with photos — sellers must respond, and
              DRVN steps in when they don&apos;t.
            </p>
          </Rv>
          <Rv className="tile" stagger={2}>
            <TileHead label="The full policy" />
            <p className="text-body leading-relaxed">
              Response windows, refunds, and what&apos;s covered — written down, not
              vibes-based.{" "}
              <Link href="/protection" className="jumplink">
                Read buyer protection →
              </Link>
            </p>
          </Rv>
        </section>

        {/* The page ends on the choice it opened with — a "which way in"
            page shouldn't close on policy text. */}
        <section className="deck">
          <Rv className="tile landing-close">
            <h2 className="landing-close__title">Two ways in.</h2>
            <p className="landing-close__sub">
              Bring your car and start its page, or go straight to the parts. You can do the
              other one later.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={betaEnforced ? "/explore" : ADD_CAR_HREF} variant="live">
                {betaEnforced ? "Explore builds" : "Add your car"}
              </ButtonLink>
              <ButtonLink href="/marketplace">Shop parts</ButtonLink>
            </div>
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
              {" · "}
              <Link href="/terms" className="hover:text-live">
                Terms
              </Link>
              {" · "}
              <Link href="/privacy" className="hover:text-live">
                Privacy
              </Link>
              {" · "}
              <Link href="/fees" className="hover:text-live">
                Fees
              </Link>
              {" · "}
              <Link href="/protection" className="hover:text-live">
                Protection
              </Link>
            </>
          }
        />
      </main>
    </div>
  );
}

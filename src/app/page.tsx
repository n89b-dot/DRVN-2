import { cookies } from "next/headers";
import Link from "next/link";

import { Rv } from "@/components/livesheet";
import {
  Button,
  ButtonLink,
  Foot,
  type ListingCardData,
  LivesheetBar,
  Media,
  PageHead,
} from "@/components/ui";
import { betaAccessIsEnforced } from "@/lib/beta-access";
import { hydrateListingCards } from "@/lib/marketplace/query";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { createPublicClient } from "@/lib/supabase/public";
import { vehicleLabel, vehicleSubline } from "@/lib/vehicles/label";
import { DISPUTE_WINDOW_DAYS } from "@/features/commerce/disputes";
import { VehicleFilterField } from "@/features/marketplace/vehicle-filter-field";

/** The two front-door actions, both about the visitor's own car. Members
 *  never see this page (the proxy sends them to /home), so selling always
 *  starts with an account — and the intent survives sign-up. */
const SELL_HREF = "/signup?next=%2Fsell";
const ADD_CAR_HREF = "/signup?next=%2Fgarage";
const PICKER_ID = "your-car";

/** The hero photograph — a generated image, not a member's car, so nothing
 *  on it is presented as a listing. The parts for sale sit in the strip
 *  under it and are live. */
const HERO_SRC = "/landing/rx7-garage.jpg";

/** Counts only earn the ink band once they read as a crowd. "17 cars" in
 *  display type tells a first-time visitor the place is empty. */
const NUMBERS_BAND_FLOOR = 100;

export const metadata = {
  title: "DRVN — The parts marketplace for modified cars",
  description:
    "Buy and sell parts off modified cars. Sell what comes off yours, and shop parts off cars like it — every part shown with the car it came from.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "DRVN — the parts marketplace for modified cars",
    description:
      "Sell what comes off your car. Shop parts off cars like yours, each one shown with the car it came from.",
    url: "/",
    type: "website",
  },
};

type CarRow = {
  id: string;
  slug: string | null;
  name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  cover_image_url: string | null;
  cover_focal_x: number | null;
  cover_focal_y: number | null;
  is_public: boolean;
};

type PlatformCarRow = CarRow & { catalog_make_id: number | null; catalog_model_id: number | null };

/** A make + model shown as a "What do you drive?" tile. `builds` is the
 *  trending count; null when the tile came from the recent-cars fallback,
 *  whose sample size isn't a count worth printing. */
type Platform = { make: string; model: string; builds: number | null; makeId: number | null; modelId: number | null };

const CAR_COLUMNS = "id, slug, name, make, model, year, cover_image_url, cover_focal_x, cover_focal_y, is_public";
const PLATFORM_COLUMNS = `${CAR_COLUMNS}, catalog_make_id, catalog_model_id`;
const LISTING_COLUMNS =
  "id, title, price_cents, shipping_cents, condition, location, part_number, seller_id, source_car_id, status";

/**
 * Public landing — what DRVN is, for someone who has never seen it (F-1,
 * revised 2026-10-17).
 *
 * It says it plainly — the parts marketplace for modified cars — and then
 * ties that to the visitor's own car, both ways: shop parts for it, sell
 * what comes off it. The community comes in as the reason a part can be
 * trusted (every seller has a car you can look at), not as a second
 * headline. In-app vocabulary (build page, provenance, feed) stays off the
 * front door.
 *
 * Content is live data: the parts, cars, platforms and sales are real, and
 * each section hides or shrinks when there isn't enough of it.
 */
export default async function LandingPage() {
  // Only signed-out visitors reach this page and it's the same for all of
  // them, so a one-minute cache serves it without asking the database on
  // every visit.
  const supabase = createPublicClient({ maxAge: 60, kinds: ["listings", "cars", "profiles", "engagement"] });
  const jar = await cookies();
  const night = jar.get("ls-theme")?.value === "night";

  const [
    { data: recentRows },
    { data: provenRows },
    { data: soldRows },
    { data: buildRows },
    { data: trendingRows },
    { count: liveListingCount },
    { count: publicCarCount },
    betaEnforced,
  ] = await Promise.all([
    supabase
      .from("listings")
      .select(LISTING_COLUMNS)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(8),
    // Parts that came off a car — the pairs section shows each with its car.
    supabase
      .from("listings")
      .select(LISTING_COLUMNS)
      .eq("status", "active")
      .not("source_car_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("listings")
      .select(LISTING_COLUMNS)
      .eq("status", "sold")
      .order("sold_at", { ascending: false, nullsFirst: false })
      .limit(3),
    supabase
      .from("cars")
      .select(CAR_COLUMNS)
      .eq("is_public", true)
      .not("cover_image_url", "is", null)
      .order("updated_at", { ascending: false })
      .limit(4),
    // The same ranking Explore's Trending chips use, cached for five minutes.
    createPublicClient({ maxAge: 300, tags: ["explore-trending"] }).rpc("trending_models", {
      p_days: 45,
      p_limit: 6,
    }),
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("cars").select("id", { count: "exact", head: true }).eq("is_public", true),
    betaAccessIsEnforced(),
  ]);

  // One hydration for every listing on the page: photo, seller, source car.
  const rowsById = new Map(
    [...(recentRows ?? []), ...(provenRows ?? []), ...(soldRows ?? [])].map((row) => [row.id, row]),
  );
  const cards = await hydrateListingCards(supabase, [...rowsById.values()]).catch(() => [] as ListingCardData[]);
  const cardById = new Map(cards.map((card) => [card.id, card]));

  const builds = (buildRows ?? []) as CarRow[];
  const trending = (trendingRows ?? []).slice(0, 6);
  const sourceCarIds = [...new Set((provenRows ?? []).map((row) => row.source_car_id).filter(Boolean))] as string[];
  const buildIds = builds.map((car) => car.id);
  const trendingModels = [...new Set(trending.map((p) => p.model))];

  // Second round: the source cars' photos, how many parts each shown car
  // has for sale, and a member's photo for each car tile. With no trending
  // models (a quiet 45 days), the tiles fall back to the cars that turn up
  // most among recent public cars, so the picker never stands alone.
  const [{ data: sourceCarRows }, { data: buildListingRows }, { data: platformCarRows }] = await Promise.all([
    sourceCarIds.length
      ? supabase.from("cars").select(CAR_COLUMNS).in("id", sourceCarIds).eq("is_public", true)
      : Promise.resolve({ data: [] as CarRow[] }),
    buildIds.length
      ? supabase.from("listings").select("source_car_id").eq("status", "active").in("source_car_id", buildIds).limit(200)
      : Promise.resolve({ data: [] as { source_car_id: string | null }[] }),
    trendingModels.length
      ? supabase
          .from("cars")
          .select(PLATFORM_COLUMNS)
          .eq("is_public", true)
          .not("cover_image_url", "is", null)
          .in("model", trendingModels)
          .order("updated_at", { ascending: false })
          .limit(60)
      : supabase
          .from("cars")
          .select(PLATFORM_COLUMNS)
          .eq("is_public", true)
          .not("cover_image_url", "is", null)
          .not("make", "is", null)
          .not("model", "is", null)
          .order("updated_at", { ascending: false })
          .limit(200),
  ]);

  const sourceCarById = new Map(((sourceCarRows ?? []) as CarRow[]).map((car) => [car.id, car]));
  const pairs = (provenRows ?? [])
    .map((row) => ({ card: cardById.get(row.id), car: row.source_car_id ? sourceCarById.get(row.source_car_id) : null }))
    .filter((pair): pair is { card: ListingCardData; car: CarRow } =>
      Boolean(pair.card?.cover_url && pair.car?.cover_image_url),
    )
    .slice(0, 3);

  // The strip under the hero: parts with a photo, the pairs' parts last so
  // the page doesn't show the same three twice when there are others.
  const pairIds = new Set(pairs.map((pair) => pair.card.id));
  const withPhoto = (recentRows ?? [])
    .map((row) => cardById.get(row.id))
    .filter((card): card is ListingCardData => Boolean(card?.cover_url));
  const floor = [...withPhoto.filter((c) => !pairIds.has(c.id)), ...withPhoto.filter((c) => pairIds.has(c.id))].slice(0, 4);

  const forSaleByCar = new Map<string, number>();
  for (const row of buildListingRows ?? []) {
    if (row.source_car_id) forSaleByCar.set(row.source_car_id, (forSaleByCar.get(row.source_car_id) ?? 0) + 1);
  }

  // Members type their make freely ("volkswagen", "Volkswagen"), so tiles
  // group case-insensitively and take their label from a capitalised entry.
  const platformKey = (make: string | null, model: string | null) =>
    `${(make ?? "").trim().toLowerCase()}|${(model ?? "").trim().toLowerCase()}`;
  const coverByPlatform = new Map<string, PlatformCarRow>();
  const labelByPlatform = new Map<string, PlatformCarRow>();
  const seenByPlatform = new Map<string, number>();
  for (const car of (platformCarRows ?? []) as PlatformCarRow[]) {
    const key = platformKey(car.make, car.model);
    // The newest car of the model gives the photo; a capitalised one the name.
    if (!coverByPlatform.has(key)) coverByPlatform.set(key, car);
    const named = labelByPlatform.get(key);
    if (!named || (!/^[A-Z0-9]/.test(named.make ?? "") && /^[A-Z0-9]/.test(car.make ?? ""))) labelByPlatform.set(key, car);
    seenByPlatform.set(key, (seenByPlatform.get(key) ?? 0) + 1);
  }
  const platforms: Platform[] = trending.length
    ? trending.map((p) => ({
        make: p.make,
        model: p.model,
        builds: Number(p.builds),
        makeId: p.catalog_make_id,
        modelId: p.catalog_model_id,
      }))
    : [...seenByPlatform.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([key]) => {
          const car = labelByPlatform.get(key)!;
          return { make: car.make!, model: car.model!, builds: null, makeId: car.catalog_make_id, modelId: car.catalog_model_id };
        });
  const platformTiles = platforms
    .map((p) => ({
      label: `${p.make} ${p.model}`,
      builds: p.builds,
      car: coverByPlatform.get(platformKey(p.make, p.model)) ?? null,
      // Exactly this make + model when the cars are matched to the catalog;
      // a text search otherwise (the same fallback Explore's chips use).
      href:
        p.makeId && p.modelId
          ? `/marketplace?vehicle=${p.makeId}-${p.modelId}`
          : `/marketplace?q=${encodeURIComponent(`${p.make} ${p.model}`)}`,
    }))
    .filter((tile) => tile.car);

  const sold = (soldRows ?? [])
    .map((row) => cardById.get(row.id))
    .filter((card): card is ListingCardData => Boolean(card));

  const liveCount = liveListingCount ?? 0;
  const carCount = publicCarCount ?? 0;
  const showNumbers = carCount >= NUMBERS_BAND_FLOOR && liveCount >= NUMBERS_BAND_FLOOR;

  return (
    <div className="min-h-screen">
      <LivesheetBar signedIn={false} initialNight={night} />

      <main className="wrap">
        {/* 1 — What is this? One plain line, one photograph. */}
        <PageHead
          className="pagehead--landing"
          eyebrow="Buy and sell parts off modified cars"
          title={
            <>
              The parts marketplace for modified <span className="live-word">cars.</span>
            </>
          }
          sub="Sell what comes off your car. Shop parts off cars like yours, each one shown with the car it came from."
        >
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href={`#${PICKER_ID}`} variant="live">
              Shop parts for my car
            </ButtonLink>
            <ButtonLink href={SELL_HREF}>Sell my parts</ButtonLink>
          </div>
        </PageHead>

        <section className="landing-hero" aria-label="Parts for sale now">
          <div className="landing-hero__photo">
            <Media
              src={HERO_SRC}
              alt="A modified red Mazda RX-7 in a garage, with the factory parts that came off it laid out on the floor in front"
              className="h-full w-full"
              role="hero"
            />
          </div>
          {floor.length >= 2 && (
            <div className="landing-floor">
              <span className="landing-floor__label">For sale now, off members’ cars</span>
              <ul className="landing-floor__list">
                {floor.map((card) => (
                  <li key={card.id}>
                    <Link href={`/listings/${card.id}`} className="landing-floor__item" prefetch={false}>
                      <span className="landing-floor__thumb">
                        <Media src={card.cover_url ?? undefined} alt="" className="h-full w-full" role="row" />
                      </span>
                      <span className="landing-floor__text">
                        <span className="landing-floor__price">{formatPrice(card.price_cents)}</span>
                        <span className="landing-floor__title">{card.title}</span>
                        {card.source_car_name && (
                          <span className="landing-floor__off">Off a {card.source_car_name}</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* 2 — What's in it for my car? Pick it, see its parts. */}
        <section className="deck landing-sec" id={PICKER_ID} aria-labelledby="landing-drive">
          <div className="landing-sec__head">
            <h2 id="landing-drive" className="landing-sec__title">What do you drive?</h2>
            <p className="landing-sec__sub">Pick your car and see parts that fit it or came off one like it.</p>
          </div>
          <form action="/marketplace" method="get" className="landing-picker">
            <VehicleFilterField initial={null} />
            <Button type="submit" variant="live">
              Show parts
            </Button>
          </form>
          {platformTiles.length >= 2 && (
            <ul className="landing-platforms" aria-label="Popular cars on DRVN">
              {platformTiles.map((tile, i) => (
                <Rv as="li" key={tile.label} stagger={i}>
                  <Link href={tile.href} className="landing-platform" prefetch={false}>
                    <Media
                      src={tile.car?.cover_image_url ?? undefined}
                      alt=""
                      className="h-full w-full"
                      role="card"
                      focal={tile.car ? { x: tile.car.cover_focal_x, y: tile.car.cover_focal_y } : null}
                    />
                    <span className="landing-platform__cap">
                      <span className="landing-platform__name">{tile.label}</span>
                      <span className="landing-platform__meta">
                        {tile.builds ? `${tile.builds} ${tile.builds === 1 ? "car" : "cars"} on DRVN · ` : ""}Shop parts →
                      </span>
                    </span>
                  </Link>
                </Rv>
              ))}
            </ul>
          )}
        </section>

        {/* 3 — The connection, both ways, in plain steps. */}
        <section className="deck landing-sec" aria-labelledby="landing-how">
          <div className="landing-sec__head">
            <h2 id="landing-how" className="landing-sec__title">Every upgrade leaves a part behind.</h2>
            <p className="landing-sec__sub">
              Modified cars keep changing. The part you took off is exactly what someone else’s car needs.
            </p>
          </div>
          <div className="landing-lanes">
            <Rv className="landing-lane" stagger={0}>
              <span className="microlabel">Selling</span>
              <h3 className="landing-lane__title">Turn what came off into money</h3>
              <ol className="landing-steps">
                <li><span>Fit the new part.</span></li>
                <li>
                  <span>
                    List the old one in a minute.{" "}
                    <Link href={ADD_CAR_HREF} className="landing-inline">Add your car</Link> once and every
                    part you sell carries it, so buyers see where it came from.
                  </span>
                </li>
                <li><span>People who follow your car see the part first.</span></li>
                <li><span>Get paid two days after it’s delivered. Free to list, 10% when it sells.</span></li>
              </ol>
              <ButtonLink href={SELL_HREF}>Sell my parts</ButtonLink>
            </Rv>
            <Rv className="landing-lane" stagger={1}>
              <span className="microlabel">Buying</span>
              <h3 className="landing-lane__title">Find parts off cars like yours</h3>
              <ol className="landing-steps">
                <li><span>Tell us what you drive.</span></li>
                <li><span>Browse parts that came off the same car, or one like it.</span></li>
                <li><span>See the car each part came off, and the person who fitted it.</span></li>
                <li>
                  <span>
                    Pay through DRVN. The seller isn’t paid until it arrives
                    {betaEnforced ? ". Buying opens to invited members during the beta." : ", and you don’t need an account to buy."}
                  </span>
                </li>
              </ol>
              <ButtonLink href="/marketplace">Shop parts</ButtonLink>
            </Rv>
          </div>
        </section>

        {/* 4 — Why here: every part comes with the car it came off. */}
        {pairs.length >= 2 && (
          <section className="deck landing-sec" aria-labelledby="landing-pairs">
            <div className="landing-sec__head">
              <h2 id="landing-pairs" className="landing-sec__title">Every part comes with its car.</h2>
              <p className="landing-sec__sub">
                See what it was fitted to, who fitted it and what else they’ve changed, before you buy.
              </p>
            </div>
            <ul className="landing-pairs">
              {pairs.map(({ card, car }, i) => (
                <Rv as="li" key={card.id} stagger={i}>
                  <Link href={`/listings/${card.id}`} className="landing-pair" prefetch={false}>
                    <span className="landing-pair__media">
                      <Media src={card.cover_url ?? undefined} alt={card.title} className="h-full w-full" role="card" />
                      <span className="landing-pair__car">
                        <Media
                          src={car.cover_image_url ?? undefined}
                          alt={`The ${vehicleLabel(car)} it came off`}
                          className="h-full w-full"
                          role="row"
                          focal={{ x: car.cover_focal_x, y: car.cover_focal_y }}
                        />
                      </span>
                    </span>
                    <span className="landing-pair__body">
                      <span className="landing-pair__price">{formatPrice(card.price_cents)}</span>
                      <span className="landing-pair__title">{card.title}</span>
                      <span className="landing-pair__off">Off a {vehicleLabel(car)}</span>
                    </span>
                  </Link>
                </Rv>
              ))}
            </ul>
          </section>
        )}

        {/* 5 — Why DRVN for car parts, and the trust floor in one line. */}
        <section className="deck landing-sec" aria-labelledby="landing-why">
          <div className="landing-sec__head">
            <h2 id="landing-why" className="landing-sec__title">Built for car parts, not everything.</h2>
          </div>
          <ul className="landing-whys">
            <li>
              <strong>Shop by your car</strong>
              <span>Filter everything by make and model.</span>
            </li>
            <li>
              <strong>See the car it came off</strong>
              <span>The car, the owner, and what else they’ve changed.</span>
            </li>
            <li>
              <strong>Paid only on delivery</strong>
              <span>The seller is paid after the part arrives, and you have {DISPUTE_WINDOW_DAYS} days to report a problem.</span>
            </li>
            <li>
              <strong>Buyers who know cars</strong>
              <span>Your listing reaches the people who follow your car.</span>
            </li>
          </ul>
          <p className="landing-trust">
            <span>Payments by Stripe</span>
            <span>Seller paid after delivery</span>
            <span>{DISPUTE_WINDOW_DAYS}-day problem window</span>
            <span>Condition recorded at sale</span>
            <Link href="/protection" className="jumplink">Buyer protection →</Link>
          </p>
        </section>

        {/* 6 — The community, as the cars behind the parts. */}
        {builds.length >= 2 && (
          <section className="deck landing-sec" aria-labelledby="landing-cars">
            <div className="landing-sec__head landing-sec__head--row">
              <div>
                <h2 id="landing-cars" className="landing-sec__title">Every seller has a car you can look at.</h2>
                <p className="landing-sec__sub">Show off yours, and follow the cars whose parts you want.</p>
              </div>
              <Link href="/explore" className="jumplink">See the cars →</Link>
            </div>
            <ul className="landing-builds">
              {builds.map((car, i) => {
                const forSale = forSaleByCar.get(car.id) ?? 0;
                const subline = vehicleSubline(car.name, car);
                return (
                  <Rv as="li" key={car.id} stagger={i}>
                    <Link href={`/cars/${car.slug}`} className="landing-build" prefetch={false}>
                      <span className="landing-build__media">
                        <Media
                          src={car.cover_image_url ?? undefined}
                          alt={car.name ?? vehicleLabel(car)}
                          className="h-full w-full"
                          role="card"
                          focal={{ x: car.cover_focal_x, y: car.cover_focal_y }}
                        />
                      </span>
                      <span className="landing-build__name">{car.name || vehicleLabel(car)}</span>
                      {subline && <span className="landing-build__sub">{subline}</span>}
                      {forSale > 0 && (
                        <span className="landing-build__sale">
                          {forSale} {forSale === 1 ? "part" : "parts"} for sale
                        </span>
                      )}
                    </Link>
                  </Rv>
                );
              })}
            </ul>
          </section>
        )}

        {/* DRVN in numbers — real counts only, once they read as a crowd. */}
        {showNumbers && (
          <section className="deck">
            <Rv className="band">
              <span className="microlabel">DRVN in numbers</span>
              <div className="band__stats">
                <div>
                  <p className="num-giant">{liveCount}</p>
                  <div className="bandrule" />
                  <span className="microlabel">Parts for sale right now</span>
                </div>
                <div>
                  <p className="num-giant">{carCount}</p>
                  <div className="bandrule" />
                  <span className="microlabel">Modified cars on DRVN</span>
                </div>
                <div>
                  <p className="num-giant">10%</p>
                  <div className="bandrule" />
                  <span className="microlabel">Seller fee when a part sells — free to list</span>
                </div>
              </div>
            </Rv>
          </section>
        )}

        {/* 7 — Proof that parts sell, then the same two doors. */}
        <section className="deck" aria-labelledby="landing-close">
          <Rv className="landing-close">
            <h2 id="landing-close" className="landing-sec__title">What’s on the shelf in your garage?</h2>
            {sold.length >= 3 ? (
              <ul className="landing-sold" aria-label="Recently sold on DRVN">
                {sold.map((card) => (
                  <li key={card.id} className="landing-sold__row">
                    <span className="landing-sold__flag">Sold</span>
                    <span className="landing-sold__what">
                      <Link href={`/listings/${card.id}`} prefetch={false}>{card.title}</Link>
                      {card.source_car_name && <span className="landing-sold__off">Off a {card.source_car_name}</span>}
                    </span>
                    <span className="landing-sold__price">{formatPrice(card.price_cents)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="landing-sec__sub">
                Old wheels, a stock exhaust, the seats you swapped out. Someone with the same car is looking for them.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={SELL_HREF} variant="live">
                Sell my parts
              </ButtonLink>
              <ButtonLink href={`#${PICKER_ID}`}>Shop parts for my car</ButtonLink>
            </div>
          </Rv>
        </section>

        <Foot
          left="DRVN — the parts marketplace for modified cars"
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

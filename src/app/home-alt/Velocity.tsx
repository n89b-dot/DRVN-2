"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { CountUp } from "@/components/CountUp";
import { Reveal } from "@/components/Reveal";
import {
  heroImage,
  initialBuilds,
  initialCars,
  initialListings,
  type Car,
  type Listing,
} from "@/lib/drvn-data";
import { cx, imageStyle, money } from "@/lib/format";
import { useFinePointer } from "@/lib/hooks/useFinePointer";
import { useKonamiCode } from "@/lib/hooks/useKonamiCode";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

/** Headline stats mirrored from the original hero, animated on scroll. */
const HERO_STATS: ReadonlyArray<{ value: number; suffix?: string; label: string }> = [
  { value: 4800, label: "listing saves tracked" },
  { value: 312, label: "linked build parts" },
  { value: 87, suffix: "%", label: "listings with source cars" },
  { value: 36, label: "platforms indexed" },
];

/** Steps for the "How it works" rail. */
const FLOW_STEPS: ReadonlyArray<{ step: string; title: string; text: string }> = [
  { step: "01", title: "Add a car profile", text: "Year, make, model, trim, platform, media, links, and build status." },
  { step: "02", title: "Document the build", text: "Modular snapshots, mod lists, timeline updates, and part references." },
  { step: "03", title: "List parts from the car", text: "Attach source-car context, condition, hardware, defects, and fitment." },
  { step: "04", title: "Save & follow intent", text: "Saves and follows plan future builds and power recommendations." },
];

/** Countdown frames for the launch-control easter egg. */
const LAUNCH_FRAMES = ["3", "2", "1", "GO"];
const LAUNCH_FRAME_MS = 650;

/**
 * "Velocity" — an alternate, motion-forward DRVN home page concept.
 *
 * Reuses the real product data (cars, builds, listings) and presents it with a
 * cinematic hero (reactive cursor spotlight + perspective track grid), a live
 * marketplace ticker, tilting car spotlights, scroll-reveal sections, and a
 * hidden "launch control" easter egg (Konami code). Pointer and motion
 * flourishes are suppressed for reduced-motion and touch users.
 */
export function Velocity() {
  const prefersReducedMotion = useReducedMotion();
  const hasFinePointer = useFinePointer();
  const rootRef = useRef<HTMLDivElement>(null);

  const [savedListingIds, setSavedListingIds] = useState<string[]>(["listing-apr-downpipe"]);
  const [launchFrameIndex, setLaunchFrameIndex] = useState<number | null>(null);
  const [hasLaunched, setHasLaunched] = useState(false);

  const flourishesEnabled = !prefersReducedMotion && hasFinePointer;

  // Reactive spotlight: publish cursor position as CSS variables on the root.
  useEffect(() => {
    if (!flourishesEnabled) return;
    const root = rootRef.current;
    if (!root) return;

    const handlePointerMove = (event: PointerEvent) => {
      root.style.setProperty("--vx", `${event.clientX}px`);
      root.style.setProperty("--vy", `${event.clientY}px`);
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [flourishesEnabled]);

  // A discoverable console breadcrumb toward the easter egg.
  useEffect(() => {
    console.log(
      "%cDRVN · Velocity%c — stage the launch with the Konami code: ↑ ↑ ↓ ↓ ← → ← → B A",
      "font-weight:700;color:rgb(59,113,254)",
      "color:rgb(119,126,144)",
    );
  }, []);

  const startLaunch = useCallback(() => {
    setLaunchFrameIndex((current) => (current === null ? 0 : current));
  }, []);

  useKonamiCode(startLaunch);

  // Advance the launch countdown frame-by-frame, then flash the redline.
  useEffect(() => {
    if (launchFrameIndex === null) return;

    if (launchFrameIndex >= LAUNCH_FRAMES.length) {
      const settle = window.setTimeout(() => {
        setLaunchFrameIndex(null);
        setHasLaunched(true);
      }, 0);
      return () => window.clearTimeout(settle);
    }

    const advance = window.setTimeout(
      () => setLaunchFrameIndex((current) => (current === null ? null : current + 1)),
      LAUNCH_FRAME_MS,
    );
    return () => window.clearTimeout(advance);
  }, [launchFrameIndex]);

  useEffect(() => {
    if (!hasLaunched) return;
    const reset = window.setTimeout(() => setHasLaunched(false), 900);
    return () => window.clearTimeout(reset);
  }, [hasLaunched]);

  const toggleSaved = (listingId: string) => {
    setSavedListingIds((current) =>
      current.includes(listingId)
        ? current.filter((id) => id !== listingId)
        : [...current, listingId],
    );
  };

  const featuredCar = initialCars[0];
  const platformForListing = (listing: Listing): string =>
    initialCars.find((car) => car.id === listing.linkedCarId)?.platform ?? "Universal";

  return (
    <div ref={rootRef} className="velocity relative min-h-screen overflow-hidden" data-launched={hasLaunched}>
      {flourishesEnabled && <div className="vel-spotlight" />}

      <div className="relative z-10">
        <ConceptNav />

        <main className="mx-auto max-w-[1440px] px-5 md:px-10 xl:px-20">
          <HeroSection
            featuredCar={featuredCar}
            tiltEnabled={flourishesEnabled}
          />

          <MarqueeTicker
            listings={initialListings}
            platformForListing={platformForListing}
          />

          <GarageSpotlight cars={initialCars} tiltEnabled={flourishesEnabled} />

          <ListingsSection
            listings={initialListings}
            savedListingIds={savedListingIds}
            onToggleSaved={toggleSaved}
            platformForListing={platformForListing}
          />

          <FlowSection />

          <ConceptFooter />
        </main>
      </div>

      {launchFrameIndex !== null && launchFrameIndex < LAUNCH_FRAMES.length && (
        <div className="vel-launch" role="status" aria-live="assertive">
          <div className="text-center">
            <p className="mb-4 text-sm font-bold uppercase tracking-[0.4em] text-[rgb(255,76,76)]">
              Launch control
            </p>
            <span
              key={launchFrameIndex}
              className="vel-launch-number block"
              style={{
                color: LAUNCH_FRAMES[launchFrameIndex] === "GO" ? "rgb(88,194,125)" : "rgb(252,252,253)",
              }}
            >
              {LAUNCH_FRAMES[launchFrameIndex]}
            </span>
          </div>
        </div>
      )}

      {hasLaunched && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-[rgb(255,76,76)] bg-black/80 px-6 py-3 text-sm font-bold tracking-wide text-white shadow-2xl">
          🏁 Dyno unlocked — 1,001 hp on tap (allegedly)
        </div>
      )}
    </div>
  );
}

/** Sticky concept-level navigation with links back to the app and sibling concept. */
function ConceptNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[rgba(12,13,15,0.7)] backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-5 md:px-10 xl:px-20">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-brand text-2xl font-bold tracking-[-0.06em] text-white">
            DRVN
          </Link>
          <span className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(177,181,195)]">
            Velocity concept
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Link
            href="/home-brutalist"
            className="hidden rounded-full px-4 py-2 text-[rgb(177,181,195)] transition hover:bg-white/10 hover:text-white sm:block"
          >
            Paddock →
          </Link>
          <Link
            href="/home-anthropic"
            className="hidden rounded-full px-4 py-2 text-[rgb(177,181,195)] transition hover:bg-white/10 hover:text-white sm:block"
          >
            Clay →
          </Link>
          <Link
            href="/"
            className="rounded-full bg-[rgb(59,113,254)] px-5 py-2 text-white transition hover:bg-blue-500"
          >
            Open the app
          </Link>
        </div>
      </div>
    </header>
  );
}

interface HeroSectionProps {
  featuredCar: Car;
  tiltEnabled: boolean;
}

function HeroSection({ featuredCar, tiltEnabled }: HeroSectionProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleTilt = (event: React.PointerEvent) => {
    if (!tiltEnabled) return;
    const card = cardRef.current;
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    const px = (event.clientX - bounds.left) / bounds.width - 0.5;
    const py = (event.clientY - bounds.top) / bounds.height - 0.5;
    card.style.transform = `perspective(900px) rotateY(${px * 10}deg) rotateX(${-py * 10}deg)`;
  };

  const resetTilt = () => {
    if (cardRef.current) cardRef.current.style.transform = "perspective(900px) rotateY(0) rotateX(0)";
  };

  return (
    <section className="relative grid items-center gap-10 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
      <div className="vel-grid" aria-hidden />
      <div className="relative">
        <Reveal className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-[0.3em] text-[rgb(88,194,125)]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[rgb(88,194,125)] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[rgb(88,194,125)]" />
          </span>
          Your car. Your build. Your parts.
        </Reveal>

        <Reveal as="h1" delay={80} className="vel-gradient-text font-display text-5xl font-bold leading-[0.95] tracking-[-0.05em] md:text-7xl xl:text-8xl">
          Create your car profile. Sell the parts behind your build.
        </Reveal>

        <Reveal delay={160} className="mt-6 max-w-xl text-lg leading-8 text-[rgb(230,232,236)]">
          DRVN connects polished car profiles, structured build documentation, and marketplace
          listings with real source-car and fitment context.
        </Reveal>

        <Reveal delay={240} className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex h-12 items-center justify-center rounded-full bg-[rgb(59,113,254)] px-7 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            Add your car
          </Link>
          <Link
            href="/"
            className="inline-flex h-12 items-center justify-center rounded-full border border-white/15 px-7 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Browse parts
          </Link>
        </Reveal>

        <Reveal delay={320} className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {HERO_STATS.map((stat) => (
            <div key={stat.label} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <CountUp
                value={stat.value}
                suffix={stat.suffix}
                className="font-display text-3xl font-bold text-white"
              />
              <div className="mt-1 text-xs leading-5 text-[rgb(119,126,144)]">{stat.label}</div>
            </div>
          ))}
        </Reveal>
      </div>

      <div className="relative">
        <div
          ref={cardRef}
          onPointerMove={handleTilt}
          onPointerLeave={resetTilt}
          className="vel-card relative overflow-hidden rounded-[32px] border border-white/12 bg-cover bg-center will-change-transform"
          style={{ ...imageStyle(heroImage), minHeight: "520px" }}
        >
          <div className="absolute inset-x-0 bottom-0 p-7">
            <span className="rounded-full bg-[rgb(59,113,254)] px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white">
              Featured build · {featuredCar.platform}
            </span>
            <h2 className="mt-4 font-display text-3xl font-bold tracking-[-0.03em] text-white">
              {featuredCar.name}
            </h2>
            <p className="mt-1 text-sm text-[rgb(230,232,236)]">
              {featuredCar.year} {featuredCar.make} {featuredCar.model} · {featuredCar.buildStatus}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {featuredCar.mods.slice(0, 3).map((mod) => (
                <span key={mod} className="rounded-full bg-white/10 px-3 py-1 text-xs text-[rgb(230,232,236)]">
                  {mod}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface MarqueeTickerProps {
  listings: Listing[];
  platformForListing: (listing: Listing) => string;
}

function MarqueeTicker({ listings, platformForListing }: MarqueeTickerProps) {
  const items = [...listings, ...listings];
  return (
    <section className="relative -mx-5 my-4 overflow-hidden border-y border-white/10 py-4 md:-mx-10 xl:-mx-20">
      <div className="vel-marquee-track">
        {items.map((listing, index) => (
          <span key={`${listing.id}-${index}`} className="mx-5 inline-flex items-center gap-3 text-sm font-semibold text-[rgb(177,181,195)]">
            <span className="text-white">{listing.brand} {listing.product}</span>
            <span className="text-[rgb(88,194,125)]">{money.format(listing.price)}</span>
            <span className="rounded-full bg-white/7 px-2 py-0.5 text-xs text-[rgb(119,126,144)]">
              {platformForListing(listing)}
            </span>
            <span className="text-[rgb(59,113,254)]">/</span>
          </span>
        ))}
      </div>
    </section>
  );
}

interface GarageSpotlightProps {
  cars: Car[];
  tiltEnabled: boolean;
}

function GarageSpotlight({ cars, tiltEnabled }: GarageSpotlightProps) {
  return (
    <section className="py-16">
      <Reveal className="mb-10 flex items-end justify-between gap-4">
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.28em] text-[rgb(88,194,125)]">
            Featured garages
          </p>
          <h2 className="font-display text-3xl font-bold tracking-[-0.03em] text-white md:text-5xl">
            Cars are first-class objects
          </h2>
        </div>
        <Link href="/" className="hidden text-sm font-semibold text-[rgb(177,181,195)] hover:text-white sm:block">
          View all garages →
        </Link>
      </Reveal>

      <div className="grid gap-5 lg:grid-cols-3">
        {cars.map((car, index) => (
          <Reveal key={car.id} delay={index * 90}>
            <TiltCarCard car={car} tiltEnabled={tiltEnabled} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function TiltCarCard({ car, tiltEnabled }: { car: Car; tiltEnabled: boolean }) {
  const cardRef = useRef<HTMLElement>(null);

  const handleTilt = (event: React.PointerEvent) => {
    if (!tiltEnabled) return;
    const card = cardRef.current;
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    const px = (event.clientX - bounds.left) / bounds.width - 0.5;
    const py = (event.clientY - bounds.top) / bounds.height - 0.5;
    card.style.transform = `perspective(900px) translateY(-6px) rotateY(${px * 7}deg) rotateX(${-py * 7}deg)`;
  };

  const resetTilt = () => {
    if (cardRef.current) cardRef.current.style.transform = "";
  };

  return (
    <article
      ref={cardRef}
      onPointerMove={handleTilt}
      onPointerLeave={resetTilt}
      className="vel-card group overflow-hidden rounded-3xl border border-white/10 bg-[rgb(20,22,26)] will-change-transform"
    >
      <div
        className="image-sheen relative h-64 w-full overflow-hidden bg-cover bg-center"
        style={imageStyle(car.image)}
      >
        <span className="absolute left-4 top-4 rounded-full bg-black/55 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white">
          {car.platform}
        </span>
        <div className="absolute bottom-4 left-4 right-4">
          <h3 className="text-2xl font-bold tracking-[-0.03em] text-white">{car.name}</h3>
          <p className="text-sm text-[rgb(230,232,236)]">
            {car.year} {car.make} {car.model} {car.trim}
          </p>
        </div>
      </div>
      <div className="p-5">
        <p className="text-sm leading-6 text-[rgb(177,181,195)]">{car.description}</p>
        <div className="mt-5 flex items-center justify-between text-sm">
          <span className="text-[rgb(119,126,144)]">{car.followers.toLocaleString()} followers</span>
          <span className="font-semibold text-[rgb(88,194,125)]">{car.mods.length} mods logged</span>
        </div>
      </div>
    </article>
  );
}

interface ListingsSectionProps {
  listings: Listing[];
  savedListingIds: string[];
  onToggleSaved: (listingId: string) => void;
  platformForListing: (listing: Listing) => string;
}

function ListingsSection({ listings, savedListingIds, onToggleSaved, platformForListing }: ListingsSectionProps) {
  return (
    <section className="py-16">
      <Reveal className="mb-10">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.28em] text-[rgb(88,194,125)]">
          Marketplace context
        </p>
        <h2 className="font-display text-3xl font-bold tracking-[-0.03em] text-white md:text-5xl">
          Parts connected to real cars
        </h2>
      </Reveal>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {listings.map((listing, index) => {
          const isSaved = savedListingIds.includes(listing.id);
          return (
            <Reveal key={listing.id} as="article" delay={index * 70} className="vel-card overflow-hidden rounded-3xl border border-white/10 bg-[rgb(20,22,26)]">
              <div
                className="image-sheen relative h-44 w-full overflow-hidden bg-cover bg-center"
                style={imageStyle(listing.image)}
              >
                <span className="absolute left-4 top-4 rounded-full bg-black/55 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-white">
                  {listing.status}
                </span>
                <span className="absolute bottom-4 left-4 rounded-full bg-[rgb(59,113,254)] px-3 py-1 text-sm font-bold text-white">
                  {money.format(listing.price)}
                </span>
              </div>
              <div className="p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-white/7 px-3 py-1 text-xs font-semibold text-[rgb(177,181,195)]">
                    {listing.category}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleSaved(listing.id)}
                    className={cx(
                      "rounded-full px-3 py-1 text-xs font-bold transition",
                      isSaved ? "bg-[rgb(88,194,125)] text-[rgb(12,13,15)]" : "bg-white/7 text-white hover:bg-white/15",
                    )}
                  >
                    {isSaved ? "Saved" : "Save"}
                  </button>
                </div>
                <h3 className="text-base font-bold leading-snug tracking-[-0.01em] text-white">
                  {listing.title}
                </h3>
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[0.65rem] uppercase tracking-[0.18em] text-[rgb(119,126,144)]">Source car</p>
                  <p className="mt-1 text-sm font-semibold text-white">{platformForListing(listing)} · {listing.condition}</p>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

function FlowSection() {
  return (
    <section className="rounded-[32px] border border-white/10 bg-white/[0.02] p-6 md:p-10">
      <Reveal className="mb-8">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.28em] text-[rgb(88,194,125)]">How it works</p>
        <h2 className="font-display text-3xl font-bold tracking-[-0.03em] text-white md:text-4xl">
          Create. Document. List. Discover.
        </h2>
      </Reveal>
      <div className="grid gap-4 md:grid-cols-4">
        {FLOW_STEPS.map((flow, index) => (
          <Reveal key={flow.step} delay={index * 90} className="rounded-3xl border border-white/10 bg-black/20 p-5">
            <span className="font-display text-3xl font-bold text-[rgb(59,113,254)]">{flow.step}</span>
            <h3 className="mt-4 text-xl font-bold text-white">{flow.title}</h3>
            <p className="mt-2 text-sm leading-6 text-[rgb(177,181,195)]">{flow.text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function ConceptFooter() {
  const buildCount = initialBuilds.length;
  return (
    <footer className="flex flex-col items-center justify-between gap-4 py-12 text-sm text-[rgb(119,126,144)] sm:flex-row">
      <span className="font-brand text-lg font-bold tracking-[-0.04em] text-white">DRVN</span>
      <span>
        Velocity concept · {buildCount} documented builds · psst, try the Konami code 🏁
      </span>
    </footer>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Reveal } from "@/components/Reveal";
import {
  initialBuilds,
  initialCars,
  initialListings,
  type Car,
  type Listing,
} from "@/lib/drvn-data";
import { money } from "@/lib/format";
import { useFinePointer } from "@/lib/hooks/useFinePointer";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

/** Words scrolled in the brutalist marquee band. */
const MARQUEE_WORDS = [
  "CAR PROFILES",
  "BUILD LOGS",
  "FITMENT DATA",
  "SOURCE-CAR CONTEXT",
  "PART MARKETPLACE",
  "GARAGE",
];

/** Steps for the numbered "How it works" blocks. */
const FLOW_STEPS: ReadonlyArray<{ step: string; title: string; text: string }> = [
  { step: "1", title: "Add a car", text: "Year, make, model, trim, platform, media, and build status." },
  { step: "2", title: "Document the build", text: "Mod lists, timeline updates, and part references." },
  { step: "3", title: "List the parts", text: "Source-car context, condition, hardware, and fitment." },
  { step: "4", title: "Save & follow", text: "Plan the next stage and surface recommendations." },
];

/** Clicks on the wordmark needed to trigger the scramble easter egg. */
const SCRAMBLE_CLICK_THRESHOLD = 5;
const TOAST_VISIBLE_MS = 2600;

/**
 * "Paddock" — a neo-brutalist alternate DRVN home page concept.
 *
 * Deliberately avoids glassmorphism: warm paper background, thick black
 * borders, solid offset shadows, oversized type, and rotated stickers. Reuses
 * the real product data. Interactions include a blend-inverted square cursor,
 * press-physics blocks, scroll reveals, and a hidden "scramble" easter egg
 * (click the DRVN wordmark five times) that tilts every block and recolors the
 * accent. Pointer/motion flourishes are suppressed for reduced-motion and touch.
 */
export function Paddock() {
  const prefersReducedMotion = useReducedMotion();
  const hasFinePointer = useFinePointer();
  const rootRef = useRef<HTMLDivElement>(null);

  const [savedListingIds, setSavedListingIds] = useState<string[]>(["listing-titan7"]);
  const [, setLogoClicks] = useState(0);
  const [isScrambled, setIsScrambled] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const flourishesEnabled = !prefersReducedMotion && hasFinePointer;

  // Apply / clear per-block random rotations when scramble toggles, so the
  // effect looks genuinely chaotic rather than a uniform page tilt.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const blocks = root.querySelectorAll<HTMLElement>(".pad-block");

    if (isScrambled && !prefersReducedMotion) {
      blocks.forEach((block) => {
        const angle = (Math.random() * 6 - 3).toFixed(2);
        block.style.transform = `rotate(${angle}deg)`;
      });
      root.style.setProperty("--pad-accent", "rgb(255, 90, 43)");
    } else {
      blocks.forEach((block) => {
        block.style.transform = "";
      });
      root.style.removeProperty("--pad-accent");
    }
  }, [isScrambled, prefersReducedMotion]);

  // Auto-dismiss the toast after a readable window.
  useEffect(() => {
    if (!showToast) return;
    const timer = window.setTimeout(() => setShowToast(false), TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [showToast]);

  useEffect(() => {
    console.log(
      "%cDRVN · Paddock%c — click the DRVN wordmark five times to scramble the paddock.",
      "font-weight:700;color:#131214;background:#28a75f;padding:2px 6px",
      "color:#777e90",
    );
  }, []);

  const handleLogoClick = useCallback(() => {
    setLogoClicks((current) => {
      const next = current + 1;
      if (next >= SCRAMBLE_CLICK_THRESHOLD) {
        setIsScrambled((scrambled) => !scrambled);
        setShowToast(true);
        return 0;
      }
      return next;
    });
  }, []);

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
    <div ref={rootRef} className="paddock relative min-h-screen overflow-hidden" data-scramble={isScrambled}>
      <div className="pad-grain" aria-hidden />
      {flourishesEnabled && <PadCursor />}

      <div className="relative z-10">
        <ConceptNav onLogoClick={handleLogoClick} />

        <main className="mx-auto max-w-[1400px] px-5 md:px-10 xl:px-16">
          <HeroSection featuredCar={featuredCar} />
          <MarqueeBand />
          <GarageSection cars={initialCars} />
          <ListingsSection
            listings={initialListings}
            savedListingIds={savedListingIds}
            onToggleSaved={toggleSaved}
            platformForListing={platformForListing}
          />
          <FlowSection />
          <ConceptFooter buildCount={initialBuilds.length} />
        </main>
      </div>

      {showToast && (
        <div
          className="pad-sticker fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 px-6 py-3 text-sm font-extrabold uppercase tracking-wide"
          role="status"
        >
          {isScrambled ? "🌀 Paddock scrambled" : "Order restored"}
        </div>
      )}
    </div>
  );
}

/** A chunky, blend-inverted square cursor that rounds out over interactive targets. */
function PadCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let currentX = targetX;
    let currentY = targetY;
    let frame = 0;

    const handlePointerMove = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      const target = event.target as Element | null;
      cursor.dataset.active = String(Boolean(target?.closest("a, button")));
    };

    const render = () => {
      currentX += (targetX - currentX) * 0.24;
      currentY += (targetY - currentY) * 0.24;
      cursor.style.transform = `translate(${currentX}px, ${currentY}px) translate(-50%, -50%)`;
      frame = requestAnimationFrame(render);
    };

    window.addEventListener("pointermove", handlePointerMove);
    frame = requestAnimationFrame(render);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={cursorRef} className="pad-cursor" aria-hidden />;
}

function ConceptNav({ onLogoClick }: { onLogoClick: () => void }) {
  return (
    <header className="border-b-[3px] border-[var(--pad-ink)]">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-10 xl:px-16">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onLogoClick}
            className="pad-block px-4 py-2 font-brand text-2xl font-extrabold tracking-[-0.06em]"
          >
            DRVN
          </button>
          <span className="pad-sticker px-3 py-1 text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--pad-ink)]">
            Paddock concept
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/home-alt" className="pad-btn pad-btn--ghost hidden px-4 py-2 text-sm sm:inline-flex">
            Velocity →
          </Link>
          <Link href="/home-anthropic" className="pad-btn pad-btn--ghost hidden px-4 py-2 text-sm sm:inline-flex">
            Clay →
          </Link>
          <Link href="/" className="pad-btn px-5 py-2 text-sm">
            Open the app
          </Link>
        </div>
      </div>
    </header>
  );
}

function HeroSection({ featuredCar }: { featuredCar: Car }) {
  return (
    <section className="grid items-stretch gap-8 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:py-16">
      <div className="flex flex-col justify-center">
        <Reveal as="p" className="mb-6 inline-block w-fit bg-[var(--pad-ink)] px-3 py-1 text-xs font-extrabold uppercase tracking-[0.3em] text-[var(--pad-paper)]">
          Your car. Your build. Your parts.
        </Reveal>
        <Reveal as="h1" delay={60} className="font-display text-[clamp(2.75rem,8vw,6rem)] font-extrabold uppercase leading-[0.9] tracking-[-0.04em]">
          Create your car profile.
          <br />
          <span className="text-[var(--pad-accent)]">Sell the parts</span> behind it.
        </Reveal>
        <Reveal delay={140} className="mt-6 max-w-xl text-lg font-medium leading-7">
          DRVN pairs polished car profiles and build logs with a parts marketplace that always
          carries source-car and fitment context.
        </Reveal>
        <Reveal delay={220} className="mt-8 flex flex-wrap gap-4">
          <Link href="/" className="pad-btn px-7 py-4 text-sm uppercase">
            Add your car
          </Link>
          <Link href="/" className="pad-btn pad-btn--ghost px-7 py-4 text-sm uppercase">
            Browse parts
          </Link>
        </Reveal>
        <Reveal delay={300} className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ["4.8k", "saves"],
            ["312", "linked parts"],
            ["87%", "with cars"],
            ["36", "platforms"],
          ].map(([value, label]) => (
            <div key={label} className="pad-block p-4">
              <div className="font-display text-2xl font-extrabold">{value}</div>
              <div className="mt-1 text-xs font-bold uppercase tracking-[0.12em]">{label}</div>
            </div>
          ))}
        </Reveal>
      </div>

      <Reveal delay={120} className="relative">
        <div className="pad-block h-full min-h-[420px] overflow-hidden p-0">
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${featuredCar.image})`, minHeight: "420px" }}
          />
        </div>
        <div className="pad-block absolute bottom-5 left-5 right-5 bg-[var(--pad-paper)] p-5">
          <span className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--pad-accent)]">
            Featured · {featuredCar.platform}
          </span>
          <h2 className="mt-2 font-display text-2xl font-extrabold uppercase tracking-[-0.02em]">
            {featuredCar.name}
          </h2>
          <p className="text-sm font-semibold">
            {featuredCar.year} {featuredCar.make} {featuredCar.model} · {featuredCar.buildStatus}
          </p>
        </div>
      </Reveal>
    </section>
  );
}

function MarqueeBand() {
  const words = [...MARQUEE_WORDS, ...MARQUEE_WORDS];
  return (
    <section className="-mx-5 overflow-hidden border-y-[3px] border-[var(--pad-ink)] bg-[var(--pad-ink)] py-4 md:-mx-10 xl:-mx-16">
      <div className="pad-marquee-track">
        {words.map((word, index) => (
          <span key={`${word}-${index}`} className="mx-5 text-2xl font-extrabold uppercase tracking-[-0.01em] text-[var(--pad-paper)] sm:text-3xl">
            {word}
            <span className="mx-5 text-[var(--pad-success)]">●</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function GarageSection({ cars }: { cars: Car[] }) {
  return (
    <section className="py-16">
      <Reveal className="mb-8">
        <h2 className="font-display text-3xl font-extrabold uppercase tracking-[-0.03em] md:text-5xl">
          Featured garages
        </h2>
      </Reveal>
      <div className="grid gap-6 lg:grid-cols-3">
        {cars.map((car, index) => (
          <Reveal key={car.id} as="article" delay={index * 90} className="pad-block overflow-hidden">
            <div className="h-56 w-full bg-cover bg-center" style={{ backgroundImage: `url(${car.image})` }} />
            <div className="border-t-[3px] border-[var(--pad-ink)] p-5">
              <span className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--pad-accent)]">
                {car.platform}
              </span>
              <h3 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-[-0.02em]">{car.name}</h3>
              <p className="mt-2 text-sm font-medium leading-6">{car.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {car.mods.slice(0, 3).map((mod) => (
                  <span key={mod} className="border-2 border-[var(--pad-ink)] px-2 py-1 text-xs font-bold">
                    {mod}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
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
      <Reveal className="mb-8">
        <h2 className="font-display text-3xl font-extrabold uppercase tracking-[-0.03em] md:text-5xl">
          Parts with context
        </h2>
      </Reveal>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {listings.map((listing, index) => {
          const isSaved = savedListingIds.includes(listing.id);
          return (
            <Reveal key={listing.id} as="article" delay={index * 70} className="pad-block flex flex-col overflow-hidden">
              <div className="relative h-40 w-full bg-cover bg-center" style={{ backgroundImage: `url(${listing.image})` }}>
                <span className="absolute bottom-0 left-0 bg-[var(--pad-accent)] px-3 py-1 text-sm font-extrabold text-white">
                  {money.format(listing.price)}
                </span>
              </div>
              <div className="flex flex-1 flex-col border-t-[3px] border-[var(--pad-ink)] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-[0.12em]">{listing.category}</span>
                  <button
                    type="button"
                    onClick={() => onToggleSaved(listing.id)}
                    className={
                      isSaved
                        ? "border-2 border-[var(--pad-ink)] bg-[var(--pad-success)] px-2 py-1 text-xs font-extrabold text-white"
                        : "border-2 border-[var(--pad-ink)] px-2 py-1 text-xs font-extrabold"
                    }
                  >
                    {isSaved ? "Saved" : "Save"}
                  </button>
                </div>
                <h3 className="text-sm font-extrabold leading-snug">{listing.title}</h3>
                <p className="mt-auto pt-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--pad-ink)]/70">
                  {platformForListing(listing)} · {listing.condition}
                </p>
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
    <section className="py-16">
      <Reveal className="mb-8">
        <h2 className="font-display text-3xl font-extrabold uppercase tracking-[-0.03em] md:text-5xl">
          Create. Document. List. Discover.
        </h2>
      </Reveal>
      <div className="grid gap-6 md:grid-cols-4">
        {FLOW_STEPS.map((flow, index) => (
          <Reveal key={flow.step} delay={index * 80} className="pad-block p-5">
            <span className="inline-grid h-12 w-12 place-items-center border-[3px] border-[var(--pad-ink)] bg-[var(--pad-accent)] font-display text-xl font-extrabold text-white">
              {flow.step}
            </span>
            <h3 className="mt-5 font-display text-xl font-extrabold uppercase tracking-[-0.02em]">{flow.title}</h3>
            <p className="mt-2 text-sm font-medium leading-6">{flow.text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function ConceptFooter({ buildCount }: { buildCount: number }) {
  return (
    <footer className="flex flex-col items-center justify-between gap-4 border-t-[3px] border-[var(--pad-ink)] py-10 text-sm font-bold sm:flex-row">
      <span className="font-brand text-xl font-extrabold tracking-[-0.04em]">DRVN</span>
      <span className="uppercase tracking-[0.12em]">
        Paddock concept · {buildCount} builds · click the wordmark 5× 🌀
      </span>
    </footer>
  );
}

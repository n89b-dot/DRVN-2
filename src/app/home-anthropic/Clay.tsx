"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Reveal } from "@/components/Reveal";
import {
  initialBuilds,
  initialCars,
  initialListings,
  type Car,
  type Listing,
} from "@/lib/drvn-data";
import { money } from "@/lib/format";

/**
 * Anthropic's "dormant" accent palette. The concept uses clay by default and
 * cycles through the rest as a calm, on-brand easter egg.
 */
const ACCENT_PALETTE: ReadonlyArray<{ name: string; value: string; deep: string }> = [
  { name: "Clay", value: "#cc785c", deep: "#b0573c" },
  { name: "Fig", value: "#c46686", deep: "#a14c6b" },
  { name: "Olive", value: "#788c5d", deep: "#5f7049" },
  { name: "Sky", value: "#6a9bcc", deep: "#4f7fad" },
  { name: "Deep coral", value: "#c6613f", deep: "#a44d30" },
];

/** Numbered editorial steps for the "How it works" rail. */
const FLOW_STEPS: ReadonlyArray<{ step: string; title: string; text: string }> = [
  { step: "01", title: "Add a car profile", text: "Capture year, make, model, trim, platform, media, links, and build status." },
  { step: "02", title: "Document the build", text: "Use modular snapshots, mod lists, timeline updates, and part references." },
  { step: "03", title: "List parts from the car", text: "Attach source-car context, condition, hardware, defects, and fitment." },
  { step: "04", title: "Save and follow intent", text: "Plan future builds and let saves power compatibility recommendations." },
];

const TOAST_VISIBLE_MS = 2200;

interface ClayProps {
  /** Combined next/font CSS-variable classes (serif + mono) for the root. */
  fontClassName: string;
}

/**
 * "Clay" — a DRVN home-page concept rendered in Anthropic's design language.
 *
 * Warm ivory canvas, a single clay/coral accent, editorial serif headlines,
 * mono eyebrows, generous whitespace, the radial-spike mark, and an alternating
 * cream → dark-navy surface rhythm. Motion is intentionally calm (gentle scroll
 * reveals + one slow background glow). Reuses the real DRVN product data.
 *
 * Easter egg: clicking the radial-spike mark cycles the accent through
 * Anthropic's dormant palette (Clay → Fig → Olive → Sky → Deep coral).
 */
export function Clay({ fontClassName }: ClayProps) {
  const [accentIndex, setAccentIndex] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);

  const accent = ACCENT_PALETTE[accentIndex];

  useEffect(() => {
    console.log(
      "%c✳ DRVN · Clay%c — click the spike mark to cycle Anthropic's accent palette.",
      "font-weight:700;color:#cc785c",
      "color:#6c6a64",
    );
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const cycleAccent = useCallback(() => {
    setAccentIndex((current) => {
      const next = (current + 1) % ACCENT_PALETTE.length;
      setToast(`Accent · ${ACCENT_PALETTE[next].name}`);
      return next;
    });
  }, []);

  const handleSubscribe = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubscribed(true);
  };

  const featuredCar = initialCars[0];
  const featuredListing = initialListings[0];
  const platformForListing = (listing: Listing): string =>
    initialCars.find((car) => car.id === listing.linkedCarId)?.platform ?? "Universal";

  return (
    <div
      className={`anthropic relative min-h-screen ${fontClassName}`}
      style={
        {
          "--ant-clay": accent.value,
          "--ant-clay-deep": accent.deep,
        } as React.CSSProperties
      }
    >
      <ConceptNav onMarkClick={cycleAccent} />

      <main>
        {/* ---------------------------------------------------------- Hero */}
        <section className="relative overflow-hidden">
          <div className="ant-glow" aria-hidden />
          <div className="relative mx-auto grid max-w-[1180px] items-center gap-12 px-6 py-20 md:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
            <div>
              <Reveal as="p" className="ant-mono mb-6 text-xs uppercase tracking-[0.22em] text-[var(--ant-muted)]">
                DRVN — build-aware marketplace
              </Reveal>
              <Reveal
                as="h1"
                delay={60}
                className="ant-serif text-[clamp(2.6rem,6vw,5rem)] font-normal leading-[1.02] text-[var(--ant-ink)]"
              >
                Create your car profile. Sell the parts behind your build.
              </Reveal>
              <Reveal delay={140} className="mt-7 max-w-xl text-lg leading-8 text-[var(--ant-body)]">
                DRVN pairs polished car profiles and structured build documentation with a marketplace
                where every listing carries real source-car and fitment context.
              </Reveal>
              <Reveal delay={220} className="mt-9 flex flex-wrap items-center gap-3">
                <Link href="/" className="ant-btn px-6 py-3 text-sm">
                  Add your car
                </Link>
                <Link href="/" className="ant-btn ant-btn--ghost px-6 py-3 text-sm">
                  Browse parts
                  <span aria-hidden>→</span>
                </Link>
              </Reveal>
            </div>

            <Reveal delay={120} className="ant-card overflow-hidden p-3">
              <div
                className="h-72 w-full rounded-[14px] bg-cover bg-center"
                style={{ backgroundImage: `url(${featuredCar.image})` }}
              />
              <div className="px-3 pb-2 pt-5">
                <p className="ant-mono text-xs uppercase tracking-[0.18em] text-[var(--ant-clay)]">
                  Featured build · {featuredCar.platform}
                </p>
                <h2 className="ant-serif mt-2 text-2xl text-[var(--ant-ink)]">{featuredCar.name}</h2>
                <p className="mt-1 text-sm text-[var(--ant-muted)]">
                  {featuredCar.year} {featuredCar.make} {featuredCar.model} · {featuredCar.buildStatus}
                </p>
              </div>
            </Reveal>
          </div>

          {/* Calm stat strip */}
          <div className="mx-auto max-w-[1180px] border-t border-[var(--ant-line)] px-6 md:px-10">
            <div className="grid grid-cols-2 gap-8 py-10 sm:grid-cols-4">
              {[
                ["4.8k", "listing saves tracked"],
                ["312", "linked build parts"],
                ["87%", "listings with source cars"],
                ["36", "platforms indexed"],
              ].map(([value, label]) => (
                <Reveal key={label}>
                  <div className="ant-serif text-4xl text-[var(--ant-ink)]">{value}</div>
                  <div className="ant-mono mt-2 text-[0.7rem] uppercase tracking-[0.14em] text-[var(--ant-muted)]">
                    {label}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------------------------------- Clay callout band */}
        <section className="ant-callout">
          <div className="mx-auto flex max-w-[1180px] flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between md:px-10">
            <Reveal as="h2" className="ant-serif max-w-2xl text-[clamp(1.8rem,4vw,3rem)] leading-[1.08]">
              Every part remembers the car it came from.
            </Reveal>
            <Reveal delay={120}>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[var(--ant-ink)] transition hover:bg-[var(--ant-cream)]"
              >
                See how listings link <span aria-hidden>→</span>
              </Link>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------ Featured garages */}
        <section className="mx-auto max-w-[1180px] px-6 py-20 md:px-10">
          <Reveal className="mb-12 max-w-2xl">
            <p className="ant-mono mb-4 text-xs uppercase tracking-[0.2em] text-[var(--ant-clay)]">
              Featured garages
            </p>
            <h2 className="ant-serif text-[clamp(1.9rem,4vw,3rem)] leading-[1.05] text-[var(--ant-ink)]">
              Cars are first-class objects
            </h2>
            <p className="mt-4 text-lg leading-8 text-[var(--ant-body)]">
              Profiles carry metadata, galleries, build summaries, links, and the listings that came
              off each car.
            </p>
          </Reveal>

          <div className="grid gap-6 md:grid-cols-3">
            {initialCars.map((car, index) => (
              <Reveal key={car.id} delay={index * 90}>
                <GarageCard car={car} />
              </Reveal>
            ))}
          </div>
        </section>

        {/* --------------------------------- Dark "product" surface (listings) */}
        <section className="ant-dark">
          <div className="mx-auto max-w-[1180px] px-6 py-20 md:px-10">
            <Reveal className="mb-12 max-w-2xl">
              <p className="ant-mono mb-4 text-xs uppercase tracking-[0.2em]" style={{ color: "var(--ant-clay)" }}>
                Marketplace context
              </p>
              <h2 className="ant-serif text-[clamp(1.9rem,4vw,3rem)] leading-[1.05] text-[var(--ant-canvas)]">
                Parts, connected to real builds
              </h2>
            </Reveal>

            <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
              <Reveal className="overflow-hidden rounded-[22px] border border-white/10 bg-[var(--ant-dark-2)] p-3">
                <div
                  className="h-64 w-full rounded-[14px] bg-cover bg-center"
                  style={{ backgroundImage: `url(${featuredListing.image})` }}
                />
                <div className="px-3 pb-2 pt-5">
                  <div className="flex items-center justify-between">
                    <span className="ant-mono text-xs uppercase tracking-[0.16em] text-[var(--ant-faint)]">
                      {featuredListing.category}
                    </span>
                    <span className="ant-serif text-xl text-[var(--ant-canvas)]">
                      {money.format(featuredListing.price)}
                    </span>
                  </div>
                  <h3 className="ant-serif mt-3 text-2xl text-[var(--ant-canvas)]">{featuredListing.title}</h3>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {featuredListing.compatibility.slice(0, 4).map((tag) => (
                      <span key={tag} className="rounded-full border border-white/15 px-3 py-1 text-xs text-[var(--ant-canvas)]/80">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>

              <div className="grid gap-4">
                {initialListings.slice(1).map((listing, index) => (
                  <Reveal
                    key={listing.id}
                    delay={index * 80}
                    className="flex items-center gap-5 rounded-[18px] border border-white/10 bg-[var(--ant-dark-2)] p-4"
                  >
                    <div
                      className="h-20 w-24 flex-shrink-0 rounded-[10px] bg-cover bg-center"
                      style={{ backgroundImage: `url(${listing.image})` }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="ant-mono text-[0.65rem] uppercase tracking-[0.16em] text-[var(--ant-faint)]">
                        {platformForListing(listing)} · {listing.condition}
                      </p>
                      <h4 className="ant-serif mt-1 truncate text-lg text-[var(--ant-canvas)]">{listing.title}</h4>
                    </div>
                    <span className="ant-serif text-lg text-[var(--ant-canvas)]">{money.format(listing.price)}</span>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- How it works */}
        <section className="mx-auto max-w-[1180px] px-6 py-20 md:px-10">
          <Reveal className="mb-12 max-w-2xl">
            <p className="ant-mono mb-4 text-xs uppercase tracking-[0.2em] text-[var(--ant-clay)]">
              How it works
            </p>
            <h2 className="ant-serif text-[clamp(1.9rem,4vw,3rem)] leading-[1.05] text-[var(--ant-ink)]">
              Create. Document. List. Discover.
            </h2>
          </Reveal>

          <div className="divide-y divide-[var(--ant-line)] border-y border-[var(--ant-line)]">
            {FLOW_STEPS.map((flow, index) => (
              <Reveal
                key={flow.step}
                delay={index * 70}
                className="grid grid-cols-[auto_1fr] items-baseline gap-6 py-8 md:grid-cols-[auto_1fr_2fr] md:gap-12"
              >
                <span className="ant-serif text-2xl text-[var(--ant-clay)]">{flow.step}</span>
                <h3 className="ant-serif text-xl text-[var(--ant-ink)] md:text-2xl">{flow.title}</h3>
                <p className="col-span-2 text-base leading-7 text-[var(--ant-body)] md:col-span-1">{flow.text}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------- Subscribe / CTA */}
        <section className="mx-auto max-w-[1180px] px-6 pb-24 md:px-10">
          <div className="ant-card flex flex-col items-start gap-8 p-8 md:flex-row md:items-center md:justify-between md:p-12">
            <div className="max-w-md">
              <h2 className="ant-serif text-[clamp(1.6rem,3vw,2.4rem)] leading-[1.1] text-[var(--ant-ink)]">
                Get drop alerts and fitment updates.
              </h2>
              <p className="mt-3 text-[var(--ant-body)]">A quiet, occasional note when parts match your saved builds.</p>
            </div>
            <form onSubmit={handleSubscribe} className="flex w-full max-w-md items-center gap-3">
              <input
                type="email"
                required
                placeholder="you@email.com"
                aria-label="Email address"
                className="h-12 flex-1 rounded-full border border-[var(--ant-line)] bg-[var(--ant-canvas)] px-5 text-[var(--ant-ink)] outline-none transition focus:border-[var(--ant-clay)]"
              />
              <button type="submit" className="ant-btn h-12 px-6 text-sm">
                {subscribed ? "Subscribed ✓" : "Subscribe"}
              </button>
            </form>
          </div>
        </section>
      </main>

      <ConceptFooter buildCount={initialBuilds.length} />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-[var(--ant-line)] bg-[var(--ant-canvas)] px-5 py-3 text-sm font-semibold text-[var(--ant-ink)] shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/** Anthropic-style radial-spike mark, drawn as evenly spaced tapered rays. */
function SpikeMark({ className = "" }: { className?: string }) {
  const spikeCount = 12;
  return (
    <svg viewBox="-50 -50 100 100" className={className} width="28" height="28" aria-hidden>
      {Array.from({ length: spikeCount }).map((_, index) => {
        const angle = (index / spikeCount) * 360;
        return (
          <line
            key={index}
            x1="0"
            y1="-12"
            x2="0"
            y2="-44"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            transform={`rotate(${angle})`}
          />
        );
      })}
    </svg>
  );
}

function ConceptNav({ onMarkClick }: { onMarkClick: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--ant-line)] bg-[var(--ant-canvas)]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-6 md:px-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onMarkClick}
            aria-label="Cycle accent color"
            className="ant-mark text-[var(--ant-clay)]"
          >
            <SpikeMark />
          </button>
          <Link href="/" className="font-brand text-xl font-semibold tracking-[-0.04em] text-[var(--ant-ink)]">
            DRVN
          </Link>
          <span className="ant-mono ml-1 hidden text-[0.65rem] uppercase tracking-[0.18em] text-[var(--ant-muted)] sm:inline">
            Clay concept
          </span>
        </div>
        <nav className="flex items-center gap-6 text-sm text-[var(--ant-body)]">
          <Link href="/home-alt" className="hidden transition hover:text-[var(--ant-ink)] md:inline">
            Velocity
          </Link>
          <Link href="/home-brutalist" className="hidden transition hover:text-[var(--ant-ink)] md:inline">
            Paddock
          </Link>
          <Link href="/" className="ant-btn px-5 py-2 text-sm">
            Open the app
          </Link>
        </nav>
      </div>
    </header>
  );
}

function GarageCard({ car }: { car: Car }) {
  return (
    <article className="ant-card flex h-full flex-col overflow-hidden p-3">
      <div
        className="h-52 w-full rounded-[14px] bg-cover bg-center"
        style={{ backgroundImage: `url(${car.image})` }}
      />
      <div className="flex flex-1 flex-col px-3 pb-3 pt-5">
        <p className="ant-mono text-[0.65rem] uppercase tracking-[0.16em] text-[var(--ant-clay)]">
          {car.platform} · {car.drivetrain}
        </p>
        <h3 className="ant-serif mt-2 text-xl text-[var(--ant-ink)]">{car.name}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--ant-body)]">{car.description}</p>
        <div className="mt-auto flex items-center justify-between pt-5 text-sm text-[var(--ant-muted)]">
          <span>{car.followers.toLocaleString()} followers</span>
          <span>{car.mods.length} mods</span>
        </div>
      </div>
    </article>
  );
}

function ConceptFooter({ buildCount }: { buildCount: number }) {
  return (
    <footer className="border-t border-[var(--ant-line)]">
      <div className="mx-auto flex max-w-[1180px] flex-col items-start justify-between gap-6 px-6 py-12 md:flex-row md:items-center md:px-10">
        <div className="flex items-center gap-3 text-[var(--ant-clay)]">
          <SpikeMark />
          <span className="font-brand text-lg font-semibold tracking-[-0.04em] text-[var(--ant-ink)]">DRVN</span>
        </div>
        <p className="ant-mono text-xs uppercase tracking-[0.16em] text-[var(--ant-muted)]">
          Clay concept · {buildCount} documented builds · click the ✳ mark
        </p>
      </div>
    </footer>
  );
}

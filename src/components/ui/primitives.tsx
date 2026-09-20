"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

import { cx } from "@/lib/format";

import { Icon } from "./icons";

/** Constrained page column. Despite its name this rendered the full 1200px
 *  `.wrap` for years — every "narrow" page was actually full-width. It now
 *  does what it says: `narrow` (720px) for reading/list surfaces, with
 *  `medium`/`wide` variants for pages that need more room. */
export function NarrowColumn({
  children,
  width = "narrow",
}: {
  children: ReactNode;
  width?: "narrow" | "medium" | "wide";
}) {
  return <div className={`wrap wrap--${width} pb-6`}>{children}</div>;
}

/** Identity mark — a Livesheet monogram plate (soft square, never a circle). */
/** Named avatar scale — sm 44 · md 48 · lg 64 · xl 88. Sizes live in CSS
 *  (`.monogram--*`) so call sites can't invent off-system dimensions. */
const AVATAR_SIZES = {
  sm: "monogram--sm",
  md: "monogram--md",
  lg: "", // base .monogram is 64px
  xl: "monogram--xl",
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZES;

export function Avatar({ size = "md", initials = "NB" }: { size?: AvatarSize; initials?: string }) {
  return <span className={cx("monogram shrink-0", AVATAR_SIZES[size])}>{initials}</span>;
}

/** Documented `sizes` presets, matched to how this component is actually used
 *  around the app — a full-bleed hero, a card in a 2-4 col grid, a small
 *  fixed-size thumbnail, or a fixed-size avatar/monogram-scale crop. Callers
 *  can still pass any raw `sizes` string; these just name the common cases so
 *  a caller isn't guessing at a viewport-width formula. */
export const MEDIA_SIZES = {
  /** Full-bleed page hero. */
  hero: "100vw",
  /** Large in-column feature image (e.g. a PDP gallery hero at desktop). */
  feature: "(min-width: 981px) 60vw, 100vw",
  /** Garage/Home vehicle presentation — a leading section image, larger than
   *  a card but never a hero. */
  vehicle: "(min-width: 981px) 420px, (min-width: 640px) 50vw, 100vw",
  /** A card in a 2–4 column grid. */
  card: "(min-width: 768px) 33vw, 50vw",
  /** Compact row media in a ledger/list line (~56–90px box). */
  row: "96px",
  /** Small fixed-size thumbnail (~84–120px box). */
  thumb: "120px",
  /** Monogram-scale crop. */
  avatar: "88px",
} as const;

export type MediaRole = keyof typeof MEDIA_SIZES;

export function Media({
  src,
  alt,
  className = "",
  fallbackClassName = "",
  role,
  sizes,
  focal,
  eager = false,
}: {
  src?: string;
  alt: string;
  className?: string;
  /** Extra classes for the no-photo plate only. Card covers pass
   *  `plate-undrawn` so an unphotographed listing reads as a plate that
   *  hasn't been drawn yet rather than a dead grey block. Thumbnails and
   *  inline media leave it off and keep the plain fallback. */
  fallbackClassName?: string;
  /** Semantic delivery hint — which rendered-size family this image belongs
   *  to. Prefer this over a raw `sizes` string so a row thumbnail can't
   *  silently fetch a card-sized asset (or a hero fetch a thumbnail). */
  role?: MediaRole;
  /** Raw `sizes` escape hatch for a layout the role presets don't cover.
   *  Wins over `role` when both are passed. */
  sizes?: string;
  /** Only the leading visible image should compete for early bandwidth. */
  eager?: boolean;
  /** Non-destructive framing (0043): 0..1 focal point kept in frame at every
   *  crop via object-position. Null/undefined = centered as before. */
  focal?: { x: number | null; y: number | null } | null;
}) {
  const resolvedSizes = sizes ?? MEDIA_SIZES[role ?? "card"];
  if (!src) {
    // The plate variants carry a drawn mark; the plain fallback stays empty so
    // thumbnails and inline media don't sprout a badge at 44px.
    const marked = fallbackClassName.includes("plate-undrawn");
    return (
      <span
        className={`block bg-img-fallback ${fallbackClassName} ${className}`}
        aria-label={alt}
        role="img"
      >
        {/* The same dashed badge every empty state uses (`.undrawn__mark`),
            carrying the image icon rather than a text glyph — so a missing
            photograph is spoken in the identical voice as a missing order or
            a missing build entry. */}
        {marked && (
          <span className="undrawn__mark" aria-hidden="true">
            <Icon name="image" />
          </span>
        )}
      </span>
    );
  }

  return (
    <span className={`relative block overflow-hidden bg-img-fallback ${className}`}>
      {/* Optimization is on: next.config.ts allows the Supabase storage host,
          so these resize and serve AVIF/WebP instead of full-size originals. */}
      <Image
        src={src}
        alt={alt}
        fill
        sizes={resolvedSizes}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        className="object-cover"
        style={
          focal && focal.x !== null && focal.y !== null
            ? { objectPosition: `${Math.round(focal.x * 100)}% ${Math.round(focal.y * 100)}%` }
            : undefined
        }
      />
    </span>
  );
}

export function MetadataTags({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="chip">
          {tag}
        </span>
      ))}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="microlabel microlabel--ink">{children}</p>;
}

/** Scrollable thumbnail strip — media plates on the sheet, no borders.
 *  Native scrollbar is suppressed (`.hgallery`); overflow is signalled by
 *  edge fades and hover paddles instead. */
export function HorizontalGallery({
  images,
  large = false,
  alt,
}: {
  images: string[];
  large?: boolean;
  alt: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);

  const sync = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanBack(el.scrollLeft > 4);
    setCanFwd(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    sync();
    const el = trackRef.current;
    if (!el) return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sync, images.length]);

  const nudge = (direction: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className={cx("hgallery pb-2", canBack && "can-back", canFwd && "can-fwd")}>
      <div ref={trackRef} onScroll={sync} className="hgallery__track" tabIndex={canBack || canFwd ? 0 : undefined}>
        {images.map((image, index) => (
          <Media
            key={`${image}-${index}`}
            src={image}
            alt={`${alt} image ${index + 1}`}
            className={`${large ? "h-[90px] w-40" : "h-[90px] w-[89px]"} shrink-0 rounded-ctl`}
            sizes={MEDIA_SIZES.thumb}
          />
        ))}
      </div>
      {canBack && (
        <button
          type="button"
          className="hgallery__paddle hgallery__paddle--back"
          aria-label="Previous images"
          onClick={() => nudge(-1)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {canFwd && (
        <button
          type="button"
          className="hgallery__paddle hgallery__paddle--fwd"
          aria-label="More images"
          onClick={() => nudge(1)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** The system's tab replacement — a quiet jumprow of underlined mono links. */
export function TabNav({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div className="jumprow">
      <span className="microlabel">On this page</span>
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          aria-pressed={tab === active}
          className={cx("jumplink", tab === active && "!border-live !text-live")}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

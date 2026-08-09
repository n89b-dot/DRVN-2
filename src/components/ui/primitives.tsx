"use client";

import type { ReactNode } from "react";
import Image from "next/image";

import { cx } from "@/lib/format";

import { Icon } from "./icons";

export function NarrowColumn({ children }: { children: ReactNode }) {
  return <div className="wrap pb-6">{children}</div>;
}

/** Identity mark — a Livesheet monogram plate (soft square, never a circle). */
export function Avatar({ size = "h-12 w-12", initials = "NB" }: { size?: string; initials?: string }) {
  return <span className={cx("monogram shrink-0", size)}>{initials}</span>;
}

/** Documented `sizes` presets, matched to how this component is actually used
 *  around the app — a full-bleed hero, a card in a 2-4 col grid, a small
 *  fixed-size thumbnail, or a fixed-size avatar/monogram-scale crop. Callers
 *  can still pass any raw `sizes` string; these just name the common cases so
 *  a caller isn't guessing at a viewport-width formula. */
export const MEDIA_SIZES = {
  hero: "100vw",
  card: "(min-width: 768px) 33vw, 50vw",
  thumb: "120px",
  avatar: "48px",
} as const;

export function Media({
  src,
  alt,
  className = "",
  fallbackClassName = "",
  sizes = MEDIA_SIZES.card,
}: {
  src?: string;
  alt: string;
  className?: string;
  /** Extra classes for the no-photo plate only. Card covers pass
   *  `plate-undrawn` so an unphotographed listing reads as a plate that
   *  hasn't been drawn yet rather than a dead grey block. Thumbnails and
   *  inline media leave it off and keep the plain fallback. */
  fallbackClassName?: string;
  /** One of `MEDIA_SIZES`, or a raw `sizes` string for a layout those presets
   *  don't cover. Defaults to the `card` preset, which matches what every
   *  current caller was already hard-coding. */
  sizes?: string;
}) {
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
      <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" />
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

/** Scrollable thumbnail strip — media plates on the sheet, no borders. */
export function HorizontalGallery({
  images,
  large = false,
  alt,
}: {
  images: string[];
  large?: boolean;
  alt: string;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]">
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

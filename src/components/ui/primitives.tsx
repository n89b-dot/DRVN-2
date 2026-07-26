"use client";

import type { ReactNode } from "react";
import Image from "next/image";

import { cx } from "@/lib/format";

export function NarrowColumn({ children }: { children: ReactNode }) {
  return <div className="wrap pb-6">{children}</div>;
}

/** Identity mark — a Livesheet monogram plate (soft square, never a circle). */
export function Avatar({ size = "h-12 w-12", initials = "NB" }: { size?: string; initials?: string }) {
  return <span className={cx("monogram shrink-0", size)}>{initials}</span>;
}

export function Media({
  src,
  alt,
  className = "",
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return (
      <span
        className={`block bg-img-fallback ${className}`}
        aria-label={alt}
        role="img"
      />
    );
  }

  return (
    <span className={`relative block overflow-hidden bg-img-fallback ${className}`}>
      {/* Optimization is on: next.config.ts allows the Supabase storage host,
          so these resize and serve AVIF/WebP instead of full-size originals. */}
      <Image src={src} alt={alt} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
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
      <span className="microlabel">On this sheet</span>
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

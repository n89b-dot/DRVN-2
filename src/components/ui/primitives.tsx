"use client";

import type { ReactNode } from "react";
import Image from "next/image";

import { cx } from "@/lib/format";

export function NarrowColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[540px] px-5 py-10 md:py-14">{children}</div>;
}

export function Avatar({ size = "h-12 w-12", initials = "NB" }: { size?: string; initials?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_25%,#4B83D6,#111315_70%)] text-[11px] font-bold text-white ${size}`}
    >
      {initials}
    </span>
  );
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
        className={`block bg-[linear-gradient(135deg,#0F1115,#2D5BFF_70%,#7CA2FF)] ${className}`}
        aria-label={alt}
        role="img"
      />
    );
  }

  return (
    <span className={`relative block overflow-hidden ${className}`}>
      <Image src={src} alt={alt} fill sizes="(max-width: 768px) 100vw, 33vw" unoptimized className="object-cover" />
    </span>
  );
}

export function MetadataTags({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span key={tag} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-text-secondary">
          {tag}
        </span>
      ))}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{children}</p>;
}

/**
 * Scrollable thumbnail strip (Figma profile): compact variant is ~square
 * (89x90), large is wide (160x90), with a slim 2px scrollbar underneath.
 */
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
    <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin] [scrollbar-color:#353945_transparent] [&::-webkit-scrollbar]:h-0.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
      {images.map((image, index) => (
        <Media
          key={`${image}-${index}`}
          src={image}
          alt={`${alt} image ${index + 1}`}
          className={`${large ? "h-[90px] w-40" : "h-[90px] w-[89px]"} shrink-0 rounded-lg border border-white/10`}
        />
      ))}
    </div>
  );
}

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
    <div className="flex items-center gap-6 border-b border-white/10 text-sm">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={cx(
            "-mb-px border-b-2 pb-3 transition",
            tab === active
              ? "border-text-primary text-text-primary"
              : "border-transparent text-text-muted hover:text-text-secondary",
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

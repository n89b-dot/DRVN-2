import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar, Media } from "./primitives";

export type GalleryImage = { url: string; alt?: string | null };

/** Linked, tappable title with the drill-in glyph (mockup LinkedTitle). */
export function LinkedTitle({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 text-left text-[15px] font-medium text-text-primary"
    >
      <span className="group-hover:underline">{label}</span>
      <span className="text-xs text-text-muted transition group-hover:text-text-secondary">↗</span>
    </Link>
  );
}

/** Date-rail timeline row: 52px right-aligned date + content column (mockup TimelineRow). */
export function TimelineRow({ date, children }: { date: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-4">
      <span className="pt-0.5 text-right text-xs text-text-muted">{date}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Subtle dark pill for a profile's primary website link (Figma profile). */
export function WebsitePill({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href.startsWith("http") ? href : `https://${href}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex rounded-full bg-raised px-3.5 py-1.5 text-xs text-text-secondary transition hover:text-text-primary"
    >
      {label}
    </a>
  );
}

/** Sentence-case section heading used on profile pages (Figma: "Vehicles", "Activity", "Contact"). */
export function SectionHeading({ children }: { children: ReactNode }) {
  return <p className="text-sm text-text-secondary">{children}</p>;
}

/**
 * Identity block used at the top of profile and car pages (mockup ProfileScreen
 * header): 88px avatar, name, handle, tagline, optional website pill, and an
 * optional right-aligned action slot (follow / edit).
 */
export function ProfileHeader({
  initials,
  name,
  handle,
  tagline,
  website,
  action,
  avatarSquare = false,
  avatarUrl,
}: {
  initials: string;
  name: string;
  handle?: string;
  tagline?: string | null;
  website?: { label: string; href: string };
  action?: ReactNode;
  avatarSquare?: boolean;
  avatarUrl?: string | null;
}) {
  const avatarClass = avatarSquare
    ? "h-[88px] w-[88px] shrink-0 rounded-2xl border border-white/10"
    : "h-[92px] w-[92px] shrink-0 rounded-full border border-white/10";
  return (
    <header className="flex items-start gap-5">
      {avatarUrl ? (
        <Media src={avatarUrl} alt={name} className={avatarClass} />
      ) : avatarSquare ? (
        <Media alt={name} className={avatarClass} />
      ) : (
        <Avatar size="h-[92px] w-[92px]" initials={initials} />
      )}
      <div className="min-w-0 flex-1 pt-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-[-0.01em] text-text-primary">{name}</h1>
            {handle && <p className="mt-0.5 text-sm text-text-muted">{handle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {tagline && <p className="mt-1 text-sm text-text-muted">{tagline}</p>}
        {website && (
          <span className="mt-3 inline-flex">
            <WebsitePill label={website.label} href={website.href} />
          </span>
        )}
      </div>
    </header>
  );
}

/**
 * Asymmetric vehicle gallery — hero + supporting tiles (mockup VehicleGallery).
 * When `onSelect` is given, tiles become buttons (used for the lightbox).
 */
export function VehicleGallery({
  images,
  onSelect,
}: {
  images: GalleryImage[];
  onSelect?: (index: number) => void;
}) {
  if (!images.length) return null;
  const [hero, ...rest] = images;

  const tile = (image: GalleryImage, index: number, className: string) => {
    const media = <Media src={image.url} alt={image.alt ?? "Car photo"} className={`${className} w-full`} />;
    if (!onSelect) return <div key={index}>{media}</div>;
    return (
      <button
        key={index}
        type="button"
        onClick={() => onSelect(index)}
        className="block w-full transition hover:opacity-85"
      >
        {media}
      </button>
    );
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-[1fr_0.7fr] gap-3">
        {tile(hero, 0, "h-56 rounded-2xl border border-white/10")}
        <div className="grid gap-3">
          {rest.slice(0, 2).map((image, i) => tile(image, i + 1, "h-[106px] rounded-2xl border border-white/10"))}
        </div>
      </div>
      {rest.length > 2 && (
        <div className="grid grid-cols-3 gap-3">
          {rest.slice(2, 5).map((image, i) => tile(image, i + 3, "h-24 rounded-2xl border border-white/10"))}
        </div>
      )}
    </div>
  );
}

/**
 * Embedded video block (mockup ActivityDetailScreen): dark gradient tile with
 * a red play chip, linking out to the video, with a caption underneath.
 */
export function EmbeddedVideo({ url, title }: { url: string; title?: string | null }) {
  return (
    <div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="relative grid h-52 place-items-center overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0C0C0C,#2A2A2A)] transition hover:opacity-90"
        aria-label={title ?? "Watch video"}
      >
        <span className="grid h-14 w-20 place-items-center rounded-xl bg-[#FF0000] text-white">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </a>
      <p className="mt-2 text-xs text-text-muted">{title ?? url.replace(/^https?:\/\//, "")}</p>
    </div>
  );
}

/** Bordered key/value table used for Wheels & Tires (mockup CarScreen). */
export function KeyValueTable({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      {rows.map((row, index) => (
        <div
          key={`${row.label}-${index}`}
          className={`flex items-center justify-between px-4 py-3 text-sm ${
            index > 0 ? "border-t border-white/10" : ""
          }`}
        >
          <span className="text-text-muted">{row.label}</span>
          <span className="text-text-primary">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";


import { Avatar, Media } from "./primitives";

export type GalleryImage = { url: string; alt?: string | null };

/** Linked, tappable title — live hover, drafting-office arrow. */
export function LinkedTitle({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2 text-left text-body font-semibold text-ink transition-colors hover:text-live"
    >
      <span>{label}</span>
      <span className="font-mono text-xs text-dim transition group-hover:text-live">→</span>
    </Link>
  );
}

/** Date-rail timeline row — mono date column, like the mockup feed. */
export function TimelineRow({ date, children }: { date: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[74px_minmax(0,1fr)] gap-4 border-t border-[color:var(--rule-soft)] py-3 first:border-t-0">
      <span className="pt-0.5 font-mono text-xs text-dim">{date}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Quiet mono ref-link for a profile's website. */
export function WebsitePill({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href.startsWith("http") ? href : `https://${href}`}
      target="_blank"
      rel="noreferrer"
      className="jumplink"
    >
      {label} ↗
    </a>
  );
}

/** Mono microlabel section heading. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return <p className="microlabel">{children}</p>;
}

/**
 * Identity block at the top of profile and car sheets: monogram/media plate,
 * name, mono handle line, optional action slot.
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
  bannerUrl,
  stats,
  location,
}: {
  initials: string;
  name: string;
  handle?: string;
  tagline?: string | null;
  website?: { label: string; href: string };
  action?: ReactNode;
  avatarSquare?: boolean;
  avatarUrl?: string | null;
  /** A car's cover, borrowed (P-1). Never a separate upload — see
   *  lib/cars/banner.ts for which photo, and why a private car's never is. */
  bannerUrl?: string | null;
  /** followers · following · cars, as already-formatted pairs. */
  stats?: { label: string; value: string }[];
  location?: string | null;
}) {
  void avatarSquare; // everything on the sheet is a soft square plate
  return (
    <div className="profhead">
      {/* The band is always there: with no eligible cover it is a plain tile,
          so a profile without a car still has a header, not a hole. Nothing
          is typeset on the photo — the identity row sits below it. */}
      <span className="profhead__banner">
        {bannerUrl && <Media src={bannerUrl} alt="" className="h-full w-full" role="hero" />}
      </span>
      <header className="profhead__body">
        <span className="profhead__avatar">
          {avatarUrl ? (
            <Media src={avatarUrl} alt={name} className="h-full w-full" role="avatar" />
          ) : (
            <Avatar size="xl" initials={initials} />
          )}
        </span>
        <div className="profhead__id">
          <h1 className="text-sub font-semibold leading-tight tracking-[-0.01em]">{name}</h1>
          {handle && <p className="kv mt-1 text-dim">{handle}</p>}
          {tagline && <p className="mt-2 max-w-[56ch] text-body text-dim">{tagline}</p>}
          {(location || website) && (
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              {location && <span className="kv text-dim">{location}</span>}
              {website && <WebsitePill label={website.label} href={website.href} />}
            </p>
          )}
        </div>
        {(stats?.length || action) && (
          <div className="profhead__side">
            {stats && stats.length > 0 && (
              <dl className="profhead__stats">
                {stats.map((stat) => (
                  // A zero is a fact, not a headline: it steps back to dim.
                  <div key={stat.label} className={stat.value === "0" ? "is-zero" : undefined}>
                    <dt>{stat.label}</dt>
                    <dd>{stat.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {action && <div className="max-w-full min-w-0">{action}</div>}
          </div>
        )}
      </header>
    </div>
  );
}

/**
 * Asymmetric vehicle gallery — hero + supporting media plates, tone-separated.
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
    const media = <Media src={image.url} alt={image.alt ?? "Car photo"} className={`${className} w-full`} role="card" />;
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
      {/* Single column below sm — the fixed 1fr/0.7fr split otherwise squeezed
          the hero and side stack side by side on a phone. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_0.7fr]">
        {tile(hero, 0, "h-56 rounded-r")}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rest.slice(0, 2).map((image, i) => tile(image, i + 1, "h-[104px] rounded-ctl"))}
        </div>
      </div>
      {rest.length > 2 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {rest.slice(2, 5).map((image, i) => tile(image, i + 3, "h-24 rounded-ctl"))}
        </div>
      )}
    </div>
  );
}

/** Embedded video block — an ink plate with an on-ink play mark. */
export function EmbeddedVideo({ url, title }: { url: string; title?: string | null }) {
  return (
    <div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="relative grid h-52 place-items-center overflow-hidden rounded-r bg-ink transition hover:opacity-90"
        aria-label={title ?? "Watch video"}
      >
        <span className="grid h-14 w-20 place-items-center rounded-ctl bg-on-ink text-ink">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </a>
      <p className="mt-2 font-mono text-xs text-dim">{title ?? url.replace(/^https?:\/\//, "")}</p>
    </div>
  );
}

/** Ruled key/value spec table (Wheels & Tires etc.). */
export function KeyValueTable({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <table className="spec">
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.label}-${index}`}>
            <td>{row.label}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

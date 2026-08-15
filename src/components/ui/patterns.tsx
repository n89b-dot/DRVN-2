import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar, Media } from "./primitives";

export type GalleryImage = { url: string; alt?: string | null };

/** Linked, tappable title — live hover, drafting-office arrow. */
export function LinkedTitle({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 text-left text-body font-semibold text-ink transition-colors hover:text-live"
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
  void avatarSquare; // everything on the sheet is a soft square plate
  const avatarClass = "h-22 w-22 shrink-0 rounded-ctl"; // 88px — the xl step of the avatar scale
  return (
    <header className="flex items-start gap-5">
      {avatarUrl ? (
        <Media src={avatarUrl} alt={name} className={avatarClass} role="avatar" />
      ) : (
        <Avatar size="xl" initials={initials} />
      )}
      <div className="min-w-0 flex-1 pt-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-sub font-semibold leading-tight tracking-[-0.01em]">{name}</h1>
            {handle && <p className="kv mt-1 text-dim">{handle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {tagline && <p className="mt-1.5 max-w-[52ch] text-body text-dim">{tagline}</p>}
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
          {rest.slice(0, 2).map((image, i) => tile(image, i + 1, "h-[106px] rounded-ctl"))}
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

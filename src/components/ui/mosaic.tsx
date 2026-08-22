import Link from "next/link";
import type { ReactNode } from "react";

import { CardEngagement } from "@/features/social/card-actions";
import type { FeedItem } from "@/lib/feed";
import { conditionLabel, formatPrice } from "@/lib/marketplace/taxonomy";

import type { ListingCardData } from "./listing-card";
import { Media } from "./primitives";

/**
 * Mosaic — the photo-wall grid (Best Buy customer images). Cells sit on one
 * portrait unit: 1×1 cards, with 2×2 features and 2×1 wides on the phone
 * wall, packed `dense` so the wall has no holes. Four units across on
 * desktop, three on tablet, two on phones.
 *
 * Every cell shares one anatomy, whatever its size or kind:
 *
 *   eyebrow row                  mono kind label · annotation (time, watching)
 *   photo plate                  takes whatever height the caption leaves
 *   caption                      headline → value line → meta, ink on the tile
 *   engagement strip             like · comment · share · save
 *
 * It is the deck's card (tile surface, padding, type scale) on a fixed
 * unit. The caption grows with the cell — a phone 1×1 shows headline and
 * value; a desktop card or a phone wide/feature adds the meta line and a second headline line
 * (container queries on the cell, see .mcell in globals.css). Size is a
 * stable hash of the id, so the wall never reshuffles between renders.
 */

export type MosaicSize = "sq" | "wide" | "xl";

function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** ~10% feature (2×2), ~15% wide (2×1), the rest 1×1. The larger shapes
 *  only take effect on the two-column phone wall (see .mcell--wide in
 *  globals.css); at 3–4 columns every cell is one card, so no photo ever
 *  grows past its 4-column size. */
export function mosaicSize(id: string, hasPhoto: boolean): MosaicSize {
  if (!hasPhoto) return "sq";
  const r = hashOf(id) % 20;
  if (r < 2) return "xl";
  if (r < 5) return "wide";
  return "sq";
}

export function Mosaic({ children }: { children: ReactNode }) {
  return (
    <div className="mosaicwrap">
      <div className="mosaic">{children}</div>
    </div>
  );
}

/* Literal class strings: the CSS build drops rules whose selectors never
   appear verbatim in source, so these can't be assembled from `kind`. */
const KIND_PILL = {
  part: "mcell__eyebrow mcell__eyebrow--part",
  car: "mcell__eyebrow mcell__eyebrow--car",
  update: "mcell__eyebrow mcell__eyebrow--update",
} as const;

export function MosaicCell({
  href,
  size,
  src,
  alt,
  eyebrow,
  kind,
  corner,
  flag,
  headline,
  value,
  sub,
  meta,
  engagement,
  tone = "photo",
  prefetch,
}: {
  href: string;
  size: MosaicSize;
  src?: string | null;
  alt: string;
  /** Mono kind label, top-left. Omit (with no flag/corner) to drop the top
   *  row entirely — the marketplace wall, where every cell is a part. */
  eyebrow?: string;
  /** What the cell is — sets the eyebrow pill's tone so a part for sale, a
   *  build and an update tell apart at a glance across the mixed wall.
   *  Omit on a single-kind wall (the marketplace) for a plain mono eyebrow. */
  kind?: "part" | "car" | "update";
  /** Mono annotation, top-right (time, watch count). */
  corner?: string | null;
  /** Ink state flag (SOLD / RESERVED) — replaces the eyebrow chip. */
  flag?: string | null;
  headline: string;
  /** Price line, or a subline for non-priced kinds. */
  value?: ReactNode;
  /** Quiet mono line under the value — the car a part came off. Sits a step
   *  below the price so it never competes with it. */
  sub?: string | null;
  /** Dim meta — only shown once the cell is wide enough. */
  meta?: string | null;
  engagement?: ReactNode;
  /** `deep` = recessed annotation tone for updates without a photo. */
  tone?: "photo" | "deep";
  prefetch?: boolean;
}) {
  const bare = !src;
  const cls = [
    "mcell",
    size !== "sq" && `mcell--${size}`,
    bare && "mcell--bare",
    tone === "deep" && "mcell--deep",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link href={href} prefetch={prefetch} className={cls}>
      {(eyebrow || flag || corner) && (
        <span className="mcell__top">
          {flag ? (
            <span className="mcell__flag">{flag}</span>
          ) : (
            eyebrow && <span className={kind ? KIND_PILL[kind] : "mcell__eyebrow"}>{eyebrow}</span>
          )}
          {corner && <span className="mcell__eyebrow mcell__eyebrow--corner">{corner}</span>}
        </span>
      )}
      {src && (
        <span className="mcell__img" aria-hidden="true">
          <Media src={src} alt="" className="h-full w-full" role="card" />
        </span>
      )}
      <span className="mcell__cap">
        <span className="mcell__title">{headline}</span>
        {value && <span className="mcell__value">{value}</span>}
        {sub !== undefined && <span className="mcell__sub">{sub ?? "\u00a0"}</span>}
        {/* Always rendered on photo cells so every card in a row shares one
            caption height — a card without meta would otherwise push its
            photo taller and its title off the row's baseline. */}
        {(meta || !bare) && <span className="mcell__meta">{meta ?? "\u00a0"}</span>}
        {engagement}
      </span>
      <span className="sr-only">{alt}</span>
    </Link>
  );
}

type Viewer = { isLoggedIn?: boolean; path?: string };

/** Relative time, coarse — a feed date is a feel, not a stamp. */
function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function shipLine(cents: number | null | undefined): string | null {
  if (typeof cents !== "number") return null;
  return cents > 0 ? `+ ${formatPrice(cents)} ship` : "ships free";
}

/** One Explore item as a mosaic cell. */
export function FeedMosaicCell({
  item,
  isLoggedIn = false,
  path = "/explore",
}: { item: FeedItem } & Viewer) {
  if (item.kind === "part") {
    const href = `/listings/${item.id}`;
    const ship = shipLine(item.shipping_cents);
    const watching = item.watchCount ?? 0;
    return (
      <MosaicCell
        href={href}
        size={mosaicSize(item.id, Boolean(item.cover_url))}
        src={item.cover_url}
        alt={item.title}
        eyebrow="For sale"
        kind="part"
        corner={watching > 0 ? `${watching} watching` : null}
        headline={item.title}
        value={
          <>
            {formatPrice(item.price_cents)}
            {ship && <span className="mcell__ship"> {ship}</span>}
          </>
        }
        meta={
          [
            conditionLabel(item.condition),
            item.grade ? `Grade ${item.grade.toUpperCase()}` : null,
            item.fitsCarName ? `Fits your ${item.fitsCarName}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || null
        }
        engagement={
          <CardEngagement
            target={{ kind: "listing", id: item.id }}
            path={path}
            isLoggedIn={isLoggedIn}
            initialLiked={Boolean(item.viewerLiked)}
            likeCount={item.likeCount ?? 0}
            commentHref={href}
            commentCount={item.questionCount ?? 0}
            shareUrl={href}
            initialSaved={Boolean(item.viewerSaved)}
            compact
          />
        }
      />
    );
  }

  if (item.kind === "car") {
    const href = `/cars/${item.slug}`;
    const headline = item.name.trim() || item.meta || "Build sheet";
    const subline = item.name.trim() && item.meta ? item.meta : null;
    const activity = [
      item.ownerName,
      item.updateCount > 0
        ? `${item.updateCount} update${item.updateCount === 1 ? "" : "s"}`
        : null,
      item.forSaleCount > 0
        ? `${item.forSaleCount} part${item.forSaleCount === 1 ? "" : "s"} for sale`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <MosaicCell
        href={href}
        size={mosaicSize(item.id, Boolean(item.cover_url))}
        src={item.cover_url}
        alt={headline}
        eyebrow="Build"
        kind="car"
        corner={item.lastActivityAt ? relativeTime(item.lastActivityAt) : null}
        headline={headline}
        value={subline}
        meta={activity || null}
        engagement={
          <CardEngagement
            target={{ kind: "car", id: item.id }}
            path={path}
            isLoggedIn={isLoggedIn}
            initialLiked={Boolean(item.viewerLiked)}
            likeCount={item.likeCount ?? 0}
            shareUrl={href}
            initialSaved={Boolean(item.viewerSaved)}
            compact
          />
        }
      />
    );
  }

  const href = `/cars/${item.carSlug}/activity/${item.id}`;
  return (
    <MosaicCell
      href={href}
      size={mosaicSize(item.id, Boolean(item.cover_url))}
      src={item.cover_url}
      alt={item.title}
      tone="deep"
      eyebrow={item.imageCount > 1 && item.cover_url ? `Update · ${item.imageCount} photos` : "Update"}
      kind="update"
      corner={relativeTime(item.created_at)}
      headline={item.title ? `“${item.title}”` : item.intro ?? "Update"}
      value={[item.ownerName, item.carName].filter(Boolean).join(" · ")}
      meta={item.title && item.intro ? item.intro : null}
      engagement={
        <CardEngagement
          target={{ kind: "post", id: item.id }}
          path={path}
          isLoggedIn={isLoggedIn}
          initialLiked={Boolean(item.viewerLiked)}
          likeCount={item.reactions}
          commentHref={href}
          commentCount={item.commentCount ?? 0}
          shareUrl={href}
          initialSaved={Boolean(item.viewerSaved)}
          compact
        />
      }
    />
  );
}

/** One marketplace listing as a mosaic cell. */
export function ListingMosaicCell({
  listing,
  save,
  prefetch,
}: {
  listing: ListingCardData;
  save?: { isLoggedIn: boolean; path: string };
  prefetch?: boolean;
}) {
  const href = `/listings/${listing.id}`;
  const ship = shipLine(listing.shipping_cents);
  const meta =
    [
      listing.fits_car_name ? `Fits ${listing.fits_car_name}` : null,
      conditionLabel(listing.condition),
      listing.location,
    ]
      .filter(Boolean)
      .join(" · ") || null;
  return (
    <MosaicCell
      href={href}
      prefetch={prefetch}
      size={mosaicSize(listing.id, Boolean(listing.cover_url))}
      src={listing.cover_url}
      alt={listing.title}
      flag={listing.status_flag}
      sub={listing.source_car_name ?? null}
      headline={listing.title}
      value={
        <>
          {formatPrice(listing.price_cents)}
          {ship && <span className="mcell__ship"> {ship}</span>}
        </>
      }
      meta={listing.reason ?? meta}
      engagement={
        save && (
          <CardEngagement
            target={{ kind: "listing", id: listing.id }}
            path={save.path}
            isLoggedIn={save.isLoggedIn}
            initialLiked={Boolean(listing.viewer_liked)}
            likeCount={listing.like_count ?? 0}
            commentHref={href}
            commentCount={listing.question_count ?? 0}
            shareUrl={href}
            initialSaved={Boolean(listing.viewer_saved)}
            compact
          />
        )
      }
    />
  );
}

import Link from "next/link";
import type { ReactNode } from "react";

import { CardEngagement } from "@/features/social/card-actions";
import type { FeedItem } from "@/lib/feed";
import { cx } from "@/lib/format";
import { conditionLabel, formatPrice } from "@/lib/marketplace/taxonomy";
import { provenanceLine, vehicleLabel, vehicleSubline } from "@/lib/vehicles/label";

import type { ListingCardData } from "./listing-card";
import { Media } from "./primitives";
import { ratingLine } from "./rating";

/**
 * Mosaic — the photo-wall grid (Best Buy customer images). Cells sit on one
 * portrait unit: 1×1 cards, with 2×1 wides on the phone
 * wall, packed `dense` so the wall has no holes. Four units across on
 * desktop, three on tablet, two on phones.
 *
 * Every cell shares one anatomy, whatever its size or kind:
 *
 *   ┌ link region ──────────────────────────────────────────────┐
 *   │ eyebrow row      mono kind label · annotation (time, watch)│
 *   │ photo plate      takes whatever height the caption leaves  │
 *   │ caption          headline → car line → value line → meta   │
 *   └────────────────────────────────────────────────────────────┘
 *   trust             seller · rating (wide cells)
 *   actions           Buy now · Add to cart (Marketplace only)
 *   engagement        like · comment · share · save
 *
 * A listing reads title → the car it came off → price → condition, all in
 * one caption run inside the link region. The car line is plain text, not
 * a link to the build: on a phone two stacked targets were too easy to
 * confuse, so the card is the only thing to tap.
 *
 * The cell is an <article>, not one big <a>: the link region (everything
 * a buyer reads) is one large target, and every control underneath is its
 * own valid interactive element. Nothing interactive is nested, so keyboard
 * order is link → provenance → actions → engagement, and activating a
 * button never opens the listing.
 *
 * Size is a stable hash of the id, so the wall never reshuffles between
 * renders. The caption reads the same at every size — headline (two lines),
 * a secondary line and the meta line are always present (each truncates).
 * What a wider cell earns is room, not information: roomier padding, a
 * size step and the seller line (container queries on the cell, see .mcell
 * in globals.css). Type hierarchy is fixed across kinds: the title is the
 * only ink text, plus the price on a listing; everything else is one dim
 * mono secondary voice, then the 11.5px meta. Cell width is not monotonic in viewport width
 * (it jumps as the wall changes column count), so nothing informational
 * may be gated on it — a card that gained or lost a line as the window
 * resized read as a different card.
 */

export type MosaicSize = "sq" | "wide";

function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** ~25% wide (2×1), the rest 1×1. There is no 2×2 shape: on a phone it
 *  filled the whole viewport with one card. The wide shape only takes
 *  effect on the two-column phone wall (see .mcell--wide in globals.css);
 *  at 3–4 columns every cell is one card, so no photo ever grows past its
 *  4-column size. */
export function mosaicSize(id: string, hasPhoto: boolean): MosaicSize {
  if (!hasPhoto) return "sq";
  return hashOf(id) % 20 < 5 ? "wide" : "sq";
}

export function Mosaic({
  children,
  commerce = false,
  label,
}: {
  children: ReactNode;
  /** Cells carry an action row (Buy now · Add to cart) — the unit grows so
   *  the photo keeps its share of the card. */
  commerce?: boolean;
  /** Accessible name for the wall as a list of cards. */
  label?: string;
}) {
  return (
    <div className="mosaicwrap">
      <div className={cx("mosaic", commerce && "mosaic--commerce")} role="list" aria-label={label}>
        {children}
      </div>
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
  compareSrc,
  alt,
  eyebrow,
  kind,
  corner,
  flag,
  headline,
  value,
  sub,
  meta,
  detail,
  lede,
  trust,
  actions,
  engagement,
  tone = "photo",
  prefetch,
}: {
  href: string;
  size: MosaicSize;
  src?: string | null;
  /** The "after" image of a before/after pair (`src` is then the "before").
   *  The plate draws a static split — before left, after right, the
   *  drafting-line divider between — so a comparison update reads as one
   *  on the wall without the slider (which needs the post page). */
  compareSrc?: string | null;
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
  /** Quiet vehicle line under the title — the car a part came off, as plain
   *  text (the card is the only link). Pass `null` to reserve the line
   *  (rows stay aligned), `undefined` to omit it. */
  sub?: string | null;
  /** Dim meta line under the value ("Marisol Vega · 1 update"). Always
   *  shown, truncated to one line. Listings lead it with the condition as a
   *  small chip (see `metaLine`), then the rest as dot-separated text. */
  meta?: ReactNode;
  /** A dim fact line between the value and the meta — a listing's
   *  condition chip and grade, above the seller. One truncating line. */
  detail?: ReactNode;
  /** A dim line right under the title — an update's excerpt. Two lines
   *  before it clamps, the meta's voice, before the vehicle line. */
  lede?: ReactNode;
  /** Seller trust line — wide cells only. */
  trust?: ReactNode;
  /** Context-owned action row (quick commerce, Unsave…). Never nested in
   *  the link. */
  actions?: ReactNode;
  engagement?: ReactNode;
  /** `deep` = recessed annotation tone for updates without a photo. */
  tone?: "photo" | "deep";
  prefetch?: boolean;
}) {
  const bare = !src;
  const cls = cx(
    "mcell",
    size !== "sq" && `mcell--${size}`,
    bare && "mcell--bare",
    tone === "deep" && "mcell--deep"
  );

  return (
    <article className={cls} role="listitem">
      <Link href={href} prefetch={prefetch} className="mcell__link">
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
          <span className={cx("mcell__img", compareSrc && "mcell__img--ba")} aria-hidden="true">
            <Media src={src} alt="" className="h-full w-full" role="card" />
            {compareSrc && (
              <>
                <span className="mcell__ba-after">
                  <Media src={compareSrc} alt="" className="h-full w-full" role="card" />
                </span>
                <span className="mcell__ba-divider">
                  <span className="mcell__ba-grip">◂▸</span>
                </span>
              </>
            )}
          </span>
        )}
        <span className="mcell__cap">
          <span className="mcell__title">{headline}</span>
          {lede && <span className="mcell__meta mcell__lede">{lede}</span>}
          {/* The car a part came off — plain text under the title. It used to
              be its own link to the build; on a phone that and the card were
              too easy to confuse, so the card is the only target. Pass `null`
              to reserve the line (rows stay aligned), `undefined` to omit. */}
          {sub !== undefined && <span className="mcell__car vref">{sub ?? " "}</span>}
          {value && <span className="mcell__value">{value}</span>}
          {/* Always rendered on photo cells so every card in a row shares one
              caption height — a card without meta would otherwise push its
              photo taller and its title off the row's baseline. */}
          {detail && <span className="mcell__meta mcell__detail">{detail}</span>}
          {(meta || !bare) && <span className="mcell__meta">{meta ?? " "}</span>}
        </span>
        {/* The headline is the link's name; only say the alt when it adds
            something (an update card whose headline is its intro, etc.). */}
        {alt !== headline && <span className="sr-only">{alt}</span>}
      </Link>
      {trust && <span className="mcell__trust">{trust}</span>}
      {actions && <div className="mcell__actions">{actions}</div>}
      {engagement}
    </article>
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

/** One Explore item as a mosaic cell. Discovery cards: no commerce row —
 *  Explore is where you find things, the marketplace is where you buy them. */
export function FeedMosaicCell({
  item,
  isLoggedIn = false,
  path = "/explore",
}: { item: FeedItem } & Viewer) {
  if (item.kind === "part") {
    const href = `/listings/${item.id}`;
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
        // Price alone: most listings have no shipping figure up front, and
        // the discovery wall isn't where you check out. The marketplace
        // card keeps its ship line.
        value={formatPrice(item.price_cents)}
        sub={provenanceLine(item.sourceCarName)}
        // Condition and grade on their own line, the seller under them:
        // the name reads like the owner line on a build or an update.
        detail={listingMetaLine(item.condition, [
          item.grade ? `Grade ${item.grade.toUpperCase()}` : null,
        ])}
        meta={
          [item.sellerName, item.fitsCarName ? `Fits your ${item.fitsCarName}` : null]
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
    // The nameless car is named by what it is — the label leads, and the
    // vehicle line under it only appears when it adds information.
    const headline = item.name.trim() || item.meta || "Build sheet";
    const subline = vehicleSubline(headline, item.vehicle);
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
        value={subline ? <span className="vref vref--value">{subline}</span> : undefined}
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
      compareSrc={item.compare_url}
      alt={item.title}
      // Same plate as builds and parts — the kind pill is the only thing
      // that says "update", and it says only that: no photo counts, no
      // before/after tags; the plate itself shows what the update carries.
      eyebrow="Update"
      kind="update"
      corner={relativeTime(item.created_at)}
      // No quotation marks: the UPDATE pill already says what this is, and
      // the two glyphs cost the first characters of every title on a phone.
      headline={item.title || item.intro || "Update"}
      // The same lines as a build card: the full vehicle label in mono
      // under the excerpt, the owner alone on the meta line. The car's pet
      // name only stands in when the keeper never filled the vehicle in.
      lede={item.title && item.intro ? item.intro : null}
      value={vehicleLabel(item.carVehicle) || item.carName}
      // The owner as a byline — monogram then name, the way the listing
      // card's trust line signs the seller.
      meta={
        item.ownerName ? (
          <>
            <span className="monogram monogram--xs" aria-hidden="true">
              {initialsOf(item.ownerName)}
            </span>
            {item.ownerName}
          </>
        ) : null
      }
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

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

/**
 * The listing meta line: the condition as a small chip so it can be picked
 * out at a glance, the remaining facts (grade, fit, location) as quiet
 * dot-separated text after it. Null when there's nothing to say.
 */
function listingMetaLine(condition: string | null | undefined, rest: (string | null)[]): ReactNode {
  const chip = conditionLabel(condition ?? null);
  const tail = rest.filter(Boolean).join(" · ");
  if (!chip && !tail) return null;
  return (
    <>
      {chip && <span className="chip mcell__cond">{chip}</span>}
      {chip && tail && " · "}
      {tail}
    </>
  );
}

/**
 * One marketplace listing as a mosaic cell — the canonical listing card.
 * Home recommendations, Marketplace results, the PDP rails and Saved all
 * render this; what differs per context is the action row, never the
 * anatomy.
 */
export function ListingMosaicCell({
  listing,
  save,
  actions,
  // Fetch this dynamic route on activation. Racing partial prefetch payloads
  // can otherwise leave a navigation with metadata but an empty page body.
  prefetch = false,
}: {
  listing: ListingCardData;
  /** Renders the engagement strip (like · comment · share · save). */
  save?: { isLoggedIn: boolean; path: string };
  /** Context-owned controls under the card — quick commerce on the
   *  Marketplace, Unsave on Saved. Omitted elsewhere. */
  actions?: ReactNode;
  prefetch?: boolean;
}) {
  const href = `/listings/${listing.id}`;
  const ship = shipLine(listing.shipping_cents);
  const meta = listingMetaLine(listing.condition, [
    listing.fits_car_name ? `Fits ${listing.fits_car_name}` : null,
    listing.location,
  ]);
  const seller = listing.seller;
  // `rating` is already a display string ("4.8"); ratingLine only ever
  // interpolates it, so the cast is safe and keeps "4.0"-style strings intact.
  const sellerRating = seller?.rating
    ? ratingLine(seller.rating, seller.review_count ?? 0)
    : null;
  return (
    <MosaicCell
      href={href}
      prefetch={prefetch}
      size={mosaicSize(listing.id, Boolean(listing.cover_url))}
      src={listing.cover_url}
      alt={listing.title}
      flag={listing.status_flag}
      sub={provenanceLine(listing.source_car_name)}
      headline={listing.title}
      value={
        <>
          {formatPrice(listing.price_cents)}
          {ship && <span className="mcell__ship"> {ship}</span>}
        </>
      }
      meta={meta}
      trust={
        seller ? (
          <>
            <span className="monogram monogram--xs" aria-hidden="true">
              {initialsOf(seller.name)}
            </span>
            <span className="truncate">
              {seller.name}
              {sellerRating && ` · ${sellerRating}`}
            </span>
          </>
        ) : undefined
      }
      actions={actions}
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

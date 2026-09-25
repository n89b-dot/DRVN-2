import Link from "next/link";
import type { ReactNode } from "react";

import { CardEngagement } from "@/features/social/card-actions";
import type { FeedItem } from "@/lib/feed";
import { cx } from "@/lib/format";
import { conditionLabel, formatPrice } from "@/lib/marketplace/taxonomy";
import { provenanceLine, vehicleLabel, vehicleSubline } from "@/lib/vehicles/label";
import { ListingCartButton } from "@/features/commerce/quick-commerce";

import type { ListingCardData } from "./listing-card";
import { Badge, KindBadge } from "./badge";
import { Media } from "./primitives";
import { ratingLine } from "./rating";
import { postHref } from "@/lib/activity/href";

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
 *  4-column size. Builds and updates only — a listing is always square
 *  (FeedMosaicCell passes "sq"; the commerce wall folds wide to square in
 *  CSS), because part photos are often portrait and a 2×1 letterboxes
 *  them. */
export function mosaicSize(id: string, hasPhoto: boolean, uniform = false): MosaicSize {
  // E-1: on a uniform wall every card is the same footprint. The variation
  // read as editorial when the wall was mostly builds; with parts and
  // updates mixed in it reads as inconsistency, and it made the wall
  // impossible to scan for one kind of thing.
  if (uniform || !hasPhoto) return "sq";
  return hashOf(id) % 20 < 5 ? "wide" : "sq";
}

export function Mosaic({
  children,
  commerce = false,
  uniform = false,
  label,
}: {
  children: ReactNode;
  /** Cells carry an action row (Buy now · Add to cart) — the unit grows so
   *  the photo keeps its share of the card. */
  commerce?: boolean;
  /** E-1: one footprint for every card, and a fixed caption block, so the
   *  wall reads as one wall. Full-width breakers may still be placed
   *  between rows — those are the deliberate exception. */
  uniform?: boolean;
  /** Accessible name for the wall as a list of cards. */
  label?: string;
}) {
  return (
    <div className="mosaicwrap">
      <div
        className={cx("mosaic", commerce && "mosaic--commerce", uniform && "mosaic--uniform")}
        role="list"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}


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
  price,
  byline,
  trust,
  actions,
  engagement,
  tone = "photo",
  detailBesidePrice = false,
  prefetch,
  eager = false,
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
  /** What the cell is — renders the Kind badge (outline + icon, the same
   *  on every card) in place of the eyebrow text. Omit on a single-kind
   *  wall (the marketplace) for a plain mono eyebrow. */
  kind?: "part" | "car" | "update";
  /** Mono annotation, top-right (time, watch count). */
  corner?: string | null;
  /** Ink state flag (SOLD / RESERVED) — replaces the eyebrow chip. */
  flag?: string | null;
  headline: string;
  /** Price line, or a subline for non-priced kinds. */
  value?: ReactNode;
  /** The car, in the foot: the one a part came off, or the vehicle under
   *  an update's excerpt — plain text (the card is the only link). Pass
   *  `null` to reserve the line (rows stay aligned), `undefined` to omit. */
  sub?: string | null;
  /** Dim activity line in the foot, above the byline ("3 updates · 2 parts
   *  for sale"). One truncating line. */
  meta?: ReactNode;
  /** A dim fact line between the value and the meta — a listing's
   *  condition chip and grade, above the seller. One truncating line. */
  detail?: ReactNode;
  /** A dim line right under the title — an update's excerpt. Two lines
   *  before it clamps, the meta's voice, before the vehicle line. */
  lede?: ReactNode;
  /** A listing's price — the one live-coloured number, under the title. */
  price?: ReactNode;
  /** Who is behind the card: monogram plate + name, leading the foot with
   *  the reference line (car / activity) under it. */
  byline?: { name: string; note?: string; avatarUrl?: string | null } | null;
  /** Put the detail line beside the price on one row (the discovery
   *  card's "$120 · USED · Grade B") instead of under it. */
  detailBesidePrice?: boolean;
  /** Seller trust line — wide cells only. */
  trust?: ReactNode;
  /** Context-owned action row (quick commerce, Unsave…). Never nested in
   *  the link. */
  actions?: ReactNode;
  engagement?: ReactNode;
  /** `deep` = recessed annotation tone for updates without a photo. */
  tone?: "photo" | "deep";
  prefetch?: boolean;
  eager?: boolean;
}) {
  const bare = !src;
  const bylineNode = byline ? (
    <span className="mcell__byline">
      {/* The person's photo when they have one — the same face the shop's
          cards show — and their initials only when they don't. */}
      <span className="monogram monogram--xs" aria-hidden="true">
        {byline.avatarUrl ? (
          <Media src={byline.avatarUrl} alt="" className="h-full w-full" role="avatar" />
        ) : (
          initialsOf(byline.name)
        )}
      </span>
      <span className="mcell__byline__name">
        {byline.name}
        {byline.note && ` · ${byline.note}`}
      </span>
    </span>
  ) : null;
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
          <span className="mcell__head">
            {(eyebrow || flag || corner) && (
              <span className="mcell__top">
                {flag ? (
                  <span className="mcell__flag">{flag}</span>
                ) : (
                  // The kind is the one badge system's Kind badge — the same
                  // outline and icon on every card; a plain eyebrow otherwise.
                  eyebrow &&
                  (kind ? (
                    <KindBadge kind={kind} className="mcell__kind" />
                  ) : (
                    <span className="mcell__eyebrow">{eyebrow}</span>
                  ))
                )}
                {corner && <span className="mcell__eyebrow mcell__eyebrow--corner">{corner}</span>}
              </span>
            )}
          </span>
        )}
        {src && (
          <span className={cx("mcell__img", compareSrc && "mcell__img--ba")} aria-hidden="true">
            <Media eager={eager} src={src} alt="" className="h-full w-full" role="card" />
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
          {value && <span className="mcell__value">{value}</span>}
          {price && detail && detailBesidePrice ? (
            <span className="mcell__pricerow">
              <span className="mcell__price">{price}</span>
              <span className="mcell__meta mcell__detail">{detail}</span>
            </span>
          ) : (
            <>
              {price && <span className="mcell__price">{price}</span>}
              {detail && <span className="mcell__meta mcell__detail">{detail}</span>}
            </>
          )}
          {/* THE FOOT — the signature, then the reference, anchored to the
              caption's floor (the Figma cards' content block is
              justify-between: title block up top, this group down by the
              hairline). `sub` is the car: the one a part came off, or the
              vehicle under an update — plain text, the card is the only
              target. Pass `null` to reserve the line, `undefined` to omit.
              `meta` is a build's activity line. */}
          {(byline || sub !== undefined || meta) && (
            <span className="mcell__foot">
              {byline && bylineNode}
              {sub !== undefined && <span className="mcell__car vref">{sub ?? " "}</span>}
              {meta && <span className="mcell__meta">{meta}</span>}
            </span>
          )}
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
  eager = false,
  isLoggedIn = false,
  path = "/explore",
  uniform = false,
}: { item: FeedItem; eager?: boolean; uniform?: boolean } & Viewer) {
  if (item.kind === "part") {
    const href = `/listings/${item.id}`;
    return (
      <MosaicCell
        eager={eager}
        href={href}
        // Always a square: a part photo is often taller than wide (a seat,
        // a wing, a manifold on end), and the phone wall's 2×1 wide shape
        // crops it to a letterbox. Builds and updates can take the wide
        // slot; a listing's shape never changes.
        size="sq"
        src={item.cover_url}
        alt={item.title}
        // The same tile as a build or an update: FOR SALE pill, time, plate,
        // title, then the price row (price left, condition + grade right),
        // and the seller with the source car in the foot.
        eyebrow="For sale"
        kind="part"
        corner={relativeTime(item.created_at)}
        headline={item.title}
        // Price alone: most listings have no shipping figure up front, and
        // the discovery wall isn't where you check out.
        price={formatPrice(item.price_cents)}
        detail={listingMetaLine(item.condition, [
          item.grade ? `Grade ${item.grade.toUpperCase()}` : null,
        ])}
        detailBesidePrice
        byline={item.sellerName ? { name: item.sellerName, avatarUrl: item.sellerAvatarUrl } : null}
        sub={provenanceLine(item.sourceCarName)}
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
            trailing={<ListingCartButton listingId={item.id} title={item.title} />}
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
        eager={eager}
        href={href}
        size={mosaicSize(item.id, Boolean(item.cover_url), uniform)}
        src={item.cover_url}
        alt={headline}
        eyebrow="Build"
        kind="car"
        corner={item.lastActivityAt ? relativeTime(item.lastActivityAt) : null}
        headline={headline}
        value={subline ?? undefined}
        byline={item.ownerName ? { name: item.ownerName, avatarUrl: item.ownerAvatarUrl } : null}
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

  const href = postHref({ id: item.id, carSlug: item.carSlug });
  return (
    <MosaicCell
        eager={eager}
      href={href}
      size={mosaicSize(item.id, Boolean(item.cover_url), uniform)}
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
      // Title → excerpt up top; byline → vehicle in the foot: the Figma
      // update card.
      lede={item.title && item.intro ? item.intro : null}
      sub={vehicleLabel(item.carVehicle) || item.carName}
      byline={item.ownerName ? { name: item.ownerName, avatarUrl: item.ownerAvatarUrl } : null}
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
      {chip && <Badge className="mcell__cond">{chip}</Badge>}
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
      headline={listing.title}
      price={
        <>
          {formatPrice(listing.price_cents)}
          {ship && <span className="mcell__ship"> {ship}</span>}
        </>
      }
      detail={meta}
      sub={provenanceLine(listing.source_car_name)}
      byline={seller ? { name: seller.name, note: sellerRating ?? undefined, avatarUrl: seller.avatar_url } : null}
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

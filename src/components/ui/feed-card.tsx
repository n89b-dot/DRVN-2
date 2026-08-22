import Link from "next/link";

import { CardEngagement } from "@/features/social/card-actions";
import type { FeedItem } from "@/lib/feed";
import { conditionLabel, formatPrice } from "@/lib/marketplace/taxonomy";

import { FeedMosaicCell, Mosaic } from "./mosaic";
import { Media } from "./primitives";

/**
 * Explore plates — Livesheet tiles packed into columns (see .feedcols).
 * Every card keeps its natural height; cohesion comes from one shared
 * anatomy, whatever the format:
 *
 *   eyebrow (what this is) → media → headline → meta → engagement strip
 *
 * The kind is said once, in the eyebrow's mono voice — never as chip pills
 * fighting the content for room. Type recognition is systematic:
 *   part   — raised tile, price-led; photo-less parts become a mono
 *            price-tag plate rather than a giant empty image box
 *   build  — raised tile, taller media
 *   update — recessed deep tone; the sheet's annotation voice
 *
 * Within a type, *format* varies — photo-led posters at different aspects,
 * a horizontal split, compact ledger rows, text-first annotations — chosen
 * deterministically from the item id so the deck never reshuffles.
 */

/** Stable per-item hash — format variety without layout shift on re-render. */
function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** "3d ago" / "2w ago" — coarse on purpose; a feed date is a feel, not a stamp. */
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

/** Person + car on one line — an update is always someone doing something to something. */
function PersonCarLine({ owner, car }: { owner: string | null; car: string }) {
  return <p className="feedmeta mt-1.5">{[owner, car].filter(Boolean).join(" · ")}</p>;
}

type ViewerProps = { isLoggedIn?: boolean; path?: string };

export function FeedCard({
  item,
  isLoggedIn = false,
  path = "/explore",
}: { item: FeedItem } & ViewerProps) {
  if (item.kind === "part") {
    const href = `/listings/${item.id}`;
    const engagement = (compact = false) => (
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
        compact={compact}
      />
    );

    // One dim line carries condition, grade and fitment — the chips said the
    // same things louder and taller.
    const metaLine = [
      conditionLabel(item.condition),
      item.grade ? `Grade ${item.grade.toUpperCase()}` : null,
      item.fitsCarName ? `Fits your ${item.fitsCarName}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const watching = item.watchCount ?? 0;

    if (!item.cover_url) {
      // No photos yet → a price-tag plate: the number carries the card the
      // way the photo would, instead of a full-size empty image box.
      return (
        <Link href={href} className="tile block">
          <span className="flex items-baseline justify-between gap-3">
            <span className="microlabel">For sale</span>
            {watching > 0 && <span className="microlabel tabular-nums">{watching} watching</span>}
          </span>
          <p className="feedprice feedprice--lead mt-3">{formatPrice(item.price_cents)}</p>
          <p className="feedtitle clamp2 mt-1">{item.title}</p>
          {typeof item.shipping_cents === "number" && (
            <p className="feedmeta mt-1">
              {item.shipping_cents > 0
                ? `+ ${formatPrice(item.shipping_cents)} shipping`
                : "Shipping included"}
            </p>
          )}
          {metaLine && <p className="feedmeta mt-1">{metaLine}</p>}
          {engagement()}
        </Link>
      );
    }

    const cut = hashOf(item.id) % 5;
    if (cut === 1) {
      // Compact ledger row — the short beat between posters.
      return (
        <Link href={href} className="tile tile--row">
          <span className="tile__thumb" aria-hidden="true">
            <Media src={item.cover_url} alt="" className="h-full w-full" role="row" />
          </span>
          <span className="min-w-0 self-center">
            <span className="microlabel block">For sale</span>
            <span className="feedtitle clamp2 mt-0.5 block">{item.title}</span>
            <span className="feedmeta mt-0.5 block truncate">
              {formatPrice(item.price_cents)}
              {typeof item.shipping_cents === "number"
                ? item.shipping_cents > 0
                  ? ` · + ${formatPrice(item.shipping_cents)} shipping`
                  : " · shipping included"
                : ""}
            </span>
          </span>
          <span className="tile__rowfoot">{engagement(true)}</span>
        </Link>
      );
    }

    const square = cut === 0;
    return (
      <Link href={href} className="tile block">
        <span className="flex items-baseline justify-between gap-3">
          <span className="microlabel">For sale</span>
          {watching > 0 && <span className="microlabel tabular-nums">{watching} watching</span>}
        </span>
        <span className={`tile__img mt-2 block ${square ? "aspect-square" : "aspect-[3/2]"}`}>
          <Media src={item.cover_url} alt={item.title} className="h-full w-full" role="card" />
        </span>
        <p className="feedtitle clamp2">{item.title}</p>
        <p className="feedprice mt-1">
          {formatPrice(item.price_cents)}
          {typeof item.shipping_cents === "number" && (
            <span className="feedprice__ship">
              {item.shipping_cents > 0
                ? ` + ${formatPrice(item.shipping_cents)} shipping`
                : " · shipping included"}
            </span>
          )}
        </p>
        {metaLine && <p className="feedmeta mt-1">{metaLine}</p>}
        {engagement()}
      </Link>
    );
  }

  if (item.kind === "car") {
    const href = `/cars/${item.slug}`;
    const engagement = (compact = false) => (
      <CardEngagement
        target={{ kind: "car", id: item.id }}
        path={path}
        isLoggedIn={isLoggedIn}
        initialLiked={Boolean(item.viewerLiked)}
        likeCount={item.likeCount ?? 0}
        shareUrl={href}
        initialSaved={Boolean(item.viewerSaved)}
        compact={compact}
      />
    );

    // A build sheet leads with whatever identifies the car best: its pet
    // name when the owner gave it one, its year-make-model otherwise — never
    // an empty headline with the identity buried in the meta.
    const headline = item.name.trim() || item.meta || "Build sheet";
    const subline = item.name.trim() && item.meta ? item.meta : null;
    // Owner, activity and market state fold into one dim line, not a chip rack.
    const activityLine = [
      item.ownerName,
      item.updateCount > 0
        ? `${item.updateCount} update${item.updateCount === 1 ? "" : "s"}${
            item.lastActivityAt ? ` · last ${relativeTime(item.lastActivityAt)}` : ""
          }`
        : null,
      item.forSaleCount > 0
        ? `${item.forSaleCount} part${item.forSaleCount === 1 ? "" : "s"} for sale`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const cut = hashOf(item.id) % 4;
    if (cut === 3 && item.cover_url) {
      // Compact ledger row.
      return (
        <Link href={href} className="tile tile--row">
          <span className="tile__thumb" aria-hidden="true">
            <Media src={item.cover_url} alt="" className="h-full w-full" role="row" />
          </span>
          <span className="min-w-0 self-center">
            <span className="microlabel block">Build</span>
            <span className="feedtitle mt-0.5 block truncate">{headline}</span>
            <span className="feedmeta mt-0.5 block truncate">
              {[subline, item.ownerName].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="tile__rowfoot">{engagement(true)}</span>
        </Link>
      );
    }

    const aspect = cut === 1 ? "aspect-[16/10]" : cut === 2 ? "aspect-[4/5]" : "aspect-[4/3]";
    return (
      <Link href={href} className="tile block">
        <span className="microlabel block">Build</span>
        {item.cover_url && (
          <span className={`tile__img mt-2 block ${aspect}`}>
            <Media src={item.cover_url} alt={headline} className="h-full w-full" role="card" />
          </span>
        )}
        <p className="feedtitle feedtitle--lg">{headline}</p>
        {subline && <p className="feedmeta mt-0.5">{subline}</p>}
        {activityLine && <p className="feedmeta mt-1">{activityLine}</p>}
        {engagement()}
      </Link>
    );
  }

  // Update plate — person + car + activity, always, on the recessed deep tone.
  const href = `/cars/${item.carSlug}/activity/${item.id}`;
  const time = relativeTime(item.created_at);
  const longIntro = (item.intro?.length ?? 0) > 180;
  const textFirst = !item.cover_url || longIntro;

  const engagement = (compact = false) => (
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
      compact={compact}
    />
  );
  const header = (
    <span className="flex items-baseline justify-between gap-3">
      <span className="microlabel microlabel--ink">New update</span>
      <span className="microlabel">{time}</span>
    </span>
  );
  const photosCue = item.imageCount > 1 && item.cover_url && (
    <span className="microlabel mt-1.5 block tabular-nums">{item.imageCount} photos</span>
  );

  if (textFirst) {
    return (
      <Link href={href} className="tile tile--deep block">
        {header}
        <p className="feedtitle clamp2 mt-2.5">&ldquo;{item.title}&rdquo;</p>
        {item.intro && <p className="feedmeta clamp2 mt-1">{item.intro}</p>}
        <PersonCarLine owner={item.ownerName} car={item.carName} />
        {item.cover_url && (
          <span className="tile__img mt-3 block aspect-[3/2]">
            <Media src={item.cover_url} alt={item.title} className="h-full w-full" role="card" />
          </span>
        )}
        {photosCue}
        {engagement()}
      </Link>
    );
  }

  const cut = hashOf(item.id) % 3;

  if (cut === 2) {
    // Horizontal split — photo beside the note, the workbench view. The
    // engagement strip runs under both columns.
    return (
      <Link href={href} className="tile tile--deep tile--split">
        <span className="tile__img tile__img--side block">
          <Media src={item.cover_url ?? undefined} alt={item.title} className="h-full w-full" role="card" />
        </span>
        <span className="tile__splitbody min-w-0">
          {header}
          <p className="feedtitle clamp2 mt-2">&ldquo;{item.title}&rdquo;</p>
          {item.intro && <p className="feedmeta clamp2 mt-1">{item.intro}</p>}
          <PersonCarLine owner={item.ownerName} car={item.carName} />
        </span>
        <span className="tile__rowfoot">{engagement(true)}</span>
      </Link>
    );
  }

  // Photo-led poster — landscape or portrait by hash, so a column of updates
  // steps tall/short instead of repeating one crop.
  const aspect = cut === 1 ? "aspect-[4/5]" : "aspect-[3/2]";
  return (
    <Link href={href} className="tile tile--deep block">
      {header}
      <span className={`tile__img mt-2 block ${aspect}`}>
        <Media src={item.cover_url ?? undefined} alt={item.title} className="h-full w-full" role="card" />
      </span>
      <p className="feedtitle clamp2">{item.title && <>&ldquo;{item.title}&rdquo;</>}</p>
      {item.intro && <p className="feedmeta clamp2 mt-1">{item.intro}</p>}
      <PersonCarLine owner={item.ownerName} car={item.carName} />
      {photosCue}
      {engagement()}
    </Link>
  );
}

/**
 * The Explore wall — a dense photo mosaic on a square unit (see Mosaic).
 * Chronological DOM order; `grid-auto-flow: dense` fills holes so the wall
 * never shows a gap, the trade every photo wall makes.
 */
export function MasonryFeed({
  items,
  isLoggedIn = false,
  path = "/explore",
}: { items: FeedItem[] } & ViewerProps) {
  if (!items.length) {
    return (
      <div className="undrawn">
        <span className="undrawn__mark" aria-hidden="true">
          ✎
        </span>
        <h3>Nothing here yet</h3>
        <p>As people add their cars and list parts, it all shows up here. Check back soon.</p>
      </div>
    );
  }
  return (
    <Mosaic>
      {items.map((item) => (
        <FeedMosaicCell key={`${item.kind}-${item.id}`} item={item} isLoggedIn={isLoggedIn} path={path} />
      ))}
    </Mosaic>
  );
}

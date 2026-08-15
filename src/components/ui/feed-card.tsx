import Link from "next/link";

import type { FeedItem } from "@/lib/feed";
import { conditionLabel, formatPrice } from "@/lib/marketplace/taxonomy";

import { Media } from "./primitives";

/**
 * Explore plates — Livesheet tiles packed into columns (see .feedcols).
 * Every card keeps its natural height; cohesion comes from shared anatomy
 * (media → headline → meta → chips, same chrome, same gutter), not from
 * forcing rows level. Type recognition is systematic, not hashed:
 *   part   — raised tile, price-led; photo-less parts become a mono
 *            price-tag plate rather than a giant empty image box
 *   build  — raised tile, taller 4:3 media, the car's name one step up
 *   update — recessed deep tone with the live "New update" header; the
 *            sheet's annotation voice, distinct from merchandise
 */

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

function AuthorLine({ name }: { name: string | null }) {
  if (!name) return null;
  return <p className="kv mt-0.5 text-dim">{name}</p>;
}

/** Person + car on one line — an update is always someone doing something to something. */
function PersonCarLine({ owner, car }: { owner: string | null; car: string }) {
  return <p className="kv mt-0.5 text-dim">{[owner, car].filter(Boolean).join(" · ")}</p>;
}

export function FeedCard({ item }: { item: FeedItem }) {
  if (item.kind === "part") {
    // Signals (max 3): condition/grade chip, fitment chip, watch microlabel.
    const conditionText = [
      conditionLabel(item.condition),
      item.grade ? `Grade ${item.grade.toUpperCase()}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const watching = item.watchCount ?? 0;
    const chips = (
      <span className="mkt__meta">
        {/* Ink, not red: a listed part is the feed's normal state, and the
            masonry showed 6-9 red elements per viewport when every card
            carried one. Red stays reserved for "live right now". */}
        {conditionText ? (
          <span className="chip">{conditionText}</span>
        ) : (
          <span className="chip chip--ink">For sale</span>
        )}
        {item.fitsCarName && (
          <span className="chip" title="Seller-stated fitment — verify before you buy">
            Fits your {item.fitsCarName}
          </span>
        )}
      </span>
    );
    const shipLine = typeof item.shipping_cents === "number" && (
      <span className="mkt__ship block">
        {item.shipping_cents > 0
          ? `+ ${formatPrice(item.shipping_cents)} shipping`
          : "Shipping included"}
      </span>
    );

    if (!item.cover_url) {
      // No photos yet → a price-tag plate: the number carries the card the
      // way the photo would, instead of a full-size empty image box.
      return (
        <Link href={`/listings/${item.id}`} className="tile block">
          <span className="flex items-baseline justify-between gap-3">
            <span className="microlabel">For sale</span>
            {watching > 0 && <span className="microlabel tabular-nums">{watching} watching</span>}
          </span>
          <p className="mkt__price text-section mt-2">{formatPrice(item.price_cents)}</p>
          <p className="mkt__name clamp2 mt-1">{item.title}</p>
          {shipLine}
          {chips}
        </Link>
      );
    }

    return (
      <Link href={`/listings/${item.id}`} className="tile block">
        <span className="tile__img block aspect-[3/2]">
          <Media src={item.cover_url} alt={item.title} className="h-full w-full" role="card" />
        </span>
        <p className="mkt__name clamp2">{item.title}</p>
        <p className="mkt__price flex items-baseline justify-between gap-3">
          <span>{formatPrice(item.price_cents)}</span>
          {watching > 0 && <span className="microlabel tabular-nums">{watching} watching</span>}
        </p>
        {shipLine}
        {chips}
      </Link>
    );
  }

  if (item.kind === "car") {
    // Build sheet plate: identity, then an activity line when the build has one.
    const activity = item.updateCount > 0 && (
      <p className="microlabel mt-1 tabular-nums">
        {item.updateCount} update{item.updateCount === 1 ? "" : "s"}
        {item.lastActivityAt ? ` · last ${relativeTime(item.lastActivityAt)}` : ""}
      </p>
    );
    const chips = (
      <span className="mkt__meta">
        <span className="chip">Build</span>
        {item.forSaleCount > 0 && (
          <span className="chip chip--ink">
            {item.forSaleCount} part{item.forSaleCount === 1 ? "" : "s"} for sale
          </span>
        )}
      </span>
    );
    return (
      <Link href={`/cars/${item.slug}`} className="tile block">
        {item.cover_url && (
          <span className="tile__img block aspect-[4/3]">
            <Media src={item.cover_url} alt={item.name} className="h-full w-full" role="card" />
          </span>
        )}
        {/* The car's name is the headline of a build sheet — one step up from
            a part title, so builds read heavier than merchandise at a glance. */}
        <p className="mkt__name text-section">{item.name}</p>
        <AuthorLine name={item.ownerName} />
        {item.meta && <p className="order__meta mt-1">{item.meta}</p>}
        {activity}
        {chips}
      </Link>
    );
  }

  // Update plate — person + car + activity, always, on the recessed deep tone
  // with the live header. Media placement from content: long intros read
  // text-first with the photo below; short ones lead with the photo.
  const href = `/cars/${item.carSlug}/activity/${item.id}`;
  const time = relativeTime(item.created_at);
  const longIntro = (item.intro?.length ?? 0) > 180;
  const textFirst = !item.cover_url || longIntro;

  const header = (
    <span className="flex items-baseline justify-between gap-3">
      <span className="microlabel microlabel--ink">New update</span>
      <span className="microlabel">{time}</span>
    </span>
  );
  const media = item.cover_url && (
    <span className={`tile__img block aspect-[3/2] ${textFirst ? "mt-3" : "mt-2"}`}>
      <Media src={item.cover_url} alt={item.title} className="h-full w-full" role="card" />
    </span>
  );
  const photosCue = item.imageCount > 1 && item.cover_url && (
    <span className="microlabel mt-1 block tabular-nums">{item.imageCount} photos</span>
  );
  const reactions = item.reactions > 0 && (
    <span className="livedim block">
      <span className="microlabel">Reactions</span>
      <span className="val">{item.reactions}</span>
      <span className="livedim__tick" aria-hidden="true" />
    </span>
  );

  if (textFirst) {
    return (
      <Link href={href} className="tile tile--deep block">
        {header}
        <p className="mkt__name clamp2 mt-2">&ldquo;{item.title}&rdquo;</p>
        {item.intro && <p className="order__meta clamp2 mt-1">{item.intro}</p>}
        <PersonCarLine owner={item.ownerName} car={item.carName} />
        {media}
        {photosCue}
        {reactions}
      </Link>
    );
  }

  return (
    <Link href={href} className="tile tile--deep block">
      {header}
      {media}
      <p className="mkt__name clamp2">{item.title}</p>
      {item.intro && <p className="order__meta clamp2 mt-1">{item.intro}</p>}
      <PersonCarLine owner={item.ownerName} car={item.carName} />
      {photosCue}
      {reactions}
    </Link>
  );
}

/**
 * Column-packed deck of plates (.feedcols). Chronological DOM order; visual
 * order runs down each column — the packed-feed trade every reference makes
 * (Read.cv, Cosmos). Natural heights, 14px gutter, staggered draw-in.
 */
export function MasonryFeed({ items }: { items: FeedItem[] }) {
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
    <div className="feedcols">
      {items.map((item) => (
        <FeedCard key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </div>
  );
}

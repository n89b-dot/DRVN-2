import Link from "next/link";

import type { FeedItem } from "@/lib/feed";
import { formatPrice } from "@/lib/marketplace/taxonomy";

import { Media } from "./primitives";

/**
 * Explore tiles — Livesheet plates on the sheet. Four variants sharing one
 * chrome (tone-separated .tile, no borders):
 *  A. image-top entry  B. tall car sheet  C. fresh-entry quote (deep tile)
 *  D. text-only fresh entry
 */

function AuthorLine({ name }: { name: string | null }) {
  return <p className="kv mt-0.5 text-dim">{name ?? "—"}</p>;
}

export function FeedCard({ item, variantHint = 0 }: { item: FeedItem; variantHint?: number }) {
  if (item.kind === "part") {
    return (
      <Link href={`/listings/${item.id}`} className="tile block">
        <span className="tile__img block aspect-[3/2]">
          <Media
            src={item.cover_url ?? undefined}
            alt={item.title}
            className="h-full w-full"
            fallbackClassName="plate-undrawn"
          />
        </span>
        <p className="mkt__name clamp2">{item.title}</p>
        <p className="mkt__price">{formatPrice(item.price_cents)}</p>
        <span className="mkt__meta">
          <span className="chip chip--live">For sale</span>
        </span>
      </Link>
    );
  }

  if (item.kind === "car") {
    // Variant B: tall car sheet tile.
    return (
      <Link href={`/cars/${item.slug}`} className="tile block">
        <span className="tile__img block aspect-[4/3]">
          <Media
            src={item.cover_url ?? undefined}
            alt={item.name}
            className="h-full w-full"
            fallbackClassName="plate-undrawn"
          />
        </span>
        <p className="mkt__name">{item.name}</p>
        <AuthorLine name={item.ownerName} />
        {item.meta && <p className="order__meta mt-1">{item.meta}</p>}
        <span className="mkt__meta">
          <span className="chip">Build</span>
        </span>
      </Link>
    );
  }

  const href = `/cars/${item.carSlug}/activity/${item.id}`;

  if (!item.cover_url || variantHint % 2 === 1) {
    // Fresh entry — annotation-style deep tile, no photo required.
    return (
      <Link href={href} className="tile tile--deep block">
        <span className="microlabel microlabel--live">New update</span>
        <p className="mkt__name clamp2 mt-2">&ldquo;{item.title}&rdquo;</p>
        {item.intro && <p className="order__meta clamp2 mt-1">{item.intro}</p>}
        <AuthorLine name={item.ownerName} />
        {item.cover_url && (
          <span className="tile__img mt-3 block aspect-[3/2]">
            <Media src={item.cover_url} alt={item.title} className="h-full w-full" />
          </span>
        )}
        {item.reactions > 0 && (
          <div className="livedim">
            <span className="microlabel">Reactions</span>
            <span className="val">{item.reactions}</span>
            <span className="livedim__tick" aria-hidden="true" />
          </div>
        )}
      </Link>
    );
  }

  // Variant A: image-top entry.
  return (
    <Link href={href} className="tile block">
      <span className={`tile__img block ${variantHint % 4 === 2 ? "aspect-[4/5]" : "aspect-[3/2]"}`}>
        <Media src={item.cover_url} alt={item.title} className="h-full w-full" />
      </span>
      <p className="mkt__name clamp2">{item.title}</p>
      {item.intro && <p className="order__meta clamp2 mt-1">{item.intro}</p>}
      <AuthorLine name={item.ownerName} />
    </Link>
  );
}

/** Masonry of plates — tiles keep their own tone, the sheet shows through. */
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
    <div className="columns-1 gap-[14px] sm:columns-2 lg:columns-3 [&>*]:mb-[14px] [&>*]:break-inside-avoid">
      {items.map((item, index) => (
        <FeedCard key={`${item.kind}-${item.id}`} item={item} variantHint={index} />
      ))}
    </div>
  );
}

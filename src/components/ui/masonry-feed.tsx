import { Fragment } from "react";
import type { FeedItem } from "@/lib/feed";

import { EmptyState } from "./empty-state";
import { FeedMosaicCell, Mosaic } from "./mosaic";

type ViewerProps = { isLoggedIn?: boolean; path?: string };

/**
 * The Explore wall — a dense photo mosaic on a square unit (see Mosaic).
 * Chronological DOM order; `grid-auto-flow: dense` fills holes so the wall
 * never shows a gap, the trade every photo wall makes.
 *
 * (The old `FeedCard` tile deck this file's predecessor carried was replaced
 * by the mosaic family and had no remaining call sites — it's gone.)
 */
export function MasonryFeed({
  items,
  isLoggedIn = false,
  path = "/explore",
  uniform = false,
  breakers,
}: {
  items: FeedItem[];
  /** E-1: one footprint per card, so the rows align and the wall can be
   *  scanned for one kind of thing. */
  uniform?: boolean;
  /** E-4: full-width rows placed between cards, keyed by the index they
   *  follow. They are the only cells allowed to break the grid. */
  breakers?: Record<number, React.ReactNode>;
} & ViewerProps) {
  // W-2, the half that is about the past: posts published before the photo
  // rule keep their pages and their places in every list — but a photo wall
  // is a wall of photos, and a text-only cell on it is a hole. They are
  // left off here rather than given a borrowed car cover, which would show
  // a reader a picture of something the post is not about.
  const shown = uniform ? items.filter((item) => item.kind !== "update" || item.cover_url) : items;

  if (!shown.length) {
    return (
      <EmptyState mark="✎" title="Nothing here yet">
        As people add their cars and list parts, it all shows up here. Check back soon.
      </EmptyState>
    );
  }
  return (
    <Mosaic uniform={uniform}>
      {shown.flatMap((item, index) => {
        const cell = (
          <FeedMosaicCell
            eager={index === 0}
            key={`${item.kind}-${item.id}`}
            item={item}
            isLoggedIn={isLoggedIn}
            path={path}
            uniform={uniform}
          />
        );
        const breaker = breakers?.[index];
        // A Fragment, not a wrapper: the breaker's own root has to be the
        // grid child for `grid-column: 1 / -1` to mean anything — inside a
        // div it sat in one card-sized cell. And a breaker that decided it
        // had too little to show renders null, which through a Fragment is
        // no node at all rather than an empty cell (E-4).
        return breaker ? [cell, <Fragment key={`breaker-${index}`}>{breaker}</Fragment>] : [cell];
      })}
    </Mosaic>
  );
}

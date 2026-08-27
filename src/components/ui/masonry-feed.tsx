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
}: { items: FeedItem[] } & ViewerProps) {
  if (!items.length) {
    return (
      <EmptyState mark="✎" title="Nothing here yet">
        As people add their cars and list parts, it all shows up here. Check back soon.
      </EmptyState>
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

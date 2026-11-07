"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui";
import { FeedList } from "@/components/ui/feed-list";
import type { FeedCursor, FeedItem } from "@/lib/feed";

import { loadHomeFeedPage } from "./actions";
import type { HomeTab } from "./tabs";

/**
 * The rest of Home's feed: what the server rendered after the first three
 * posts, then each further page as the reader nears the end (H-4) — the same
 * mechanism as the Explore wall, one page at a time and one in flight.
 *
 * The "More" button is the same path for keyboard users, and for a browser
 * where the observer never fires.
 */
export function HomeFeedMore({
  tab,
  initialItems,
  seen: alreadyShown,
  initialHasMore,
  initialCursor = null,
}: {
  tab: HomeTab;
  initialItems: FeedItem[];
  /** Keys of the posts rendered above this block, so none is repeated. */
  seen: string[];
  initialHasMore: boolean;
  /** Where page two starts (page one's `nextCursor`): each page reads on
   *  from the last instead of skipping everything before it. */
  initialCursor?: FeedCursor | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, startTransition] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  const loadMore = useCallback(() => {
    if (inFlight.current || !hasMore) return;
    inFlight.current = true;
    const next = page + 1;
    startTransition(async () => {
      try {
        const res = await loadHomeFeedPage(tab, next, cursor);
        setItems((prev) => {
          const keys = new Set([...alreadyShown, ...prev.map((i) => `${i.kind}-${i.id}`)]);
          return [...prev, ...res.items.filter((i) => !keys.has(`${i.kind}-${i.id}`))];
        });
        setPage(next);
        setHasMore(res.hasMore);
        setCursor(res.nextCursor);
      } finally {
        inFlight.current = false;
      }
    });
  }, [alreadyShown, cursor, hasMore, page, tab]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  if (!items.length && !hasMore) return null;

  return (
    <div className="deck--main__feed deck--main__feed--rest">
      {items.length > 0 && <FeedList items={items} variant="cards" engagement={{ path: "/home", isLoggedIn: true }} />}
      <div ref={sentinel} aria-hidden="true" />
      {hasMore ? (
        <p className="mt-4 flex justify-center">
          <Button variant="ghost" onClick={loadMore} loading={pending} pendingLabel="Loading…">
            More
          </Button>
        </p>
      ) : (
        <p className="microlabel mt-6 text-center">You&apos;re all caught up</p>
      )}
    </div>
  );
}

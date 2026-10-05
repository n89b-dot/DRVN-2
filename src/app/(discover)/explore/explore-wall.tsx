"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { AnimatePresence, motion } from "motion/react";

import { MasonryFeed } from "@/components/ui";
import { transitions } from "@/lib/motion";
import type { FeedCursor, FeedItem, FeedTab } from "@/lib/feed";

import { loadFeedPage } from "./actions";

/**
 * Continuous-scroll Explore wall. The server renders page one; a sentinel
 * below the wall pulls the next page as it comes into view (one page at a
 * time, one in flight). The "More" button is the same path for keyboard
 * users and for browsers where the observer never fires.
 */
export function ExploreWall({
  tab,
  initialItems,
  initialHasMore,
  initialCursor = null,
  isLoggedIn,
  breakers,
}: {
  tab: FeedTab;
  initialItems: FeedItem[];
  initialHasMore: boolean;
  /** Where page two starts (page one's `nextCursor`): each page reads on from
   *  the last instead of skipping everything before it. */
  initialCursor?: FeedCursor | null;
  isLoggedIn: boolean;
  /** E-4's full-width rows, keyed by the card index they follow. Rendered
   *  by the server, which can query; each decides for itself whether it has
   *  enough to show. */
  breakers?: Record<number, React.ReactNode>;
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
        const res = await loadFeedPage(tab, next, cursor);
        setItems((prev) => {
          const seen = new Set(prev.map((i) => `${i.kind}-${i.id}`));
          return [...prev, ...res.items.filter((i) => !seen.has(`${i.kind}-${i.id}`))];
        });
        setPage(next);
        setHasMore(res.hasMore);
        setCursor(res.nextCursor);
      } finally {
        inFlight.current = false;
      }
    });
  }, [cursor, hasMore, page, tab]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "800px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  return (
    <>
      <section className="deck">
        <MasonryFeed items={items} isLoggedIn={isLoggedIn} path="/explore" uniform breakers={breakers} />
      </section>
      <div ref={sentinel} aria-hidden="true" />
      {/* The wall itself stays unanimated on purpose: pages preload 800px
          below the fold, so an entrance would mostly play off-screen. The
          visible state change is this footer swap — crossfade it. */}
      <AnimatePresence mode="wait" initial={false}>
        {hasMore ? (
          <motion.p
            key="more"
            className="mt-6 flex justify-center"
            exit={{ opacity: 0, transition: transitions.fast }}
          >
            <button type="button" className="btn btn--ghost" onClick={loadMore} disabled={pending}>
              {pending ? "Loading…" : "More"}
            </button>
          </motion.p>
        ) : items.length > 0 ? (
          <motion.p
            key="end"
            className="microlabel mt-8 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: transitions.standard }}
          >
            You&apos;re all caught up
          </motion.p>
        ) : null}
      </AnimatePresence>
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { AnimatePresence, motion } from "motion/react";

import { Button, MasonryFeed } from "@/components/ui";
import { transitions } from "@/lib/motion";
import type { FeedItem } from "@/lib/feed";

import { loadSearchPage } from "./actions";

/**
 * Continuous-scroll wall for Builds/Updates search results — the ExploreWall
 * idiom (sentinel + one-in-flight + keyboard "More" fallback) pointed at
 * loadSearchPage, which re-derives the search server-side from the same URL
 * params this page rendered with. Relevance order is preserved: pages come
 * back in rank order and append.
 */
export function SearchWall({
  tab,
  rawParams,
  initialItems,
  initialHasMore,
  isLoggedIn,
}: {
  tab: "cars" | "updates";
  /** The page's own query-string state, echoed back to the server action. */
  rawParams: Record<string, string | undefined>;
  initialItems: FeedItem[];
  initialHasMore: boolean;
  isLoggedIn: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [pending, startTransition] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  const loadMore = useCallback(() => {
    if (inFlight.current || !hasMore) return;
    inFlight.current = true;
    const next = page + 1;
    startTransition(async () => {
      try {
        const res = await loadSearchPage(tab, rawParams, next);
        setItems((prev) => {
          const seen = new Set(prev.map((i) => `${i.kind}-${i.id}`));
          return [...prev, ...res.items.filter((i) => !seen.has(`${i.kind}-${i.id}`))];
        });
        setPage(next);
        setHasMore(res.hasMore);
      } finally {
        inFlight.current = false;
      }
    });
  }, [hasMore, page, tab, rawParams]);

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
        <MasonryFeed items={items} isLoggedIn={isLoggedIn} path="/explore" />
      </section>
      <div ref={sentinel} aria-hidden="true" />
      <AnimatePresence mode="wait" initial={false}>
        {hasMore ? (
          <motion.p
            key="more"
            className="mt-6 flex justify-center"
            exit={{ opacity: 0, transition: transitions.fast }}
          >
            <Button variant="ghost" onClick={loadMore} disabled={pending}>
              {pending ? "Loading…" : "More results"}
            </Button>
          </motion.p>
        ) : items.length > 0 ? (
          <motion.p
            key="end"
            className="microlabel mt-8 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: transitions.standard }}
          >
            That&apos;s everything that matches
          </motion.p>
        ) : null}
      </AnimatePresence>
    </>
  );
}

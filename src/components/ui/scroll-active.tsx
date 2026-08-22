"use client";

import { useEffect, useRef } from "react";

/**
 * Drops into a horizontally scrolling rail (as a child) and, on mount,
 * scrolls the rail so its current item is visible — a rail that opens with
 * the active tab/chip off-screen reads as if the selection doesn't exist.
 *
 * Scrolls the PARENT's scrollLeft directly instead of scrollIntoView so no
 * ancestor (the page) is ever scrolled vertically as a side effect.
 */
export function ScrollActiveIntoView({
  selector = '[aria-current], .is-here, .is-on',
}: {
  selector?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const rail = ref.current?.parentElement;
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;
    const active = rail.querySelector<HTMLElement>(selector);
    if (!active) return;
    const railRect = rail.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    // Centre it when it fits; otherwise align its start with breathing room.
    const target =
      rail.scrollLeft + (rect.left - railRect.left) - (rail.clientWidth - rect.width) / 2;
    rail.scrollLeft = Math.max(0, target);
  }, [selector]);

  return <span ref={ref} hidden aria-hidden="true" />;
}

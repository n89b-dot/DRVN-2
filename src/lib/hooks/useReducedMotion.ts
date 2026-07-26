"use client";

import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Tracks the user's OS-level "reduce motion" preference.
 *
 * @returns `true` when the user has asked for reduced motion. Defaults to
 *   `false` during SSR / first paint so the motion-rich experience is the
 *   baseline, then corrects on mount once the media query is readable.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
      mediaQuery.addEventListener("change", onStoreChange);
      return () => mediaQuery.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

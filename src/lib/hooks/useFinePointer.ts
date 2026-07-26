"use client";

import { useSyncExternalStore } from "react";

const FINE_POINTER_QUERY = "(pointer: fine)";

/**
 * Reports whether the primary input is a precise pointing device (mouse /
 * trackpad) rather than a coarse one (touch). Pointer-driven flourishes such as
 * a spotlight cursor or magnetic buttons should only run when this is `true`.
 *
 * @returns `true` for fine pointers, `false` for coarse/touch (and during SSR).
 */
export function useFinePointer(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const pointerQuery = window.matchMedia(FINE_POINTER_QUERY);
      pointerQuery.addEventListener("change", onStoreChange);
      return () => pointerQuery.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(FINE_POINTER_QUERY).matches,
    () => false,
  );
}

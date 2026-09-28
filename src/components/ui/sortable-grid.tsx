"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type * as Impl from "./sortable-grid-impl";

/**
 * SortableGrid / SortableItem — drag-and-drop ordering for photo strips and
 * tile grids. The dnd-kit implementation lives in ./sortable-grid-impl and is
 * loaded on demand: exported through the `@/components/ui` barrel, a static
 * import put dnd-kit (~19 KB gzipped) in the shared bundle of nearly every
 * route, though only the Sell form and the garage gallery editor use it.
 * Server rendering is unchanged — the chunk is preloaded on the pages that
 * render a grid.
 */

const LazySortableGrid = dynamic(() => import("./sortable-grid-impl").then((m) => m.SortableGrid));
const LazySortableItem = dynamic(() => import("./sortable-grid-impl").then((m) => m.SortableItem));

export function SortableGrid(props: ComponentProps<typeof Impl.SortableGrid>) {
  return <LazySortableGrid {...props} />;
}

/** One draggable cell inside a SortableGrid. */
export function SortableItem(props: ComponentProps<typeof Impl.SortableItem>) {
  return <LazySortableItem {...props} />;
}

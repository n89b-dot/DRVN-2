"use client";

import { useState } from "react";

import { BottomSheet } from "./bottom-sheet";

/**
 * A Finder's dense refinement row, sheeted on compact.
 *
 * ≥640px this renders exactly the `.finder__refine` row it wraps — nothing
 * changes. On a phone, where five stacked refinement controls would push the
 * results below the fold, the row moves into a BottomSheet behind a single
 * "Refine" control that reports how many refinements are active.
 *
 * The children stay mounted either way (BottomSheet hides, never unmounts),
 * so inside a GET form every refinement still submits with the search — URL
 * behavior is unchanged.
 */
export function FinderRefineSheet({
  label = "Refine",
  activeCount = 0,
  children,
}: {
  label?: string;
  /** How many refinements are currently applied — shown on the toggle. */
  activeCount?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="fbtn sm:hidden"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {label}
        {activeCount > 0 && <span className="n n--live">{activeCount}</span>}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} label={label} inlineFrom="sm">
        <div className="finder__refine">{children}</div>
      </BottomSheet>
    </>
  );
}

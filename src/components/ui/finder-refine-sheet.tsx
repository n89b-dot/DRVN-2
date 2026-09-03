"use client";

import { useState } from "react";

import { BottomSheet } from "./bottom-sheet";
import { Icon } from "./icons";

/**
 * A Finder's refinements, one quiet step behind the query line.
 *
 * The finder shows a single row at every width — the query field and this
 * trigger (a sliders icon; "Filters" beside it ≥640px, icon-only on
 * compact; a live count of what's applied either way). The dense
 * refinement controls live in a sheet: bottom-anchored on compact, a
 * centered panel ≥640px. No width ever renders the refinement row inline
 * under the query — that stacked the plate two to six controls tall before
 * any results.
 *
 * The children stay mounted while closed (BottomSheet hides, never
 * unmounts), so inside a GET form every refinement still submits with the
 * search — URL behavior is unchanged.
 */
export function FinderRefineSheet({
  label = "Filters",
  activeCount = 0,
  aside,
  children,
}: {
  label?: string;
  /** How many refinements are currently applied — shown on the toggle. */
  activeCount?: number;
  /**
   * Extra toolbar controls (e.g. a Sort select) rendered beside the trigger
   * in the finder's main row. Form fields placed here submit with the search.
   */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Icon + word wide; icon alone on compact, where the word cost the
          query field ~70px beside it. The accessible name never drops. */}
      <button
        type="button"
        className={`${activeCount > 0 ? "fbtn is-on" : "fbtn"} gap-1.5`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={activeCount > 0 ? `${label}, ${activeCount} active` : label}
        onClick={() => setOpen(true)}
      >
        <Icon name="filter" className="h-4 w-4" />
        <span className="hidden sm:inline">{label}</span>
        {activeCount > 0 && <span className="n n--live">{activeCount}</span>}
      </button>
      {aside}
      <BottomSheet open={open} onClose={() => setOpen(false)} label={label} align="center">
        <div className="finder__refine">{children}</div>
      </BottomSheet>
    </>
  );
}

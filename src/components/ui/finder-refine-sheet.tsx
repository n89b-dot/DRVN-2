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
 *
 * `actions` is the sheet's one footer: a quiet Reset on the left and the
 * primary Apply on the right, in one row. With it the sheet drops its own
 * dismiss button — the scrim, Escape and the drag close it (and discard the
 * draft), so a third "Cancel" under Reset and Apply was one button too many.
 */
export function FinderRefineSheet({
  label = "Filters",
  activeCount = 0,
  aside,
  children,
  onDismiss,
  inline,
  actions,
}: {
  /** The footer row — `[Reset] … [Apply]` (see above). */
  actions?: React.ReactNode;
  label?: string;
  /** How many refinements are currently applied — shown on the toggle. */
  activeCount?: number;
  /**
   * Extra toolbar controls (e.g. a Sort select) rendered beside the trigger
   * in the finder's main row. Form fields placed here submit with the search.
   */
  aside?: React.ReactNode;
  children: React.ReactNode;
  /** Discard an uncommitted draft when the sheet is closed without Apply. */
  onDismiss?: () => void;
  /** Where the sheet becomes a sidebar (M-3): "lg" keeps it a sheet below
   *  1024px and renders the same fields inline at or above it. */
  inline?: "sm" | "lg";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Icon + word wide; icon alone on compact, where the word cost the
          query field ~70px beside it. The accessible name never drops. */}
      <button
        type="button"
        className={`${activeCount > 0 ? "fbtn is-on" : "fbtn"} gap-2${inline === "lg" ? " lg:hidden" : ""}`}
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
      <BottomSheet
        open={open}
        onClose={() => { onDismiss?.(); setOpen(false); }}
        closeLabel={actions ? null : onDismiss ? "Cancel" : "Done"}
        label={label}
        align={inline ? undefined : "center"}
        inlineFrom={inline}
      >
        <div className="finder__refine">
          {children}
          {actions && <div className="finder__actions">{actions}</div>}
        </div>
      </BottomSheet>
    </>
  );
}

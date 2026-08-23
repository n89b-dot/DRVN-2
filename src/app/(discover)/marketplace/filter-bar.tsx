import type { ReactNode } from "react";

import { CONDITIONS } from "@/lib/marketplace/taxonomy";
import { FinderRefineSheet } from "@/components/ui";
import { SlashFocus } from "@/components/ui/slash-focus";

import { SortSelect } from "./sort-select";

/**
 * GET-form filter bar — server-rendered, no client JS needed.
 * Submits back to the current path with query params.
 *
 * The Marketplace's control hierarchy, top to bottom:
 *
 *   Search   — the query line: find something by text (this plate's top row)
 *   Category — where you are in the taxonomy (CategoryNav / the Browse
 *              sheet — navigation, deliberately not inside this form)
 *   Refine   — narrow the current set: condition · location · price · garage
 *              fit (inline ≥640px, sheeted behind "Refine" on compact)
 *   Sort     — one control per width (chips in the results head on desktop,
 *              the select in the compact toolbar)
 *   Active   — the removable chips under the plate (ActiveFilters)
 *   Results  — the wall
 *
 * Carries `sort` through as a field so choosing a sort and then searching
 * doesn't silently reset it. `page` is deliberately *not* carried: a new
 * search should start at page one.
 */
export function FilterBar({
  action,
  filters,
  showFitToggle,
  fitCarLabel,
  browse,
}: {
  action: string;
  filters: Record<string, string | undefined>;
  showFitToggle: boolean;
  /** Names the garage car the fit filter refers to, when there's just one. */
  fitCarLabel?: string | null;
  /** The compact-width category browser (CategorySheet), placed in the
   *  toolbar beside Refine and Sort so browsing is one tap on a phone. */
  browse?: ReactNode;
}) {
  const activeCount = [filters.condition, filters.location, filters.min, filters.max, filters.fit].filter(
    Boolean
  ).length;

  return (
    <form action={action} method="get" className="finder" role="search">
      <div className="finder__main">
        <label className="search">
          <span aria-hidden="true">⌕</span>
          {/* Short by design: the long form ("…— 'coilovers', 'ECU', a car")
              was clipped mid-word at every width under 1100px. */}
          <input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Search parts…"
            aria-label="Search parts — press / to focus"
          />
          {/* Keyboard affordance in the system's own voice — hidden where
              there's no hardware keyboard to press it on. */}
          <kbd className="microlabel hidden select-none md:inline" aria-hidden="true">
            /
          </kbd>
        </label>
        <SlashFocus />
        {/* Inline beside the query at every width — a full-width Search row
            was costing the compact viewport ~54px before any inventory. */}
        <button type="submit" className="btn">
          Search
        </button>
      </div>

      {/* Compact screens sheet the dense refinement row behind one "Refine"
          control (see FinderRefineSheet) — five stacked controls were pushing
          the results below the fold. ≥640px this renders the same inline
          `.finder__refine` row as before; the fields stay mounted either way,
          so they always submit with the search. The Browse sheet rides in the
          same toolbar so the three compact controls read as one row:
          Browse · Refine · Sort. */}
      <FinderRefineSheet
        activeCount={activeCount}
        aside={
          <>
            {browse}
            <SortSelect value={filters.sort} />
          </>
        }
      >
        {/* Desktop: a labelled register, so the row says what it is. */}
        <span className="microlabel filters__label hidden sm:inline">Refine</span>
        <select
          name="condition"
          defaultValue={filters.condition ?? ""}
          className="ctl w-full max-w-none sm:w-auto"
          aria-label="Condition"
        >
          <option value="">Any condition</option>
          {CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          name="location"
          defaultValue={filters.location ?? ""}
          placeholder="Location"
          className="ctl w-full max-w-none sm:w-32"
          aria-label="Location"
        />
        {/* The price bounds are one control in two halves, so they travel
            together — left loose they split across a wrap and read as two
            unrelated fields. */}
        <span className="flex w-full gap-2 sm:w-auto">
          <input
            name="min"
            defaultValue={filters.min ?? ""}
            placeholder="Min $"
            inputMode="decimal"
            className="ctl min-w-0 max-w-none flex-1 sm:w-24 sm:flex-none"
            aria-label="Minimum price"
          />
          <input
            name="max"
            defaultValue={filters.max ?? ""}
            placeholder="Max $"
            inputMode="decimal"
            className="ctl min-w-0 max-w-none flex-1 sm:w-24 sm:flex-none"
            aria-label="Maximum price"
          />
        </span>
        {showFitToggle && (
          <label className="flex basis-full items-center gap-2 font-mono text-micro uppercase tracking-[0.1em] text-dim sm:ml-auto sm:basis-auto">
            <input
              type="checkbox"
              name="fit"
              value="1"
              defaultChecked={filters.fit === "1"}
              className="sq"
            />
            {fitCarLabel ? `Potential matches for ${fitCarLabel}` : "Potential matches for your garage"}
          </label>
        )}
        {/* Inside the sheet the refinements apply with the search — say so,
            instead of leaving a phone user to guess whether "Done" submits. */}
        <button type="submit" className="btn w-full sm:hidden">
          Apply refinements
        </button>
      </FinderRefineSheet>
    </form>
  );
}

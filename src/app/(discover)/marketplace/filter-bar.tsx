import type { ReactNode } from "react";

import { CONDITIONS } from "@/lib/marketplace/taxonomy";
import { FinderRefineSheet, SearchField } from "@/components/ui";

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
 *   Filters  — narrow the current set: condition · location · price · garage
 *              fit (sheeted behind one "Filters" control at every width)
 *   Sort     — one select in the plate row, every width
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
        <SearchField label="Search parts" defaultValue={filters.q ?? ""} placeholder="Search…" />

        {/* The dense refinements live one step behind the query line at
            every width (see FinderRefineSheet) — a "Filters" control with a
            live count opens the sheet; the fields stay mounted either way,
            so they always submit with the search. Browse stays compact-only
            (≥640px the CategoryNav tiles are the browser); Sort rides in the
            same row so the plate reads Search · Filters · Sort. */}
        <FinderRefineSheet
          activeCount={activeCount}
          aside={
            <>
              <span className="contents sm:hidden">{browse}</span>
              <SortSelect value={filters.sort} />
            </>
          }
        >
          <span className="microlabel filters__label">Filters</span>
        <select
          name="condition"
          defaultValue={filters.condition ?? ""}
          className="ctl w-full max-w-none"
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
          className="ctl w-full max-w-none"
          aria-label="Location"
        />
        {/* The price bounds are one control in two halves, so they travel
            together — left loose they split across a wrap and read as two
            unrelated fields. */}
        <span className="flex w-full gap-2">
          <input
            name="min"
            defaultValue={filters.min ?? ""}
            placeholder="Min $"
            inputMode="decimal"
            className="ctl min-w-0 max-w-none flex-1"
            aria-label="Minimum price"
          />
          <input
            name="max"
            defaultValue={filters.max ?? ""}
            placeholder="Max $"
            inputMode="decimal"
            className="ctl min-w-0 max-w-none flex-1"
            aria-label="Maximum price"
          />
        </span>
        {showFitToggle && (
          <label className="flex basis-full items-center gap-2 font-mono text-micro uppercase tracking-[0.1em] text-dim">
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
              instead of leaving anyone to guess whether "Done" submits. */}
          <button type="submit" className="btn w-full">
            Apply filters
          </button>
        </FinderRefineSheet>
      </div>
    </form>
  );
}

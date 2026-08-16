import { CONDITIONS } from "@/lib/marketplace/taxonomy";
import { FinderRefineSheet } from "@/components/ui";
import { SlashFocus } from "@/components/ui/slash-focus";

/**
 * GET-form filter bar — server-rendered, no client JS needed.
 * Submits back to the current path with query params.
 *
 * Rendered as a `.finder` plate: the query line runs full-width with the
 * submit beside it, refinements sit on their own row beneath, so the whole
 * thing reads as one instrument instead of loose controls on the canvas.
 *
 * Carries `sort` through as a hidden field so choosing a sort and then
 * searching doesn't silently reset it. `page` is deliberately *not*
 * carried: a new search should start at page one.
 */
export function FilterBar({
  action,
  filters,
  showFitToggle,
  fitCarLabel,
}: {
  action: string;
  filters: Record<string, string | undefined>;
  showFitToggle: boolean;
  /** Names the garage car the fit filter refers to, when there's just one. */
  fitCarLabel?: string | null;
}) {
  return (
    <form action={action} method="get" className="finder" role="search">
      {filters.sort && <input type="hidden" name="sort" value={filters.sort} />}

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
        <button type="submit" className="btn w-full sm:w-auto">
          Search
        </button>
      </div>

      {/* Compact screens sheet the dense refinement row behind one "Refine"
          control (see FinderRefineSheet) — five stacked controls were pushing
          the results below the fold. ≥640px this renders the same inline
          `.finder__refine` row as before; the fields stay mounted either way,
          so they always submit with the search. */}
      <FinderRefineSheet
        activeCount={
          [filters.condition, filters.location, filters.min, filters.max, filters.fit].filter(
            Boolean
          ).length
        }
      >
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
      </FinderRefineSheet>
    </form>
  );
}

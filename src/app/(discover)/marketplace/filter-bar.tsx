import { CONDITIONS } from "@/lib/marketplace/taxonomy";

/**
 * GET-form filter bar — server-rendered, no client JS needed.
 * Submits back to the current path with query params.
 *
 * Adds the location filter the spec called for, and carries `sort` through as a
 * hidden field so choosing a sort and then searching doesn't silently reset it.
 * `page` is deliberately *not* carried: a new search should start at page one.
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
    <form action={action} method="get" className="flex flex-wrap items-center gap-2">
      {filters.sort && <input type="hidden" name="sort" value={filters.sort} />}

      {/* Below `sm` the controls go full-bleed and stack in a single ruled
          column; the price pair splits the row between them. Above it they
          return to one inline band at their natural widths. Fixed widths at
          every size left the row a ragged staircase on a phone. */}
      <label className="search basis-full sm:flex-1 sm:basis-[220px]">
        <span aria-hidden="true">⌕</span>
        {/* Short by design: the long form ("…— 'coilovers', 'ECU', a car") was
            clipped mid-word at every width under 1100px. */}
        <input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Search parts…"
          aria-label="Search parts"
        />
      </label>
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
      <button type="submit" className="btn w-full sm:w-auto">
        Search
      </button>
      {showFitToggle && (
        <label className="flex basis-full items-center gap-2 pt-1 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">
          <input
            type="checkbox"
            name="fit"
            value="1"
            defaultChecked={filters.fit === "1"}
            className="sq"
          />
          {fitCarLabel ? `Fits your ${fitCarLabel} only` : "Fits your garage only"}
        </label>
      )}
    </form>
  );
}

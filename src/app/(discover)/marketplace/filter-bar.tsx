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

      <label className="search flex-1 basis-[220px]">
        <span aria-hidden="true">⌕</span>
        <input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Search the sheets — 'coilovers', 'ECU', a car…"
          aria-label="Search parts"
        />
      </label>
      <select
        name="condition"
        defaultValue={filters.condition ?? ""}
        className="ctl w-auto"
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
        className="ctl w-32"
        aria-label="Location"
      />
      <input
        name="min"
        defaultValue={filters.min ?? ""}
        placeholder="Min $"
        inputMode="decimal"
        className="ctl w-24"
        aria-label="Minimum price"
      />
      <input
        name="max"
        defaultValue={filters.max ?? ""}
        placeholder="Max $"
        inputMode="decimal"
        className="ctl w-24"
        aria-label="Maximum price"
      />
      <button type="submit" className="btn">
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

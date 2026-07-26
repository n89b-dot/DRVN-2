import { CONDITIONS } from "@/lib/marketplace/taxonomy";

const inputClass =
  "h-11 rounded-input border border-border bg-surface px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent";

/**
 * GET-form filter bar — server-rendered, no client JS needed.
 * Submits back to the current path with query params.
 */
export function FilterBar({
  action,
  filters,
  showFitToggle,
}: {
  action: string;
  filters: Record<string, string | undefined>;
  showFitToggle: boolean;
}) {
  return (
    <form action={action} method="get" className="rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Search parts…"
          className={`${inputClass} min-w-[200px] flex-1 bg-app`}
        />
        <select name="condition" defaultValue={filters.condition ?? ""} className={`${inputClass} bg-app`}>
          <option value="">Any condition</option>
          {CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          name="min"
          defaultValue={filters.min ?? ""}
          placeholder="Min $"
          inputMode="decimal"
          className={`${inputClass} w-24 bg-app`}
        />
        <input
          name="max"
          defaultValue={filters.max ?? ""}
          placeholder="Max $"
          inputMode="decimal"
          className={`${inputClass} w-24 bg-app`}
        />
        <button
          type="submit"
          className="h-11 rounded-pill bg-accent px-6 text-sm font-semibold text-white transition hover:bg-accent/90"
        >
          Search
        </button>
      </div>
      {showFitToggle && (
        <label className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            name="fit"
            value="1"
            defaultChecked={filters.fit === "1"}
            className="accent-[#3B71FE]"
          />
          Only show parts that fit cars in my garage
        </label>
      )}
    </form>
  );
}

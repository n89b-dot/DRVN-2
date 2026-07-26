import { CONDITIONS } from "@/lib/marketplace/taxonomy";

/**
 * GET-form filter bar — server-rendered, no client JS needed.
 * Submits back to the current path with query params.
 * Livesheet: search plate + mono controls on the sheet, no boxes-in-boxes.
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
    <form action={action} method="get" className="flex flex-wrap items-center gap-2">
      <label className="search flex-1 basis-[220px]">
        <span aria-hidden="true">⌕</span>
        <input name="q" defaultValue={filters.q ?? ""} placeholder="Search the sheets — 'coilovers', 'ECU', a car…" />
      </label>
      <select name="condition" defaultValue={filters.condition ?? ""} className="ctl w-auto">
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
        className="ctl w-24"
      />
      <input
        name="max"
        defaultValue={filters.max ?? ""}
        placeholder="Max $"
        inputMode="decimal"
        className="ctl w-24"
      />
      <button type="submit" className="btn">
        Search
      </button>
      {showFitToggle && (
        <label className="flex basis-full items-center gap-2 pt-1 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">
          <input type="checkbox" name="fit" value="1" defaultChecked={filters.fit === "1"} className="sq" />
          Fits your garage only
        </label>
      )}
    </form>
  );
}
